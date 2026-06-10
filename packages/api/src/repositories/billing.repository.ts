import { tenantDb } from '@tims/db';

// Data access for tenant self-serve billing. Runs on the request path, so it uses
// `tenantDb` (RLS-scoped to ctx org) and still filters by explicit organizationId
// as defense in depth. Webhook-path (privileged db) reads/writes arrive in Slice 2.
export const billingRepository = {
  // Org identity + its subscription's Stripe linkage, for ensuring a Customer.
  getOrgBillingContext(orgId: string) {
    return tenantDb.organization.findFirst({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        billingEmail: true,
        subscription: {
          select: { id: true, stripeCustomerId: true, stripeSubscriptionId: true, plan: true, status: true },
        },
      },
    });
  },

  // Persist the Stripe Customer id with compare-and-set semantics: claim it only
  // while the org still has none, and return the AUTHORITATIVE id (the existing one
  // if a concurrent request already linked a customer). Never clobbers an existing
  // linkage — combined with the caller's Stripe idempotency key, concurrent
  // checkouts converge on a single customer instead of orphaning one.
  async setStripeCustomerIdIfAbsent(orgId: string, stripeCustomerId: string): Promise<string> {
    // Ensure a row exists without overwriting an existing one (update: {}).
    await tenantDb.subscription.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, stripeCustomerId },
      update: {},
    });
    // Claim only if still unset (no-op when another request already won the race).
    await tenantDb.subscription.updateMany({
      where: { organizationId: orgId, stripeCustomerId: null },
      data: { stripeCustomerId },
    });
    const row = await tenantDb.subscription.findUnique({
      where: { organizationId: orgId },
      select: { stripeCustomerId: true },
    });
    return row?.stripeCustomerId ?? stripeCustomerId;
  },
};
