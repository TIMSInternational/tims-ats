import type Stripe from 'stripe';
import { logger } from '@tims/shared';
import type { SubscriptionStatus } from '@tims/db';
import { constructWebhookEvent, getStripe, priceIdToPlan, type StripeBillingEnv } from '../lib/stripe';
import {
  billingWebhookRepository as repo,
  type SubscriptionSyncFields,
} from '../repositories/billing-webhook.repository';
import { isPlatformApiEnabled, platformPostRaw } from '../lib/platform-api-client';

// ── Verification error ──────────────────────────────────────────────────────
// Thrown for any signature/secret/header failure. The route maps it to 400 (an
// unverified event is never processed); all other errors map to 500.
export class WebhookVerificationError extends Error {}

export function isWebhookVerificationError(err: unknown): err is WebhookVerificationError {
  return err instanceof WebhookVerificationError;
}

// ── Pure mappers (unit-tested without the network) ──────────────────────────

// Minimal structural shape so tests pass plain fixtures and production passes a
// real Stripe.Subscription. In recent API versions the billing period lives on the
// subscription ITEM, not the subscription — so we read it from items.data[0].
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  canceled_at: number | null;
  items: { data: Array<{ price: { id: string | null }; current_period_start: number; current_period_end: number }> };
}

// Map a Stripe subscription status to our enum. Anything risky/unknown maps to
// past_due — it must NEVER read as `active` (which would grant access).
export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'paused':
    default:
      return 'past_due';
  }
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;
}

function cancelledAtOf(sub: StripeSubscriptionLike): Date | null {
  if (sub.canceled_at) return toDate(sub.canceled_at);
  if (sub.cancel_at_period_end && sub.cancel_at) return toDate(sub.cancel_at);
  return null;
}

// Project a Stripe subscription onto our Subscription fields. plan is null for an
// unknown price so the repository never downgrades on an unrecognized price.
export function mapStripeSubscriptionToFields(
  sub: StripeSubscriptionLike,
  env?: StripeBillingEnv,
): SubscriptionSyncFields {
  const item = sub.items.data[0];
  const priceId = item?.price.id ?? null;
  return {
    stripeSubscriptionId: sub.id,
    plan: priceId ? priceIdToPlan(priceId, env) : null,
    status: mapStripeStatus(sub.status),
    currentPeriodStart: item ? toDate(item.current_period_start) : null,
    currentPeriodEnd: item ? toDate(item.current_period_end) : null,
    cancelledAt: cancelledAtOf(sub),
  } satisfies SubscriptionSyncFields;
}

// Re-exported from lib/stripe so the repository (which decides them under the org
// lock) and the tests share one definition without a circular import.
export { isDuplicateSubscription, shouldDropEvent } from '../lib/stripe';

// ── Event handlers (network/DB) ─────────────────────────────────────────────

function customerIdOf(customer: string | { id: string } | null): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

// Stripe `resource_missing` = the subscription no longer exists (already cancelled /
// deleted) — the ONLY genuinely-idempotent cancel error to swallow. Every other
// failure (transient, rate-limit, auth) must propagate so the route 500s and Stripe
// retries the webhook, re-attempting the cancel (a swallowed failure would leave the
// duplicate billable).
function isAlreadyGoneError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'resource_missing';
}

// Resolve the owning org AUTHORITATIVELY by Stripe ownership, never by attacker- or
// stale-metadata. A signature verifies delivery, not tenant authorization — so the
// subscription/customer linkage we recorded (unique columns) wins. metadata.orgId is
// only trusted as a last resort when no linkage exists yet (the first checkout link),
// and a mismatch against the recorded owner is logged and never followed.
async function resolveOrgId(
  customerId: string | null,
  subscriptionId: string | null,
  metaOrgId: string | undefined,
): Promise<string | null> {
  if (subscriptionId) {
    const bySub = await repo.findOrgIdBySubscription(subscriptionId);
    if (bySub) {
      if (metaOrgId && metaOrgId !== bySub) {
        logger.warn(
          { subscriptionId, metaOrgId, owner: bySub },
          'stripe webhook: metadata orgId mismatch (subscription)',
        );
      }
      return bySub;
    }
  }
  if (customerId) {
    const byCust = await repo.findOrgIdByCustomer(customerId);
    if (byCust) {
      if (metaOrgId && metaOrgId !== byCust) {
        logger.warn({ customerId, metaOrgId, owner: byCust }, 'stripe webhook: metadata orgId mismatch (customer)');
      }
      return byCust;
    }
  }
  return metaOrgId ?? null;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, eventAt: Date): Promise<boolean> {
  const customerId = customerIdOf(session.customer);
  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null);
  const metaOrgId = session.metadata?.orgId ?? session.client_reference_id ?? undefined;

  const orgId = await resolveOrgId(customerId, subscriptionId, metaOrgId);
  if (!orgId) {
    logger.warn({ sessionId: session.id }, 'stripe webhook: checkout.session.completed without resolvable orgId');
    return false;
  }

  if (!subscriptionId) {
    if (customerId) await repo.linkCustomer(orgId, customerId);
    return true;
  }

  // applySubscription decides duplicate/stale/applied ATOMICALLY under the org lock.
  // Single-subscription enforcement (Slice-1 finding): on 'duplicate' the org already
  // has a different live subscription, so cancel the NEW one at Stripe (no double bill).
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const outcome = await repo.applySubscription(orgId, customerId, mapStripeSubscriptionToFields(sub), eventAt);
  if (outcome === 'duplicate') {
    logger.warn({ orgId, duplicate: subscriptionId }, 'stripe webhook: cancelling duplicate subscription');
    // Swallow ONLY the already-gone case; re-throw anything else so the route 500s
    // and Stripe retries the cancel (never leave the duplicate silently billable).
    try {
      await getStripe().subscriptions.cancel(subscriptionId);
    } catch (err) {
      if (!isAlreadyGoneError(err)) throw err;
      logger.warn({ orgId, duplicate: subscriptionId }, 'stripe webhook: duplicate already cancelled');
    }
  }
  return outcome === 'applied';
}

async function handleSubscriptionEvent(sub: Stripe.Subscription, eventAt: Date): Promise<boolean> {
  const customerId = customerIdOf(sub.customer);
  const orgId = await resolveOrgId(customerId, sub.id, sub.metadata?.orgId);
  if (!orgId) {
    logger.warn({ subId: sub.id }, 'stripe webhook: subscription event without resolvable orgId');
    return false;
  }

  // 'duplicate' = an event for a subscription that is NOT the org's current live one
  // (e.g. a duplicate we cancelled); applySubscription writes nothing so it can't
  // overwrite the good subscription. 'stale' = older out-of-order delivery, dropped.
  const outcome = await repo.applySubscription(orgId, customerId, mapStripeSubscriptionToFields(sub), eventAt);
  if (outcome !== 'applied') {
    logger.warn({ orgId, incoming: sub.id, outcome }, 'stripe webhook: subscription event not applied');
  }
  return outcome === 'applied';
}

export interface WebhookResult {
  received: true;
  type: string;
  handled: boolean;
}

// Dark per-surface cutover flag (Phase-5 Slice 4) — SERVER-ONLY, same rationale as
// EXTERNAL_VENDOR_WRITE_VIA_CSHARP: Stripe calls this route directly (no browser is ever
// involved), so the decision is made entirely server-side. Mirrors the C# side's own
// `Platform:BillingWebhookWriteEnabled` flag. DEFAULT false (dark).
const BILLING_WEBHOOK_WRITE_VIA_CSHARP = process.env.BILLING_WEBHOOK_WRITE_VIA_CSHARP === 'true';

// Proxies the webhook to the C# `POST /billing/webhooks/stripe` endpoint, forwarding the RAW body
// and Stripe-Signature header VERBATIM — the HMAC is verified over the exact bytes Stripe sent, so
// re-serializing a parsed body (as platformPostWithAuth does) would break verification. Maps the
// C# endpoint's status contract back onto this function's (route.ts's) existing error contract:
// 400 → WebhookVerificationError (never processed, matching the TS-path throw); anything else
// non-200 → a generic Error (the route's catch-all already produces the correct 500 JSON response
// regardless of message content); 200 → the parsed WebhookResult (camelCase-identical to the C#
// `WebhookResult(bool Received, string Type, bool Handled)` record).
async function handleStripeWebhookViaCSharp(rawBody: string, signature: string | null): Promise<WebhookResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signature) headers['Stripe-Signature'] = signature;

  const { status, text } = await platformPostRaw('/billing/webhooks/stripe', headers, rawBody);
  if (status === 400) {
    throw new WebhookVerificationError('Invalid signature');
  }
  if (status !== 200) {
    throw new Error(`billing webhook via C# platform service failed: ${status}`);
  }
  return JSON.parse(text) as WebhookResult;
}

// Verify + dispatch a Stripe webhook. Verification failures throw
// WebhookVerificationError (→ 400); handler failures propagate (→ 500).
export async function handleStripeWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
  if (isPlatformApiEnabled() && BILLING_WEBHOOK_WRITE_VIA_CSHARP) {
    return handleStripeWebhookViaCSharp(rawBody, signature);
  }

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    throw new WebhookVerificationError(err instanceof Error ? err.message : 'verification failed');
  }

  // event.created is the canonical ordering signal for stale-delivery dropping.
  const eventAt = new Date(event.created * 1000);

  let handled = false;
  switch (event.type) {
    case 'checkout.session.completed':
      handled = await handleCheckoutCompleted(event.data.object, eventAt);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      handled = await handleSubscriptionEvent(event.data.object, eventAt);
      break;
    default:
      handled = false;
  }

  return { received: true, type: event.type, handled };
}
