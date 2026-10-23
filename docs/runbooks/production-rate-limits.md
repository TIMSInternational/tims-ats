# Production web rate limits

The Next.js/tRPC limiter (`packages/api/src/middleware/rate-limit.ts`) keeps its counters in
one **DynamoDB** table (`packages/api/src/middleware/rate-limit-store.ts`). A Vercel
function's process memory is not shared with other instances, so the in-memory fallback is
suitable only for local development and previews. Production requires both
`RATE_LIMIT_DYNAMODB_TABLE` and `RATE_LIMIT_DYNAMODB_REGION` in the **Vercel Production**
environment; a production build without them refuses to start. There is deliberately no
`AWS_REGION` fallback: on Vercel that is the function's own region and is also used for SES.

Credentials come from the default AWS chain, i.e. the same `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` the S3 and SES clients use. That IAM user needs exactly
`dynamodb:GetItem`, `dynamodb:UpdateItem` and `dynamodb:PutItem` on the table, nothing else.

## Table settings

| Setting             | Value                                                      | Why                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key                 | partition key `pk` (String), no sort key                   | One item per identifier per window                                                                                                                                                     |
| Billing             | On-demand                                                  | No capacity to size; each check is 1 write unit + 1 read unit (strongly consistent read; an eventually consistent one could roughly double the quota just after a window boundary)     |
| Max throughput      | 4,000 write and 4,000 read units/s                         | The throughput a new on-demand table serves without scaling. Caps a flood at ≈ US$11/h; reaching it throttles, and throttling makes the fail-closed tiers return `SERVICE_UNAVAILABLE` |
| TTL                 | attribute `expiresAt` (epoch seconds)                      | Counters delete themselves; DynamoDB TTL is lazy, so the code never trusts an expired item                                                                                             |
| Deletion protection | On                                                         | Deleting the table while the guard is deployed fails closed (see below)                                                                                                                |
| Encryption          | AWS-owned key (default)                                    | No KMS cost; contents are hashes and counters                                                                                                                                          |
| Point-in-time       | Off                                                        | Counters are ephemeral; restoring them has no use                                                                                                                                      |
| Region              | Same region as the Vercel functions (`pdx1` = `us-west-2`) | Each check is two sequential round trips                                                                                                                                               |

**What is stored:** one item per tier and identifier, `rl#<tier>#sha256(identifier)`, holding a
counter per window (`w<window index>`; the store removes counters older than the previous
window), and one item per recipient for the e-mail cap, `ae#sha256(lowercased address)`.
Raw user ids, client IPs, API-key ids and e-mail addresses never reach the table.

The algorithm is the sliding window `@upstash/ratelimit` used before: the previous window's
count is weighted by its remaining overlap, and a denied request is not counted. Admission is
atomic, as Upstash's single Lua script was: one conditional write checks that the current
window has room, that the previous window is exactly what was weighed, and that no later
window has started. If a request in flight across a window boundary lands late, that write
is rejected and the request is re-decided at the current time (at most 3 attempts; if late
writes keep landing, the request is denied with a 1 s retry hint, not sent down the outage
path: the store is healthy and the caller is at its quota, so it must not get a fresh
per-instance budget). Concurrent requests inside one window never conflict with each
other. The application-email cap is a rolling 24 h claim per recipient.

## Activation order

1. Create the table and grant the IAM user (owner kit). Prove a disposable item can be
   written, read and deleted, then delete it.
2. Add both values to the Vercel **Production** environment. Adding variables alone does
   not change an existing deployment.
3. Merge the production guard only after step 2, then deploy or redeploy. A build without
   the variables must fail rather than silently use per-instance counters.
4. From two independent sessions, exercise a harmless bounded endpoint against the
   production alias and verify the same counter advances (the table's item count / the
   `ConsumedWriteCapacityUnits` metric). Verify the expected `TOO_MANY_REQUESTS` response
   after the tier limit and that normal requests resume after the window. Avoid
   account-lockout paths.
5. Check the Vercel error rate and the table's `ThrottledRequests` / `SystemErrors`
   metrics (the owner kit also alarms on sustained write volume far above normal), and confirm no `ratelimit.shared_store_unavailable` warnings appear in the
   function logs (see "Outage behavior" below).

## Outage behavior

Every shared-limiter call is bounded to `SHARED_LIMIT_TIMEOUT_MS` (1 s,
`packages/api/src/middleware/rate-limit-store.ts`); at the deadline the in-flight request is
aborted. The SDK does not retry (an increment is not idempotent, so a retried write could
count one request twice). When DynamoDB times out or errors (throttling, access denied,
missing table, network):

| Traffic                                                                                                                                                                                                   | Behavior                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `auth` tier, `ai` tier, `export` tier                                                                                                                                                                     | **Fail closed**: `SERVICE_UNAVAILABLE`              |
| Credential-like paths in `FAIL_CLOSED_PATHS` (`platform.acceptInvitation`, `platform.getInvitationByToken`, `platform.resetUserPassword`, `offer.acceptByToken` / `declineByToken` / `getBySigningToken`) | **Fail closed**: `SERVICE_UNAVAILABLE`              |
| Everything else (ordinary `query` / `mutation`)                                                                                                                                                           | **Fail open** to the per-instance in-memory limiter |
| Public application e-mail cap                                                                                                                                                                             | Fail closed: the e-mail is skipped                  |

Scope caveat: TWO live candidate-facing credential flows pass through this limiter, and
fail closed during a shared-store outage:

- **Offer signing.** The public page `/offers/sign/[token]`
  (`apps/web/app/offers/sign/[token]/page.tsx`) calls `offer.getBySigningToken`,
  `offer.acceptByToken` and `offer.declineByToken`, so while the store is down a candidate can
  neither view nor answer an offer (`SERVICE_UNAVAILABLE`); tell recruiters to resend or wait.
- **AI voice interviews.** The public page `/ai-interview/[token]`
  (`apps/web/app/(portal)/ai-interview/[token]/consent-screen.tsx`, `use-interview-call.ts`)
  calls `aiInterview.recordConsent` and `aiInterview.start`, so while the store is down a
  candidate can neither consent to nor start the interview; the link keeps working once the
  store is back.

Every public procedure whose input carries a bearer token must be in the fail-closed set;
`tests/ratelimit/fail-closed-token-coverage.test.ts` scans the routers and fails if one is
missing. The other credential flows are
outside it: login, self-serve password reset (`/forgot-password`) and MFA call Supabase Auth
directly from the browser (Supabase's own auth limits apply), and the invitation accept UI
relays to the C# platform API (`/api/invitation-setup/*` → `/invitations/setup/*`), outside
this limiter (verify the C# side separately). Of the remaining fail-closed paths,
`platform.acceptInvitation` and `platform.getInvitationByToken` have no web caller today,
`platform.resetUserPassword` is an operator action, and `auth.*` currently has no mutations.

Each degradation logs a structured warning, `event: "ratelimit.shared_store_unavailable"`,
with `category`, `mode` (`fail_closed` / `fail_open_memory`), `cause` (`timeout` /
`error`), the error class name and a `suppressedSinceLast` count. At most one line per
category and mode is written every 10 s. The identifier (user id or client IP), the
request, and the raw error message are never logged. Alert on this event.

## Caches that can also use Upstash (off by default)

The rate limiter does **not** use Upstash. Two caches can, if Upstash REST credentials
(`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) are ever added, and each needs its own
explicit opt-in, because storing their contents at the Upstash subprocessor is a separate
data decision:

| Flag (Vercel env)                       | Cache                                                           | What would be stored at Upstash                                                                           |
| --------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `AI_CACHE_UPSTASH_ENABLED=true`         | AI response cache, `packages/ai/src/cache.ts`                   | AI agent outputs (may contain candidate-derived text), keyed by a hash of org + input                     |
| `PERMISSION_CACHE_UPSTASH_ENABLED=true` | Cache-aside / permission cache, `packages/api/src/lib/cache.ts` | Tenant access decisions (org/user ids, roles, grants), feature-flag and entitlement reads, dashboard KPIs |

Only the exact string `true` enables a flag; any other value, or absence, keeps that
cache in per-process memory (the behavior production has today). With the memory backend,
permission-cache invalidation is per instance: another instance can serve a revoked grant
until its TTL expires. Record the subprocessor decision (cf. #40) before setting either flag.

## Rollback

If the web deployment fails after the configuration change, restore the previous
working deployment while retaining the two variables, then investigate the error. Do not
remove either variable, or delete the table, while the production guard is deployed: the
first stops tRPC from starting, the second makes the auth, AI and export tiers fail closed.
If the IAM key is compromised, rotate it (owner kit `c0-web-iam.sh`) and redeploy; the table
holds no secrets.

This runbook covers the web tRPC limiter. The C# platform API uses its own rate-limit
configuration and must be verified separately.
