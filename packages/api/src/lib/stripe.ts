import Stripe from 'stripe';
import type { OrgPlan } from '@tims/db';

// Stripe billing — client singleton + pure plan<->price mapping. The pure helpers
// take an explicit env object so they are unit-testable without the network or
// process.env mutation. The SDK client (getStripe) is the only network surface.
//
// Gating is config-presence (no separate flag): when the secret key and both
// self-serve price ids are absent, billing is "not configured" and the callers
// fail closed with a clean error — never a fabricated checkout URL (rule #4).

// The only plans a tenant can self-serve checkout into. `trial` is a state, not a
// purchasable price; `enterprise` is negotiated (Contact sales / platform invoice).
export const CHECKOUT_PLANS = ['starter', 'professional'] as const;
export type CheckoutPlan = (typeof CHECKOUT_PLANS)[number];

export interface StripeBillingEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_PROFESSIONAL?: string;
}

function priceEnvKey(plan: CheckoutPlan): keyof StripeBillingEnv {
  return plan === 'starter' ? 'STRIPE_PRICE_STARTER' : 'STRIPE_PRICE_PROFESSIONAL';
}

// Pull only the billing keys out of process.env (ProcessEnv has no structural
// overlap with StripeBillingEnv, so we extract explicitly rather than cast).
function defaultEnv(): StripeBillingEnv {
  return {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_PRICE_STARTER: process.env.STRIPE_PRICE_STARTER,
    STRIPE_PRICE_PROFESSIONAL: process.env.STRIPE_PRICE_PROFESSIONAL,
  };
}

// True only when the secret key AND both self-serve price ids are present.
export function isBillingConfigured(env: StripeBillingEnv = defaultEnv()): boolean {
  return Boolean(env.STRIPE_SECRET_KEY) && CHECKOUT_PLANS.every((p) => Boolean(env[priceEnvKey(p)]));
}

// Configured Stripe price id for a checkout plan, or null if not configured.
export function planToPriceId(plan: CheckoutPlan, env: StripeBillingEnv = defaultEnv()): string | null {
  const value = env[priceEnvKey(plan)];
  return value ? value : null;
}

// Reverse map (used by the webhook): a Stripe price id back to its OrgPlan, or null
// for an unknown price. An empty incoming id never resolves to a plan, even if a
// plan's configured price is also empty.
export function priceIdToPlan(priceId: string, env: StripeBillingEnv = defaultEnv()): OrgPlan | null {
  if (!priceId) return null;
  for (const plan of CHECKOUT_PLANS) {
    if (env[priceEnvKey(plan)] === priceId) return plan;
  }
  return null;
}

// An incoming subscription is a duplicate/foreign one if the org already has a
// DIFFERENT, non-cancelled subscription. Used (inside the org-locked transaction) to
// cancel a duplicate at checkout AND to ignore later events for that duplicate, so
// they never overwrite the good subscription with the cancelled duplicate's state.
export function isDuplicateSubscription(
  existing: { stripeSubscriptionId: string | null; status: string } | null | undefined,
  incomingSubscriptionId: string,
): boolean {
  return (
    Boolean(existing?.stripeSubscriptionId) &&
    existing!.stripeSubscriptionId !== incomingSubscriptionId &&
    existing!.status !== 'cancelled'
  );
}

// Decide whether to DROP an incoming subscription event as stale/regressive.
// event.created is second-granularity, so a tie does NOT mean "duplicate":
//   - strictly newer  → apply (false)
//   - strictly older  → drop  (true)
//   - same second     → drop ONLY if it would un-cancel a terminal cancelled state
//     (so an out-of-order same-second `updated(active)` cannot reactivate a
//     `deleted(cancelled)`), otherwise apply (e.g. created→updated, or →cancelled).
// Exact retries re-apply idempotently (the upsert writes identical values).
export function shouldDropEvent(
  current: { status: string; lastStripeEventAt: Date | null } | null | undefined,
  incomingStatus: string,
  eventAt: Date,
): boolean {
  const lastAt = current?.lastStripeEventAt ?? null;
  if (!lastAt) return false;
  const last = lastAt.getTime();
  const incoming = eventAt.getTime();
  if (incoming > last) return false;
  if (incoming < last) return true;
  return current!.status === 'cancelled' && incomingStatus !== 'cancelled';
}

let client: Stripe | null = null;

// Lazy Stripe client singleton. Throws a plain Error (services translate to a tRPC
// error) when the secret key is absent — callers must gate on isBillingConfigured first.
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is missing');
  }
  if (!client) {
    client = new Stripe(key);
  }
  return client;
}

// Verify + parse a Stripe webhook payload. Throws when the signing secret or the
// signature header is missing, or when the signature does not verify — the caller
// turns any throw into a 400 (never process an unverified event). Uses the raw
// request body string exactly as received.
export function constructWebhookEvent(rawBody: string, signature: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('Stripe webhook secret is not configured');
  if (!signature) throw new Error('Missing Stripe-Signature header');
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}
