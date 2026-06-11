import { db, type OrgPlan, type SubscriptionStatus } from '@tims/db';
import { isDuplicateSubscription, shouldDropEvent } from '../lib/stripe';

// Outcome of applying a Stripe event to an org's subscription, decided atomically
// under the org lock so the caller can react (cancel a duplicate at Stripe).
export type ApplyOutcome = 'applied' | 'stale' | 'duplicate';

// Data access for the Stripe webhook. Runs with NO tenant session (Stripe calls
// carry no org context), so it uses the privileged `db` and resolves/scopes every
// write by an explicit organizationId — mirroring the cron repository. Never uses
// tenantDb (whose RLS GUC is unset here and would fail closed).

export interface SubscriptionSyncFields {
  stripeSubscriptionId: string;
  plan: OrgPlan | null; // null = unknown price; do not change the stored plan
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
}

export const billingWebhookRepository = {
  // Authoritative org owner of a Stripe customer (stripeCustomerId is unique).
  async findOrgIdByCustomer(customerId: string): Promise<string | null> {
    const row = await db.subscription.findUnique({
      where: { stripeCustomerId: customerId },
      select: { organizationId: true },
    });
    return row?.organizationId ?? null;
  },

  // Authoritative org owner of a Stripe subscription (stripeSubscriptionId is unique).
  async findOrgIdBySubscription(subscriptionId: string): Promise<string | null> {
    const row = await db.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      select: { organizationId: true },
    });
    return row?.organizationId ?? null;
  },

  // Apply a Stripe event to the org's subscription ATOMICALLY and return the outcome.
  // A transaction-level advisory lock keyed by the org serializes ALL concurrent
  // webhook deliveries for that org — even when the row does not exist yet (FOR UPDATE
  // can't lock a missing row; the advisory lock can). Under that lock we read the
  // current row once and decide:
  //   - 'duplicate' → a different non-cancelled subscription already owns this org;
  //     write nothing (caller cancels the incoming sub at Stripe). Prevents double billing.
  //   - 'stale'     → this event is older than the last applied; write nothing.
  //   - 'applied'   → upsert the row + mirror the plan onto Organization.
  // Idempotent (keyed by unique organizationId); plan written only when known.
  async applySubscription(
    orgId: string,
    stripeCustomerId: string | null,
    fields: SubscriptionSyncFields,
    eventAt: Date,
  ): Promise<ApplyOutcome> {
    const planUpdate = fields.plan ? { plan: fields.plan } : {};
    return db.$transaction(async (tx) => {
      // Serialize concurrent webhook tx for this org (parameterized — no injection).
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`;

      const current = await tx.subscription.findUnique({
        where: { organizationId: orgId },
        select: { stripeSubscriptionId: true, status: true, lastStripeEventAt: true },
      });

      if (isDuplicateSubscription(current, fields.stripeSubscriptionId)) {
        return 'duplicate';
      }
      if (shouldDropEvent(current, fields.status, eventAt)) {
        return 'stale';
      }

      await tx.subscription.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          ...(stripeCustomerId ? { stripeCustomerId } : {}),
          stripeSubscriptionId: fields.stripeSubscriptionId,
          status: fields.status,
          ...planUpdate,
          currentPeriodStart: fields.currentPeriodStart,
          currentPeriodEnd: fields.currentPeriodEnd,
          cancelledAt: fields.cancelledAt,
          lastStripeEventAt: eventAt,
        },
        update: {
          ...(stripeCustomerId ? { stripeCustomerId } : {}),
          stripeSubscriptionId: fields.stripeSubscriptionId,
          status: fields.status,
          ...planUpdate,
          currentPeriodStart: fields.currentPeriodStart,
          currentPeriodEnd: fields.currentPeriodEnd,
          cancelledAt: fields.cancelledAt,
          lastStripeEventAt: eventAt,
        },
      });
      if (fields.plan) {
        await tx.organization.update({ where: { id: orgId }, data: { plan: fields.plan } });
      }
      return 'applied';
    });
  },

  // Link a Stripe customer id to an org (checkout completed, no subscription detail).
  async linkCustomer(orgId: string, stripeCustomerId: string): Promise<void> {
    await db.subscription.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, stripeCustomerId },
      update: { stripeCustomerId },
    });
  },
};
