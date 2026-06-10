# Wave 2 — Real Stripe Billing (design)

> Status: APPROVED (decisions locked Jun 10 2026). Built & verified in **Stripe test
> mode**; live keys/price IDs are a config handoff. Supersedes the Wave 0 stubs in
> `packages/api/src/routers/billing.ts` that throw `NOT_IMPLEMENTED`.

## Goal

Turn the tenant billing surface from stubs into real, self-serve Stripe billing:
checkout (subscription create), Stripe Billing Portal (manage/cancel/payment method),
webhook-driven subscription-status sync, and plan-limited usage metering. No fabricated
URLs or local-only state changes — every customer-visible billing fact is backed by
Stripe or honestly `null`.

## Decisions (Federico, Jun 10)

1. **Plans with self-serve checkout:** `starter` + `professional`. `enterprise` =
   "Contact sales" (negotiated, billed via the existing platform invoice flow). `trial`
   is a state, not a purchasable price.
2. **Tenant billing UI:** build a minimal self-serve page this wave (current plan +
   usage, plan cards → checkout, Manage billing → portal). No endpoint without a consumer.
3. **Gating:** **config-presence**, not a separate flag. Endpoints fail-closed with a
   clean error when `STRIPE_SECRET_KEY` is absent; the UI hides Upgrade/Manage via a
   billing-configured capability check. Mirrors how Turnstile is "enforced only when keys
   are set." Prod stays safe until keys are added.
4. **Manage flow:** Stripe **Billing Portal** is the primary self-service surface for
   cancel / plan-change / payment-method. `cancelSubscription` stays as a thin
   convenience endpoint (`cancel_at_period_end` via API); the webhook syncs the result.

## Stripe objects → our models (no schema change expected)

| Stripe object              | Our model / field                                              | Notes |
|----------------------------|---------------------------------------------------------------|-------|
| Customer                   | `Subscription.stripeCustomerId` (1 per Organization)          | created lazily at first checkout |
| Subscription               | `Subscription.stripeSubscriptionId`, `plan`, `status`, `currentPeriodStart/End`, `cancelledAt`, `trialEndsAt` | source of truth = Stripe; we mirror |
| Price (recurring)          | env `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PROFESSIONAL`      | reverse map price→plan for webhook |
| Checkout Session (mode=subscription) | —                                                   | returns hosted URL; FE redirects |
| Billing Portal Session     | —                                                             | hosted manage/cancel/payment-method |
| Invoice                    | existing `Invoice` (`stripeInvoiceId`)                        | mirror on `invoice.paid` — DEFERRED to a later slice (optional) |

`Organization.plan` is also mirrored from `Subscription.plan` (it's read in other
surfaces). `SubscriptionStatus` enum already matches Stripe lifecycle:
`trialing → active → past_due → cancelled`.

## Endpoints (tRPC, tenant-facing, `permissionProcedure('billing', …)`)

- `getCurrentPlan` (read) — exists. Returns the org Subscription.
- `getUsage` (read) — exists; Wave-2 adds plan **limits** (Slice 4).
- `getBillingConfig` (read) — **new, tiny**: `{ configured: boolean }` so the UI knows
  whether to render Upgrade/Manage. Never leaks keys.
- `createCheckoutSession({ plan })` (update) — ensure Stripe Customer for org → create
  Checkout Session (mode=subscription, line item = price for plan, `client_reference_id =
  orgId`, `metadata.orgId`, success/cancel URLs back to the billing page) → `{ url }`.
- `createPortalSession()` (update) — requires existing `stripeCustomerId` → Billing
  Portal session → `{ url }`.
- `cancelSubscription({ cancelAtPeriodEnd })` (update) — `subscriptions.update(...,
  cancel_at_period_end)` via API; webhook syncs `cancelledAt`/`status`.

All three mutations throw a clean `PRECONDITION_FAILED` / `NOT_IMPLEMENTED`-style error
("billing not configured") when Stripe keys are absent — fail-closed, never fake.

## Webhook — `apps/web/app/api/webhooks/stripe/route.ts`

Mirrors the cron route pattern (`app/api/cron/evaluate-alerts/route.ts`) but with Stripe
signature verification instead of a Bearer secret.

- **POST, raw body** (`req.text()`), `stripe.webhooks.constructEvent(body, sig,
  STRIPE_WEBHOOK_SECRET)`. Bad/missing signature → **400, fail-closed**. Missing
  `STRIPE_WEBHOOK_SECRET` → 400 (never process unverified events).
- Uses the **privileged `db`** (NOT `tenantDb`): Stripe calls carry no tenant session.
  We resolve the org from the event (`metadata.orgId` / `client_reference_id`, then
  `stripeCustomerId`) and scope every write by that explicit `organizationId` — exactly
  the cron repository's privileged-db pattern.
- Events handled:
  - `checkout.session.completed` → link `stripeCustomerId` + `stripeSubscriptionId` to
    the org Subscription; set `plan` (from price), `status`, period dates.
  - `customer.subscription.updated` → sync `status`, `plan` (from price),
    `currentPeriodStart/End`, `cancel_at_period_end` → `cancelledAt`.
  - `customer.subscription.deleted` → `status = cancelled`.
  - (later/optional) `invoice.paid` / `invoice.payment_failed` → mirror `Invoice`,
    `past_due` handling.
- **Idempotent:** re-delivered events are safe — writes are upserts keyed by
  org / `stripeSubscriptionId`. Pure `mapStripeSubscriptionToFields(stripeSub)` and
  `priceIdToPlan(priceId)` are unit-tested without the network.
- **Single-subscription enforcement (carries Slice-1 codex finding):** `checkout.session.completed`
  MUST dedupe — if the org already has a different live `stripeSubscriptionId`, the
  handler cancels the newly-created duplicate at Stripe (or refuses to overwrite) so an
  org ends with exactly one subscription. This is the durable fix for the cross-plan /
  multi-tab concurrent-checkout race that the pre-checkout guard in Slice 1 cannot fully
  close (Slice 1 records no subscription, so the guard is inert until this lands). Add a
  unit test for "second completed session for an already-subscribed org → duplicate
  cancelled."

Exported as `handleStripeWebhook(rawBody, signature)` from the `@tims/api` barrel
(`root.ts`), so the Next route stays thin (mirrors `evaluateAlertRules`).

## Config (`apps/web/lib/env.ts` + `packages/api/src/lib/stripe.ts`)

New **optional** env vars (absent ⇒ local/preview don't crash; endpoints fail-closed):

```
STRIPE_SECRET_KEY            sk_test_… (live = handoff)
STRIPE_WEBHOOK_SECRET        whsec_…
STRIPE_PRICE_STARTER         price_…
STRIPE_PRICE_PROFESSIONAL    price_…
NEXT_PUBLIC_APP_URL          (already present) — checkout/portal return URLs
```

`packages/api/src/lib/stripe.ts`: lazy `getStripe()` singleton (throws clean error if no
key), `isBillingConfigured()`, `planToPriceId(plan)`, `priceIdToPlan(priceId)`. The pure
maps + config gate are the TDD targets.

## Clean-architecture placement

```
packages/api/src/lib/stripe.ts          → Stripe client singleton + plan↔price maps (pure)
packages/api/src/services/billing.service.ts     → ensureCustomer / createCheckout /
                                                    createPortal / cancel / applyWebhookEvent
packages/api/src/repositories/billing.repository.ts → Subscription/Org reads+writes
                                                    (tenantDb on request path; privileged
                                                    db on webhook path, org-scoped)
packages/api/src/routers/billing.ts      → thin: Zod → service → return
```

## Plan limits (Slice 4)

A per-plan limit map in `@tims/shared` keyed by `OrgPlan` (e.g. `employees`, `vacancies`,
`assessments`). `getUsage` resolves the org's plan → limits. `storage` / `apiCalls` stay
`null` (no metering source — honest, rule #4). Enforcement (blocking at limit) is a
follow-up, not this wave.

## Vertical slices (each = own PR via /gate + codex review, deploy+smoke after merge)

1. **Foundation + checkout + minimal UI** — stripe dep, `lib/stripe.ts` (TDD maps), env,
   `ensureCustomer` + `createCheckoutSession`, `getBillingConfig`, tenant billing page.
2. **Webhook sync** — webhook route + `applyWebhookEvent` (the sync brain) + TDD on pure
   event→state mapping. (Most security-sensitive: signature verification + privileged db.)
3. **Portal + cancel** — `createPortalSession` + `cancelSubscription` + Manage/cancel UI.
4. **Plan limits** — shared limit map + `getUsage` limits + usage bars.

> Between slice 1 and slice 2 merging, a completed test-mode checkout won't sync back
> until the webhook lands (slice 2). Acceptable: test-mode only; the whole wave deploys
> together at the B2+Wave-2 handoff, not incrementally to prod.

## Verification reality

Unit tests + `tsc` + build + gitleaks gate every slice locally (CI billing-down). Pure
logic (price↔plan maps, config gate, webhook event→state) is fully unit-tested.
**End-to-end Stripe-network verification** (real Checkout redirect, real webhook delivery
via Stripe CLI `stripe listen`) requires **test-mode keys** — provided either now (to
verify each slice live) or folded into the deploy handoff alongside the live keys.

## Deploy handoff (added to deploy checklist)

Before the first prod deploy that includes Wave 2:
1. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`,
   `STRIPE_PRICE_PROFESSIONAL` in Vercel prod (test → live at go-live).
2. Register the webhook endpoint (`/api/webhooks/stripe`) in the Stripe dashboard for the
   three subscription events; copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Note: this rides on the **B2 deploy handoff** (service-role key + backfill) — Wave 2
   does not change that ordering.
