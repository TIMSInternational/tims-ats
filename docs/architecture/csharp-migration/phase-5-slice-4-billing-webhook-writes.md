# Phase 5 Slice 4 — billing Stripe-webhook WRITE → C# (efcoreStranglerWrite, NOT the ownership flip)

Date: 2026-07-17 · Status: **Designed (ready to build — recommend a fresh session).** Parent: `phase-5-strangler.md`.
Off main. **Cutover deferred + dark-by-default.** This is the most complex + highest-stakes billing slice (money +
webhook signature verification + live-writer safety) — build it with full care.

## The load-bearing decision: the ownership FLIP is BLOCKED (do NOT attempt it in this slice)
To move `subscriptions`/`invoices` `prisma → efcore` (owned), C# must be the SOLE runtime writer. They are NOT
solely written by the billing router/webhook:
- **`subscriptions`** also written by: `platform/subscriptions.ts` (admin plan/status/reactivate),
  `platform/invitations.ts`, `platform/organizations.ts`, `auth/callback/route.ts` — the last three are
  `subscription.create` inside larger ORG-PROVISIONING transactions (role/entitlement create), NOT billing-domain.
- **`invoices`** also written by: `platform/invoices.ts` (create/updateStatus) + `entitlement.repository.createDraftInvoice` (usage billing).
This is the **exact `preemployment_validations` situation** (`table-ownership.md`): the table gains an
`efcoreStranglerWrite` entry (C# writes it under a dark flag = one active writer), and the flip to `efcore` is
DEFERRED until the whole write surface flips together. **So this slice = a coexistence WRITE, not a flip.**

## Slice scope (smallest coherent increment): port the Stripe webhook state-sync engine
The webhook (`apps/web/app/api/webhooks/stripe/route.ts` → `billing-webhook.service.ts` → `billing-webhook.repository.ts`)
is the subscription state-sync engine. Port it to a C# endpoint that genuinely WRITEs `subscriptions`, dark behind
a NEW `Platform:BillingWebhookWriteEnabled` (default false), Prisma keeping the DDL. Handles:
`checkout.session.completed`, `customer.subscription.created/updated/deleted`. (Invoice events are NOT Stripe-synced.)

### Increments
1. **Pure kernels + golden fixtures (build FIRST — the anti-drift foundation, low-risk):**
   `mapStripeStatus` (unknown/paused/incomplete → `past_due`, NEVER `active` — the access-safety invariant),
   `cancelledAtOf`, `mapStripeSubscriptionToFields` (plan `null` for unknown price so the repo never downgrades;
   period from `items.data[0]`), `isDuplicateSubscription`, `shouldDropEvent` (second-granularity tie only drops if
   it would un-cancel a terminal `cancelled`), `blocksSelfServeCheckout`, `priceIdToPlan`. All pure → port to
   `Tims.Domain/Billing/StripeWebhookKernel.cs` + golden-fixture BOTH stacks (`contracts/billing-fixtures/stripe-webhook-*.json`,
   asserted by the REAL TS exports — the #141 honest-fixture rule). Regression corpus: the "unknown-status→past_due
   not active" access invariant, the same-second un-cancel guard, the unknown-price no-downgrade.
2. **Webhook write repository + endpoint (the hard infra — net-new):**
   - **Signature verification:** port Stripe's HMAC-SHA256 over `t.payload` with tolerance (either the `Stripe.net`
     SDK `EventUtility.ConstructEvent`, OR a hand-rolled verifier to avoid the dependency — DECISION below). Raw-body
     endpoint (`enableBuffering`/read raw), missing/invalid sig → 400; other throw → 500 so Stripe retries.
   - **Org resolution** (`resolveOrgId`): authoritative from DB unique columns (`findOrgIdBySubscription` →
     `findOrgIdByCustomer`), `metadata.orgId`/`client_reference_id` only last-resort + log mismatch. A verified
     signature proves DELIVERY, not TENANT.
   - **`ApplySubscriptionAsync`** (the hardest invariant): a transaction taking `pg_advisory_xact_lock(hashtext(orgId))`
     (serializes concurrent deliveries even when the row doesn't exist — a `FOR UPDATE` can't lock a missing row),
     read-once → decide `duplicate`/`stale`/apply → upsert by unique `organizationId` + mirror `plan` onto
     `organizations.plan`. On `checkout` `duplicate` → cancel the NEW sub at Stripe (swallow only `resource_missing`).
   - **Privileged connection, NOT `TenantScope`** ⚠️ — the webhook carries no org GUC (Stripe isn't a tenant), so it
     runs on the privileged/BYPASSRLS role with EXPLICIT `organizationId` scoping (RLS would fail-closed). This is a
     first for the C# write plane; needs a privileged (non-`app_tenant`) DbContext, Testcontainers-proven.
   - Fail-SOFT audit (`recordBillingAudit` → `audit_logs`, best-effort) — reuse the `DataAccessAuditWriter` fail-soft idiom.
3. **Self-serve mutations (thin follow-up):** `createCheckoutSession`/`createPortalSession`/`cancelSubscription` —
   mostly Stripe outbound + `setStripeCustomerIdIfAbsent` compare-and-set (`upsert` then `updateMany where
   stripeCustomerId is null`) + fail-soft audit. Low DB-write surface; port after the webhook.

## Reuse vs net-new
- **Reuse (from #140 external-vendor write / prior slices):** the use-case shape (read-gate → atomic conditional
  write → fail-soft audit → map), `ExecuteUpdateAsync` compare-and-set as the TOCTOU/idempotency gate, the
  default-dark flag pattern (`GetDocument.Insider` for OpenAPI), the `NodeIsoDateTimeOffsetConverter`, the
  ms-truncation for `timestamp(3)`/JS-Date parity, the Domain read models (`SubscriptionV1` etc.).
- **Net-new:** Stripe signature verification, the `pg_advisory_xact_lock` per-org serialization, the raw-body
  webhook endpoint, Stripe OUTBOUND calls (retrieve/cancel with idempotency keys), and the PRIVILEGED
  (non-TenantScope) write DbContext.

## DECISION — Stripe.net SDK vs hand-rolled (recommend for the build session)
- **`Stripe.net`** gives `EventUtility.ConstructEvent` (signature) + typed events + outbound `subscriptions.retrieve/
  cancel`/`checkout`/`billingPortal` with idempotency keys — faithful, less bespoke crypto, but a NEW external
  dependency (pin + `npm audit`-equivalent). **Recommended** (signature crypto + Stripe API shapes are exactly what a
  vetted SDK should own; matches "don't hand-roll security-critical crypto").
- **Hand-rolled** avoids the dependency (HMAC-SHA256 verify is ~30 lines) but re-implements Stripe API request/response
  shapes for the outbound calls — more surface, more drift risk. Only if adding the dependency is undesirable.

## Ledger + flags
`subscriptions` gains `efcoreStranglerWrite` (currently `efcoreReadOnly`) ONLY when the webhook writer ships. New
`Platform:BillingWebhookWriteEnabled` (default false). Cutover (route Stripe's webhook → C#, canary, then delete TS
webhook) deferred. The ownership flip is a SEPARATE later milestone (port the admin + provisioning writers first).

## Regression corpus (mine the billing fix history)
mapStripeStatus access-safety (unknown≠active), same-second un-cancel guard (shouldDropEvent), duplicate-sub double-bill
prevention (isDuplicateSubscription + cancel-new), unknown-price no-downgrade, advisory-lock races (concurrent
deliveries for a not-yet-existing org row), `resource_missing`-only cancel swallow, DB-authoritative org resolution
(never trust metadata). Each pinned red-if-regressed (golden for the pure kernels; Testcontainers for the lock/write).

## Local gate
build `-c Release` 0-warn · `dotnet format` · unit + integration (Docker; advisory-lock + privileged-write proof).
Root: `node scripts/table-ownership.mjs`. TS (shared goldens): `prisma generate` → `@tims/api tsc` → `apps/web tsc` → `vitest run`.
