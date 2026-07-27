# Cutover guidance — the 3 special-case domains

Companion to `PROD-DEPLOY-RUNBOOK-gate-g3.md` §6 (Phase B, items 7 and 13) and to
`scripts/deploy/cutover.sh` (the general staff-JWT/browser-cookie flip-and-verify script for the
other ~10 Phase-5 domains). **This doc does not duplicate that script.** These 3 domains each use a
genuinely different auth/verification mechanism, so none of them can go through the generic
flip-and-verify flow:

| Domain                                               | Auth mechanism                                                                                                          | Verdict                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| external-vendor **read**                             | `Authorization: Bearer tims_...` — the ApiKey scheme, a vendor's own key, no staff/User principal                       | **SAFELY SCRIPTABLE** — `scripts/deploy/cutover-external-vendor-read-verify.ts` |
| external-vendor **write** (`submitValidationResult`) | same ApiKey scheme, but a one-shot, pending-only state mutation                                                         | **MANUAL PROCEDURE ONLY**                                                       |
| billing-webhook                                      | Stripe HMAC signature over the raw body — no user/role identity, anonymous endpoint                                     | **MANUAL PROCEDURE ONLY** (by nature — nothing to "call" as a health check)     |
| billing-self-serve                                   | ordinary staff-JWT (same mechanism as the general cutover.sh domains) — but each call creates a REAL Stripe side effect | **MANUAL PROCEDURE ONLY**, using Stripe TEST-mode keys first                    |

Confirmed before writing any of this: `scripts/parity/write-surfaces.ts` has zero entries for
`external-vendor`, `billing-webhook`, or `billing-self-serve` — every registered write surface there
(compensation, evaluation360, succession, engagement, nine-box) is staff-JWT. `scripts/parity/
callers.ts` only implements two auth shapes: a Supabase JWT `Authorization: Bearer` header for the C#
side (`callCsharp`/`callCsharpWrite`) and a Supabase session `Cookie:` header for the TS side
(`callTs`) — **no API-key-authenticated path exists anywhere in the harness today.** The recent audit
cited in this task's brief is accurate; nothing below contradicts it.

---

## 1. external-vendor (`ExternalAssessmentEndpoints.cs` read / `ExternalValidationEndpoints.cs` write)

### Auth mechanism (verified)

Both endpoints require the **ApiKey** authentication scheme, not the JWT scheme every other C#
surface uses:

- `services/Tims.Platform/src/Tims.Api/ExternalVendor/ExternalAssessmentEndpoints.cs:54` and `:87` —
  `.RequireAuthorization(ApiKeyAuthenticationHandler.SchemeName)` on both the list and getOne routes.
- `services/Tims.Platform/src/Tims.Api/ExternalVendor/ExternalValidationEndpoints.cs:80` — same scheme
  on the submit route.
- `services/Tims.Platform/src/Tims.Api/Authentication/ApiKeyAuthenticationHandler.cs:17-58` —
  authenticates `Authorization: Bearer tims_...`, delegates to `ApiKeyResolver` (extract → hash →
  active-key + active-org lookup → parse scopes), and issues a `ClaimsPrincipal` with `org_id`,
  `api_key_id`, and `scope` claims. **No `User` row is ever involved — the key IS the principal.**
- `services/Tims.Platform/src/Tims.Infrastructure/Identity/ApiKeyRepository.cs:16-45` — looks the key
  up by SHA-256 hash (`FindActiveByHashAsync`), requires `RevokedAt == null` and (`ExpiresAt == null`
  OR in the future), and additionally fails closed if the owning org is suspended/soft-deleted. It
  **never selects the hash itself** back out.
- The scope-enforcement asymmetry matters: read uses `alwaysEnforceScope: false` (an empty-scope key
  is a wildcard) at `ExternalAssessmentEndpoints.cs:112`; write uses `alwaysEnforceScope: true` (an
  empty-scope key can NEVER reach the write) at `ExternalValidationEndpoints.cs:113`. A read-scoped key
  is provably incapable of the write, by construction — useful when provisioning a verification key.

### How a real key is provisioned (TS side — confirmed, no special access needed)

This is the same mechanism prod vendors already use today; it is an ordinary, self-serve, org-scoped
product feature, not a platform-admin or DB operation:

- `packages/api/src/routers/integration.ts:272-301` (`createApiKey`, gated
  `permissionProcedure('integration', 'create')`) — any org member with the `integration:create`
  grant can mint a key from **Settings → Integrations** in the product UI. It generates
  `tims_<env>_<64 hex chars>`, stores only the SHA-256 hash (`packages/api/src/lib/api-key.ts:10-12`,
  `hashApiKey` — the single source of truth both TS and C# verify against), and returns the raw key
  **once** (never retrievable again).
- `packages/api/src/routers/integration.ts:303-310` (`revokeApiKey`) — sets `revokedAt`; takes effect
  immediately (both TS's and C#'s active-key lookups filter on `revokedAt == null`).
- Scopes are an arbitrary string array (`z.array(z.string().max(100)).max(20)`) — pass
  `["assessment:read"]` for a read-only key, or `["validation:write"]` only if you specifically intend
  to test the write.

**Do this against a dedicated, non-customer, internal test/sandbox org — never a real vendor's org**,
so nothing you do here can ever touch a real vendor's real assessment/validation data. Set a short
`expiresAt` (e.g. +1 day) as a belt-and-suspenders self-destruct.

### Verdict 1a — READ: SAFELY SCRIPTABLE

The read endpoints are pure `GET`s with zero side effects — reading real data (even a real vendor's)
cannot corrupt anything, so the only real constraint is "don't use a real vendor's credential without
their knowledge." Given a key (however it was provisioned), the HTTP comparison itself is 100% safe to
automate.

Built: **`scripts/deploy/cutover-external-vendor-read-verify.ts`**. Run with:

```bash
TIMS_TS_BASE=https://tims-ats.vercel.app \
TIMS_CSHARP_BASE=https://<app-runner-url> \
EXTERNAL_VENDOR_API_KEY=tims_prod_xxxxx \
npx tsx scripts/deploy/cutover-external-vendor-read-verify.ts [--assignment-id <uuid>] [--take 5]
```

It hits the TS tRPC procedure (`external.getAssessmentResults` / `external.getAssessmentResult`) with
the key as a plain `Authorization: Bearer` header — confirmed this is NOT cookie-only like the rest of
the TS app: `packages/api/src/access/external-auth.ts:31-41` (`resolveApiKeyPrincipal`) reads the
`Authorization` header directly in the tRPC context builder, independent of the cookie-based staff
path — then hits the C# REST endpoint with the same key, diffs the two bodies (order-insensitive), and
separately proves 404-shape parity (TS's tRPC `NOT_FOUND` error envelope vs. C#'s bare HTTP 404) using
a random UUID that can never collide with a real row. It never sends a mutating request. Reuses
`scripts/parity/trpc.ts` and `scripts/parity/callers.ts` (`callCsharp`) rather than reimplementing
them — no duplication with `cutover.sh`, which never touches the ApiKey scheme at all.

**Bonus finding while reading the TS side**: `packages/api/src/services/external-assessment.service.ts:26-114`
already has its own dark per-surface proxy — `EXTERNAL_VENDOR_READ_VIA_CSHARP` (server-only env var).
When set, the TS tRPC procedure itself forwards the vendor's raw `Authorization` header to the C#
service and returns its response, instead of querying Prisma. That is almost certainly the mechanism
`PROD-DEPLOY-RUNBOOK-gate-g3.md`'s "`ExternalVendorReadEnabled` — API-key surface; coordinate the
external vendor" (line 156) is orchestrating: flip `Platform:ExternalVendorReadEnabled=true` (C#) +
`EXTERNAL_VENDOR_READ_VIA_CSHARP=true` (TS) together, canary a subset of traffic, watch for errors.
Run the script above **before** flipping either flag, as an independent (non-proxied) cross-check —
it calls both backends directly, so it can catch a bug the proxy itself would hide (if C# were
subtly wrong, the proxy would just faithfully return the wrong answer; this script would catch the
TS-direct vs. C#-direct mismatch).

### Verdict 1b — WRITE (`submitValidationResult`): MANUAL PROCEDURE ONLY

Why this one is NOT scripted, unlike the read side:

- The endpoint is **pending-only and atomic** (`ExternalValidationEndpoints.cs:32` comment: "the
  atomic pending-only vendor write; 200 v1 / 400 bounds / 404 / 409") — it transitions a specific
  `preemployment_validations` row from `pending` to a terminal status exactly once. A second call
  against the same row is expected to 409, not silently no-op — so this is **not safely re-runnable**
  the way a GET diff is.
  - A real vendor's real pending validation is real hiring-pipeline data (candidate background-check
    status feeding an offer decision) — an accidental/duplicate test submission is a genuine data-
    integrity incident, not just a wasted API call.
- Setting up a _disposable_ row to submit against requires walking the full offer graph
  (`candidate` → `pipeline`/`application` → `offer` → `preemployment_validations`,
  `packages/db/prisma/schema/offer.prisma:60-84`) — there is no lightweight "just insert one row"
  path the way there is for the read side's empty-list check. Building a seed script for that one-off
  graph, solely for this verification, is exactly the kind of "force automation where the underlying
  risk makes it inappropriate" the brief warns against: either it becomes a second write path capable
  of putting look-alike rows into a real database, or it duplicates significant chunks of the app's
  own offer-creation flow at high maintenance cost for a single verification use case.

**The manual procedure:**

1. In the SAME dedicated internal test org from §1's read verification, create one candidate → one
   pipeline application → one offer with a `preemployment_validations` requirement, using the
   product's own recruiting UI (no direct DB writes). This gives you a real, disposable, non-vendor
   `pending` validation row you own end-to-end.
2. Provision a SEPARATE API key scoped to `["validation:write"]` only (never reuse the read-only key
   — the write requires `alwaysEnforceScope: true`, so a read-scoped key will correctly 403).
3. With `Platform:ExternalVendorWriteEnabled=true` on a canary/staging C# deploy (never prod, at this
   stage), call `POST /external/validations/{validationId}/result` **once**, by hand (`curl`/Postman —
   not scripted), with a realistic `{ status, result, notes? }` body.
4. Verify: 200 response matches the expected `ExternalValidationResultV1` shape; read the row back
   (via the product UI or an admin query) and confirm `completed_by_api_key_id` is set and
   `completed_by_id` is null (INV-5 provenance, `ExternalValidationEndpoints.cs` doc comment / the
   `phase-5-slice-2-external-vendor-write.md` design note); call the SAME endpoint a second time and
   confirm it now 409s (proves the atomic pending-only guard).
5. Revoke both test API keys (§1's read key too, if not already expired). Delete or clearly mark the
   disposable candidate/offer/validation rows.
6. Only after this passes should `ExternalVendorWriteEnabled` be flipped for real prod traffic
   (per the runbook, together with `ValidationStaffWriteEnabled` — item 7, "FLIP-READY together")
   — and even then, the FIRST few real vendor submissions in prod should be watched (logs/Sentry) as
   the actual canary, since no synthetic test fully replaces a real vendor's real payload shape.

---

## 2. billing-webhook (`BillingWebhookEndpoints.cs` / `packages/api/src/services/billing-webhook.service.ts`)

### Auth mechanism (verified)

There is no user/role identity at all — this is intentional and unlike every other surface in the
migration:

- `services/Tims.Platform/src/Tims.Api/Billing/BillingWebhookEndpoints.cs:62` — `.AllowAnonymous()`.
- Lines 35-39 read the **raw** request body as bytes-exact text (no model binding) specifically so the
  HMAC signature computed over it still matches; lines 41-60 read the `Stripe-Signature` header and
  delegate verification + dispatch to `BillingWebhookUseCase`, mapping a verification failure to a
  bare 400 (never leaking why) and any handler failure to 500 (so Stripe retries — the apply is
  idempotent under a per-org advisory lock, per the class doc comment lines 6-19).
- `services/Tims.Platform/src/Tims.Api/Configuration/StripeBillingOptions.cs:20-26` — `WebhookSecret`
  (`Stripe__WebhookSecret`) is the signing secret used to verify; absent by default (dark deploy), and
  an absent secret makes every delivery fail verification (400) rather than skip verification — fail
  closed, matching the TS equivalent (`packages/api/src/lib/stripe.ts:115-120`,
  `constructWebhookEvent`, which throws if `STRIPE_WEBHOOK_SECRET` or the signature is missing).
- **There is no way to "call" this endpoint as a health check the way you'd curl a read endpoint.** It
  only ever does something meaningful in response to a real Stripe-originated delivery with a valid
  signature for whichever secret is configured. This is why it cannot go through the generic
  flip-and-verify script even in spirit, not just in auth-mechanism detail.

### An important nuance found while reading the code — flag Federico should double-check

`PROD-DEPLOY-RUNBOOK-gate-g3.md:169` says: \_"`BillingWebhookWriteEnabled` (set `Stripe\_\__` +
**re-point the Stripe webhook to C# first**)"\*. That phrasing is ambiguous between two different
prod changes with different risk profiles, and the code only clearly supports one of them:

- **(a) Proxy-flip (what the code actually implements)**: Stripe keeps posting to the SAME existing
  Next.js endpoint (`apps/web/app/api/webhooks/stripe/route.ts`) that's registered in Stripe's
  dashboard today. `packages/api/src/services/billing-webhook.service.ts:200` (`BILLING_WEBHOOK_WRITE_VIA_CSHARP`,
  server-only env var) + `:202-222` (`handleStripeWebhookViaCSharp`) show the TS route forwarding the
  **raw body and `Stripe-Signature` header verbatim** to the C# `/billing/webhooks/stripe` endpoint —
  the same server-to-server proxy pattern as external-vendor's read side. Under this interpretation,
  C#'s `Stripe__WebhookSecret` must be byte-identical to the secret of the **existing** Stripe webhook
  endpoint object (the one Stripe's dashboard already has registered) — nothing about the registered
  URL changes.
- **(b) Literal re-point**: change the URL Stripe's dashboard endpoint object points to, so Stripe
  posts directly to the C# App Runner service, bypassing the Next.js app entirely. Every Stripe
  webhook **endpoint object has its own distinct signing secret** — under this interpretation, C#'s
  `Stripe__WebhookSecret` would need to be the secret of a **NEW** Stripe endpoint object, not the
  existing one, and the old Next.js route would need to stay registered (or be removed) as a
  separate decision.

These are not interchangeable, and using the wrong secret for the wrong interpretation makes every
delivery fail verification (400) — Stripe will retry, then eventually disable the endpoint after
enough consecutive failures. **Confirm which one is intended before touching prod Stripe config.**
Given the proxy code already exists and mirrors every other domain's dark-cutover pattern in this
migration, (a) is the more likely intended meaning — treat that as the working assumption unless
told otherwise, but verify it explicitly rather than assuming silently.

### Verdict: MANUAL PROCEDURE ONLY — staged, monitored, never blind

There is no safe way to script "call this and see if it works," because the only meaningful trigger
is a real Stripe event, and generating one for real has real (if test-mode-safe) side effects. Stripe
itself ships purpose-built tooling for exactly this, so the procedure leans entirely on that rather
than any custom harness:

1. **Local/staging dry run with the Stripe CLI, TEST mode, before touching anything in prod.**
   - `stripe listen --forward-to <staging-or-local-url>/billing/webhooks/stripe` — the CLI
     authenticates in test mode (via `stripe login`, or a `sk_test_...`/`rk_test_...` key) and prints
     a webhook **signing secret** scoped to that `listen` session; put that into the staging deploy's
     `Stripe__WebhookSecret` (or `STRIPE_WEBHOOK_SECRET` for the TS side) for the duration of the test.
   - `stripe trigger checkout.session.completed` (and `customer.subscription.updated`,
     `customer.subscription.deleted` — the 4 event types `billing-webhook.service.ts`'s switch
     statement actually handles) — this **issues real test-mode API requests that create real
     test-mode objects** (Stripe's own doc: "triggering events causes side effects: all necessary API
     objects will be created in the process"), then delivers the resulting webhook to whatever
     `stripe listen` is forwarding to. Test-mode objects are fully isolated from live data and have
     zero real-world billing effect — safe to run repeatedly.
   - Confirm: 200 response with the expected `{ received, type, handled }` shape; the subscription
     row in the staging DB updates as expected; a deliberately-wrong signature (edit one byte of the
     forwarded header, or use `stripe trigger` against a DIFFERENT `Stripe__WebhookSecret` than what's
     configured) produces the expected bare 400, never a 500 or a silent accept.
   - Alternative/supplement: from the Stripe Dashboard, open the webhook endpoint's details page and
     use its **"Send test webhook"** feature (test-mode sample payloads, no real object created) —
     useful for verifying the endpoint responds at all without depending on `stripe trigger`'s side
     effects; combine both rather than relying on just one.
2. **Only after the staging dry run is clean**, decide (per the nuance above) whether prod means
   flipping `BILLING_WEBHOOK_WRITE_VIA_CSHARP` (proxy) or re-registering the Stripe dashboard endpoint
   URL (literal re-point), and set the matching `Stripe__WebhookSecret` for that choice.
3. **Cut over during a deliberately low-traffic window, with monitoring live** (Sentry / logs tailed
   in real time) — the failure mode here (a missed or misprocessed webhook) has real subscription-
   billing consequences (a customer's plan not upgrading after payment, a cancellation not taking
   effect, etc.), and unlike a read-domain flip there is no "just flip the flag back" instant recovery
   for whichever individual events arrived during a bad window — Stripe will retry failed (4xx/5xx)
   deliveries for a period, but a webhook that returns 200 while silently mis-processing will NOT be
   retried. Keep the OLD TS path warm and ready to re-enable instantly if anything looks wrong.
4. Do not delete the TS webhook handler until several real prod deliveries have been confirmed
   correctly processed by the C# path.

---

## 3. billing-self-serve (`BillingSelfServeEndpoints.cs`)

### Auth mechanism (verified) — a correction to the framing worth flagging

Reading the code, this endpoint's _authentication_ is actually the **ordinary staff-JWT mechanism**,
the same one `cutover.sh` already knows how to drive — **not** a novel scheme:

- `services/Tims.Platform/src/Tims.Api/Billing/BillingSelfServeEndpoints.cs:60,98,132` —
  `.RequireAuthorization()` with no scheme name (the default JWT bearer scheme), same as every
  staff-facing C# endpoint. `BillingStaffGate.AuthorizeAsync` (lines 36-37, 81-82, 115-116) is the
  same gate the billing READS use, checking the `billing:update` grant.
- On the browser side, `apps/web/lib/platform-api/client.ts:76-79` (`getAccessToken`) attaches the
  user's real Supabase session `access_token` as `Authorization: Bearer` — the exact mechanism
  `scripts/parity/callers.ts`'s `callCsharp` already exercises for every other JWT domain.
- `apps/web/lib/platform-api/billing.ts:154` (`BILLING_SELF_SERVE_WRITE_VIA_CSHARP`, a
  `NEXT_PUBLIC_*` **browser**-side flag) gates `useBillingCreateCheckoutSession` /
  `useBillingCreatePortalSession` / `useBillingCancelSubscription` (lines 179-209) — this is the
  standard client-side dark-cutover-hook pattern used across the migration, not a server-to-server
  proxy like external-vendor/billing-webhook.

So the reason this domain is excluded from the generic write-verification harness
(`write-surfaces.ts`) is **not an auth mismatch** — it is that **every successful call is a real
Stripe side effect**: `createCheckoutSession` opens a real Checkout Session, `createPortalSession`
opens a real Billing Portal session, and `cancelSubscription` really cancels (at period end) a real
subscription. Running the generic "probe org A, expect 200, read back the row" pattern against this
domain in prod, with a live key, would mean the write-verification harness itself creates a real
Checkout Session and can cancel a real org's real subscription — exactly the outcome the task brief
warns against.

### Whether Stripe test mode is actually safe here (confirmed)

Verified against current Stripe docs: test mode vs. live mode is a property of the **API key**, not
the account — `sk_test_...`/`pk_test_...` vs. `sk_live_...`/`pk_live_...` are simply two different
credential pairs on the same Stripe account, and **"objects in one mode aren't accessible to the
other"** (a test-mode Checkout Session, customer, or subscription cannot become live-mode data, and
vice versa). In test mode, card networks and payment providers never actually process anything, so a
test Checkout Session, a test subscription, and a test cancellation all have **zero real-world
billing effect** — this is exactly what makes it possible to exercise all 3 endpoints end-to-end
safely. `StripeBillingOptions.cs:14` (`SecretKey`) and `packages/api/src/lib/stripe.ts:100-109`
(`getStripe`) both just take whatever secret key string is configured — test vs. live is entirely a
function of which key string you put in `Stripe__SecretKey` / `STRIPE_SECRET_KEY`, not a separate
toggle. **This means the exact same C# deploy, code, and endpoints run in "test mode" by simply
pointing `Stripe__SecretKey` at a `sk_test_...` key and `Stripe__WebhookSecret` at that same test
endpoint's secret — no code branch, no separate build.**

### Verdict: MANUAL PROCEDURE ONLY — test-mode key first, always

Not scripted, deliberately: it CAN'T be scripted safely against prod with a live key (each run has a
real financial/contractual side effect on the org whose token you use), and scripting a
"safe-because-test-mode" version adds little value over a short manual pass, while adding a real risk
if anyone ever points the script's env vars at prod by mistake. A human running 3 manual API calls
and eyeballing the Stripe test dashboard between each one is the appropriate amount of caution here.

1. **Before touching prod at all**, run the C# service (staging or local) with `Stripe__SecretKey` set
   to a **test**-mode secret key (`sk_test_...`) and `Stripe__PriceStarter`/`Stripe__PriceProfessional`
   set to test-mode price ids (create them once in the Stripe test dashboard if they don't exist —
   test-mode products/prices are separate from live-mode ones, per the isolation guarantee above).
2. With `Platform:BillingSelfServeEnabled=true` on that staging/test deploy, using a real staff JWT for
   a test org:
   - `POST /billing/checkout-session { plan: "starter" }` → expect `{ url }`; open it, confirm it's a
     Stripe test-mode Checkout page (test-mode pages are visibly marked); complete it with a Stripe
     test card (`4242 4242 4242 4242`); confirm the resulting `checkout.session.completed` webhook
     (§2 above) correctly activates the subscription — this is a natural point to jointly verify
     billing-webhook and billing-self-serve together, since checkout completion is exactly the event
     billing-webhook needs to handle.
   - `POST /billing/portal-session` → expect `{ url }`; open it, confirm it's the test-mode Billing
     Portal for the test customer created above.
   - `POST /billing/cancel-subscription` → expect `{ cancelAtPeriodEnd: true }`; confirm in the Stripe
     test dashboard that the test subscription now shows `cancel_at_period_end: true` (not
     immediately cancelled — `BillingSelfServeEndpoints.cs:105` comment: "Period-end only, no local
     flip").
   - Also verify the 409/412 failure paths noted in the endpoint's `.Produces(...)` annotations (e.g.
     attempting checkout again for an org that already has an active subscription) behave as
     documented, not as a 500.
3. **Only after that full pass is clean**, plan the prod flip. The critical warning, restated because
   it is the single highest-risk fact in this entire document: **flipping `BillingSelfServeEnabled` to
   `true` in prod while `Stripe__SecretKey` is a LIVE key (`sk_live_...`) makes every subsequent call
   immediately real** — a real customer clicking "Upgrade" creates a real Checkout Session against
   real Stripe, and a real customer clicking "Cancel" really cancels their real subscription (at
   period end). There is no dry-run mode once the flag is on with a live key. Do the test-mode pass
   above FIRST, on a deploy that is definitely not prod-with-a-live-key, every single time — never
   treat this as optional or skippable "since it's basically the same code as the read domains."
4. Flip during a low-traffic window; watch the first several real checkout/portal/cancel calls in
   Stripe's live dashboard and in application logs before considering the domain fully verified.

---

## Summary for whoever runs this next

| Domain                | Script                                                  | Manual steps required regardless                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| external-vendor read  | `scripts/deploy/cutover-external-vendor-read-verify.ts` | Provision + revoke a scoped test API key (2 min, via product UI, no special access)                                                                                                                        |
| external-vendor write | none — see §1b                                          | Build one disposable offer/validation via the UI; call the endpoint by hand once; revoke keys/clean up                                                                                                     |
| billing-webhook       | none — see §2                                           | Stripe CLI (`listen`+`trigger`) or Dashboard "Send test webhook" in test mode/staging first; confirm the proxy-vs-re-point question before touching prod Stripe config; monitored low-traffic prod cutover |
| billing-self-serve    | none — see §3                                           | Full manual pass with a Stripe TEST secret key against staging/local before ever flipping the prod flag with a live key                                                                                    |
