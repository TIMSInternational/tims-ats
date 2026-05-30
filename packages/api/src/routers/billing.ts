import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { db } from '@tims/db';

export const billingRouter = router({
  // Get current subscription / plan
  getCurrentPlan: permissionProcedure('billing', 'read').query(async ({ ctx }) => {
    return db.subscription.findUnique({
      where: { organizationId: ctx.user.organizationId },
    });
  }),

  // Get usage — stub with mock data
  getUsage: permissionProcedure('billing', 'read').query(async () => {
    return {
      employees: { used: 42, limit: 100 },
      vacancies: { used: 8, limit: 25 },
      assessments: { used: 156, limit: 500 },
      storage: { usedMb: 2340, limitMb: 10000 },
      apiCalls: { used: 12400, limit: 50000 },
      periodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }),

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
        orderBy: { createdAt: 'desc' },
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

  // Create checkout session — stub
  createCheckoutSession: permissionProcedure('billing', 'update')
    .input(
      z.object({
        plan: z.enum(['starter', 'professional', 'enterprise']),
      })
    )
    .mutation(async () => {
      // Stub — would create a Stripe Checkout session
      return {
        url: 'https://checkout.stripe.com/stub-session-id',
        sessionId: 'cs_stub_placeholder',
      };
    }),

  // Create portal session — stub
  createPortalSession: permissionProcedure('billing', 'update').mutation(async () => {
    // Stub — would create a Stripe Customer Portal session
    return {
      url: 'https://billing.stripe.com/stub-portal-session',
    };
  }),

  // Cancel subscription — stub
  cancelSubscription: permissionProcedure('billing', 'update')
    .input(
      z.object({
        reason: z.string().optional(),
        cancelAtPeriodEnd: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx }) => {
      // Stub — would call Stripe to cancel
      await db.subscription.update({
        where: { organizationId: ctx.user.organizationId },
        data: { cancelledAt: new Date() },
      });
      return { cancelled: true };
    }),
});
