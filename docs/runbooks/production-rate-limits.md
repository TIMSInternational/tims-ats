# Production web rate limits

The Next.js/tRPC app uses `@upstash/ratelimit`. A Vercel function's process memory is
not shared with other instances, so its in-memory fallback is suitable only for
local development and previews. Production requires both
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the **Vercel Production**
environment. These are the Upstash **REST** endpoint and token; the Redis RESP
connection string used by the C# App Runner service is not a drop-in replacement.
Store the token as sensitive. Do not print either credential in CI logs or a PR.

## Activation order

1. Verify that the selected Upstash REST credential can read and write one
   disposable key, and delete that key. Check the database/region and expected
   monthly request budget. Do not use a read-only token.
2. Add both values to the Vercel **Production** environment. Confirm their names
   appear there, without reading their values back. Adding variables alone does
   not change an existing deployment.
3. Merge the production guard only after step 2, then deploy or redeploy a build
   that includes both variables. A build without them must fail rather than
   silently use per-instance counters.
4. From two independent sessions, exercise a harmless bounded endpoint against
   the production alias and verify the same Redis counter advances. Verify the
   expected `TOO_MANY_REQUESTS` response after the tier limit and that normal
   requests resume after the window. Keep test volume below the service plan's
   budget and avoid account-lockout paths.
5. Check Vercel error rate and Redis request/latency metrics, and confirm no
   `ratelimit.shared_store_unavailable` warnings appear in the function logs
   (see "Outage behavior" below).

## Outage behavior

Every shared-limiter call is bounded to `SHARED_LIMIT_TIMEOUT_MS` (1 s,
`packages/api/src/middleware/rate-limit.ts`) instead of the SDK's 5 s default. When
Upstash times out or errors:

| Traffic                                                                                                                                                                                                   | Behavior                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `auth` tier, `ai` tier, `export` tier                                                                                                                                                                     | **Fail closed**: `SERVICE_UNAVAILABLE`              |
| Credential-like paths in `FAIL_CLOSED_PATHS` (`platform.acceptInvitation`, `platform.getInvitationByToken`, `platform.resetUserPassword`, `offer.acceptByToken` / `declineByToken` / `getBySigningToken`) | **Fail closed**: `SERVICE_UNAVAILABLE`              |
| Everything else (ordinary `query` / `mutation`)                                                                                                                                                           | **Fail open** to the per-instance in-memory limiter |
| Public application e-mail cap                                                                                                                                                                             | Fail closed: the e-mail is skipped                  |

Scope caveat: none of the live user-facing credential flows passes through this
limiter. Login, self-serve password reset (`/forgot-password`) and MFA call Supabase
Auth directly from the browser (Supabase's own auth limits apply), and the invitation
accept UI relays to the C# platform API (`/api/invitation-setup/*` →
`/invitations/setup/*`), outside this limiter (verify the C# side separately). The fail-closed paths above are
the tRPC procedures that still exist (`platform.acceptInvitation` and
`platform.getInvitationByToken` have no web caller today; `platform.resetUserPassword`
is an operator action), and `auth.*` currently has no mutations.

Each degradation logs a structured warning, `event: "ratelimit.shared_store_unavailable"`,
with `category`, `mode` (`fail_closed` / `fail_open_memory`), `cause` (`timeout` /
`error`), the error class name and a `suppressedSinceLast` count. At most one line per
category and mode is written every 10 s. The identifier (user id or client IP), the
request, and the raw error message are never logged. Alert on this event.

## Caches that can also use Upstash (off by default)

The Upstash REST credentials enable **only the rate limiter**. Two caches could also
use that store; each needs its own explicit opt-in, because storing their contents at
the Upstash subprocessor is a separate data decision:

| Flag (Vercel env)                       | Cache                                                           | What would be stored at Upstash                                                                           |
| --------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `AI_CACHE_UPSTASH_ENABLED=true`         | AI response cache, `packages/ai/src/cache.ts`                   | AI agent outputs (may contain candidate-derived text), keyed by a hash of org + input                     |
| `PERMISSION_CACHE_UPSTASH_ENABLED=true` | Cache-aside / permission cache, `packages/api/src/lib/cache.ts` | Tenant access decisions (org/user ids, roles, grants), feature-flag and entitlement reads, dashboard KPIs |

Only the exact string `true` enables a flag; any other value, or absence, keeps that
cache in per-process memory (the behavior production has today, since it has no
Upstash credentials). With the memory backend, permission-cache invalidation is
per instance: another instance can serve a revoked grant until its TTL expires.
Record the subprocessor decision (cf. #40) before setting either flag.

## Rollback

If the web deployment fails after the configuration change, restore the previous
working deployment while retaining the Redis variables, then investigate the
error. Do not remove either variable while the production guard is deployed:
that would prevent tRPC from starting. Rotate a compromised REST token in Upstash
and Vercel together, then redeploy and verify the shared counter again.

This runbook covers the web tRPC limiter. The C# platform API uses its own Redis
connection setting and must be verified separately.
