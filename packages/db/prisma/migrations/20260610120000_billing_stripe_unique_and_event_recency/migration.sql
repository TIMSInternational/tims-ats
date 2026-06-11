-- Wave 2 Stripe billing — make Stripe customer/subscription ids unique (one customer
-- per org, one row per subscription) so the webhook resolves ownership authoritatively,
-- and add a last-processed-event timestamp so stale/out-of-order webhook deliveries are
-- dropped instead of regressing newer state. Additive + reversible; NULLs remain
-- distinct under Postgres unique, so unlinked rows are unaffected. Idempotent guards.

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "last_stripe_event_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_customer_id_key"
  ON "subscriptions"("stripe_customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_subscription_id_key"
  ON "subscriptions"("stripe_subscription_id");
