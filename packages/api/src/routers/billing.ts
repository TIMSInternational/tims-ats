import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import { CHECKOUT_PLANS } from '../lib/stripe';
import { billingService, type BillingAuditActor } from '../services/billing.service';

export const billingRouter = router({
  // List invoices
  listInvoices: permissionProcedure('billing', 'read')
    .input(
      z.object({
        take: z.number().min(1).max(100).default(20),
        cursor: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const items = await db.invoice.findMany({
        where: { organizationId: ctx.user.organizationId },
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        // `createdAt` alone is NOT unique — on equal timestamps Prisma cursor pagination can skip or
        // duplicate rows. The `id asc` tiebreak makes the keyset a UNIQUE total order (a shared cross-stack
        // pagination contract with the C# billing port, which uses the same [createdAt desc, id asc]).
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      const hasMore = items.length > input.take;
      return {
        items: items.slice(0, input.take),
        nextCursor: hasMore ? items[input.take - 1]!.id : undefined,
      };
    }),

  // Get single invoice
  getInvoice: permissionProcedure('billing', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.invoice.findFirstOrThrow({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: { subscription: true },
      });
    }),

  // Stripe Checkout (subscription create) for a self-serve plan. Returns a hosted
  // checkout URL for the FE to redirect to. Fails closed when Stripe is not
  // configured (rule #4 — never a fabricated checkout.stripe.com URL).
  createCheckoutSession: permissionProcedure('billing', 'update')
    .input(z.object({ plan: z.enum(CHECKOUT_PLANS) }))
    .mutation(({ ctx, input }) =>
      billingService.createCheckoutSession(ctx.user.organizationId, input.plan)
    ),

  // Stripe Billing Portal (manage / cancel / payment method) — returns a hosted URL.
  createPortalSession: permissionProcedure('billing', 'update').mutation(({ ctx }) =>
    billingService.createPortalSession(ctx.user.organizationId, auditActor(ctx.user))
  ),

  // Cancel at period end (no client-controlled immediate cancel — that destructive
  // mode is intentionally not exposed to tenant self-service). Webhook syncs state.
  cancelSubscription: permissionProcedure('billing', 'update').mutation(({ ctx }) =>
    billingService.cancelSubscription(ctx.user.organizationId, auditActor(ctx.user))
  ),
});

// Attribute billing actions to the real operator during impersonation (mirrors the
// audit middleware): actor = impersonator if present, impersonated account in metadata.
function auditActor(user: { id: string; impersonatorId?: string | null }): BillingAuditActor {
  return user.impersonatorId
    ? { id: user.impersonatorId, impersonatedUserId: user.id }
    : { id: user.id };
}
