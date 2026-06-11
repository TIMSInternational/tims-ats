import { TRPCError } from '@trpc/server';
import { getStripe, isBillingConfigured, planToPriceId, type CheckoutPlan } from '../lib/stripe';
import { billingRepository as repo } from '../repositories/billing.repository';

// Business logic for tenant self-serve Stripe billing. Callers gate on the
// config-presence check first; every network/DB step is reached only when Stripe
// is configured, so an unconfigured deploy fails closed with a clean error.

function assertConfigured(): void {
  if (!isBillingConfigured()) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'El pago con Stripe no esta configurado.',
    });
  }
}

// Who to attribute a billing action to. Mirrors the audit middleware: during
// impersonation the action is attributed to the real operator (id) and the
// impersonated account is recorded in metadata — never misattributed to the target.
export interface BillingAuditActor {
  id: string;
  impersonatedUserId?: string;
}

function recordAudit(
  orgId: string,
  actor: BillingAuditActor,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  return repo.recordBillingAudit({
    organizationId: orgId,
    actorId: actor.id,
    action,
    metadata: actor.impersonatedUserId
      ? { ...metadata, impersonatedUserId: actor.impersonatedUserId }
      : metadata,
  });
}

// Return URLs must be absolute. NEXT_PUBLIC_APP_URL is set in every deployed env;
// fall back to the known prod origin so a missing var never yields a relative URL
// that Stripe rejects.
function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://tims-ats.vercel.app').replace(/\/$/, '');
}

type OrgBillingContext = NonNullable<Awaited<ReturnType<typeof repo.getOrgBillingContext>>>;

// True when self-serve subscription checkout must NOT run because the org already
// has a live billing relationship — starting a new subscription would double-bill.
// Blocks BOTH a live Stripe subscription AND a paid local plan that is managed
// manually/externally (e.g. invoiced via Mercury, stripeSubscriptionId null). A
// cancelled subscription, or a trial with no Stripe subscription, is allowed.
// Pure + exported for testing.
export function blocksSelfServeCheckout(
  sub: { stripeSubscriptionId: string | null; status: string; plan: string } | null | undefined,
): boolean {
  if (!sub) return false;
  if (sub.status === 'cancelled') return false;
  if (sub.stripeSubscriptionId) return true;
  return sub.plan !== 'trial';
}

// Resolve (or lazily create) the org's Stripe Customer id. The Stripe idempotency
// key collapses concurrent/retried creates to a single Customer; the repository
// compare-and-set returns the authoritative id if another request won the race.
async function ensureCustomer(ctx: OrgBillingContext): Promise<string> {
  if (ctx.subscription?.stripeCustomerId) return ctx.subscription.stripeCustomerId;

  const customer = await getStripe().customers.create(
    {
      name: ctx.name,
      email: ctx.billingEmail ?? undefined,
      metadata: { orgId: ctx.id },
    },
    { idempotencyKey: `customer:${ctx.id}` },
  );
  return repo.setStripeCustomerIdIfAbsent(ctx.id, customer.id);
}

export const billingService = {
  isConfigured(): boolean {
    return isBillingConfigured();
  },

  // Create a Stripe Checkout Session (subscription mode) for a self-serve plan and
  // return its hosted URL. orgId is carried as client_reference_id + metadata so the
  // webhook (Slice 2) can attribute the resulting subscription back to the org.
  async createCheckoutSession(orgId: string, plan: CheckoutPlan): Promise<{ url: string }> {
    assertConfigured();
    const priceId = planToPriceId(plan);
    if (!priceId) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Plan no disponible.' });
    }

    const ctx = await repo.getOrgBillingContext(orgId);
    if (!ctx) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Organizacion no encontrada.' });
    }
    // An org with an existing billing relationship (live Stripe sub OR a paid
    // local/manually-billed plan) must change plans via the Billing Portal or sales
    // — never start a second subscription checkout (double billing).
    if (blocksSelfServeCheckout(ctx.subscription)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Ya tienes una suscripcion activa. Administra tu plan desde el portal de facturacion.',
      });
    }

    const customerId = await ensureCustomer(ctx);
    const origin = appOrigin();

    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: orgId,
        metadata: { orgId },
        subscription_data: { metadata: { orgId } },
        success_url: `${origin}/settings/billing?checkout=success`,
        cancel_url: `${origin}/settings/billing?checkout=cancelled`,
      },
      // Dedupe rapid double-clicks / retries within Stripe's 24h idempotency window.
      { idempotencyKey: `checkout:${orgId}:${plan}` },
    );

    if (!session.url) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'No se pudo crear la sesion de pago.',
      });
    }
    return { url: session.url };
  },

  // Stripe Billing Portal — the primary self-service surface for plan change /
  // payment method / cancel. Requires an existing Stripe customer (created at first
  // checkout). When STRIPE_PORTAL_CONFIGURATION_ID is set the session uses that
  // explicit configuration (cancel = at_period_end) so the portal can never offer an
  // immediate destructive cancel — otherwise it falls back to the account default.
  // Audited.
  async createPortalSession(orgId: string, actor: BillingAuditActor): Promise<{ url: string }> {
    assertConfigured();
    const ctx = await repo.getOrgBillingContext(orgId);
    const customerId = ctx?.subscription?.stripeCustomerId;
    if (!customerId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Aun no tienes una cuenta de facturacion de Stripe.',
      });
    }
    const configuration = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appOrigin()}/settings/billing`,
      ...(configuration ? { configuration } : {}),
    });
    await recordAudit(orgId, actor, 'billing.portal_opened', { customerId });
    return { url: session.url };
  },

  // Cancel via the Stripe API at PERIOD END (tenant self-service never does an
  // immediate destructive cancel — that bypasses the product warning). The webhook
  // syncs the resulting status/cancelledAt; we do not flip local state here (Stripe
  // is the source of truth — rule #4). Audited with the acting (or impersonating) user.
  async cancelSubscription(orgId: string, actor: BillingAuditActor): Promise<{ cancelAtPeriodEnd: true }> {
    assertConfigured();
    const ctx = await repo.getOrgBillingContext(orgId);
    const subscriptionId = ctx?.subscription?.stripeSubscriptionId;
    if (!subscriptionId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'No hay una suscripcion de Stripe activa para cancelar.',
      });
    }
    await getStripe().subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    await recordAudit(orgId, actor, 'billing.subscription_cancel_scheduled', {
      subscriptionId,
      cancelAtPeriodEnd: true,
    });
    return { cancelAtPeriodEnd: true };
  },
};
