import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import { CHECKOUT_PLANS } from '../lib/stripe';
import { billingService, type BillingAuditActor } from '../services/billing.service';

export const billingRouter = router({
  // Stripe Checkout (subscription create) for a self-serve plan. Returns a hosted
  // checkout URL for the FE to redirect to. Fails closed when Stripe is not
  // configured (rule #4 — never a fabricated checkout.stripe.com URL).
  createCheckoutSession: permissionProcedure('billing', 'update')
    .input(z.object({ plan: z.enum(CHECKOUT_PLANS) }))
    .mutation(({ ctx, input }) => billingService.createCheckoutSession(ctx.user.organizationId, input.plan)),

  // Stripe Billing Portal (manage / cancel / payment method) — returns a hosted URL.
  createPortalSession: permissionProcedure('billing', 'update').mutation(({ ctx }) =>
    billingService.createPortalSession(ctx.user.organizationId, auditActor(ctx.user)),
  ),

  // Cancel at period end (no client-controlled immediate cancel — that destructive
  // mode is intentionally not exposed to tenant self-service). Webhook syncs state.
  cancelSubscription: permissionProcedure('billing', 'update').mutation(({ ctx }) =>
    billingService.cancelSubscription(ctx.user.organizationId, auditActor(ctx.user)),
  ),
});

// Attribute billing actions to the real operator during impersonation (mirrors the
// audit middleware): actor = impersonator if present, impersonated account in metadata.
function auditActor(user: { id: string; impersonatorId?: string | null }): BillingAuditActor {
  return user.impersonatorId ? { id: user.impersonatorId, impersonatedUserId: user.id } : { id: user.id };
}
