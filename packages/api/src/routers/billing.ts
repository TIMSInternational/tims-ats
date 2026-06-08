import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';

export const billingRouter = router({
  // Get current subscription / plan
  getCurrentPlan: permissionProcedure('billing', 'read').query(async ({ ctx }) => {
    return db.subscription.findUnique({
      where: { organizationId: ctx.user.organizationId },
    });
  }),

  // Get usage — REAL counts. Plan limits are not modeled yet (null), and
  // storage / API-call metering has no source yet (null) — honest unavailable,
  // never fabricated (rule #4). Limits + Stripe-backed quotas arrive in Wave 2.
  getUsage: permissionProcedure('billing', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;
    const sub = await db.subscription.findUnique({
      where: { organizationId: orgId },
      select: { currentPeriodStart: true, currentPeriodEnd: true },
    });
    const periodStart = sub?.currentPeriodStart ?? null;

    const [employees, vacancies, assessments] = await Promise.all([
      db.user.count({ where: { organizationId: orgId, isActive: true } }),
      db.vacancy.count({
        where: { organizationId: orgId, deletedAt: null, status: { notIn: ['closed', 'cancelled'] } },
      }),
      db.assessmentAssignment.count({
        where: { organizationId: orgId, ...(periodStart ? { assignedAt: { gte: periodStart } } : {}) },
      }),
    ]);

    return {
      employees: { used: employees, limit: null },
      vacancies: { used: vacancies, limit: null },
      assessments: { used: assessments, limit: null },
      storage: { usedMb: null, limitMb: null },
      apiCalls: { used: null, limit: null },
      periodStart: periodStart?.toISOString() ?? null,
      periodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
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

  // Stripe self-serve billing (checkout / customer portal / cancel) is NOT
  // wired yet — Wave 2. These throw NOT_IMPLEMENTED rather than returning a
  // fake checkout.stripe.com URL or flipping cancelledAt locally without
  // telling Stripe (which would let a customer believe they cancelled while
  // Stripe keeps billing) — rule #4. All three are currently unconsumed.
  createCheckoutSession: permissionProcedure('billing', 'update')
    .input(z.object({ plan: z.enum(['starter', 'professional', 'enterprise']) }))
    .mutation(() => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'El pago con Stripe aun no esta disponible.',
      });
    }),

  createPortalSession: permissionProcedure('billing', 'update').mutation(() => {
    throw new TRPCError({
      code: 'NOT_IMPLEMENTED',
      message: 'El portal de facturacion de Stripe aun no esta disponible.',
    });
  }),

  cancelSubscription: permissionProcedure('billing', 'update')
    .input(z.object({ reason: z.string().optional(), cancelAtPeriodEnd: z.boolean().default(true) }))
    .mutation(() => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'La cancelacion de suscripcion aun no esta disponible.',
      });
    }),
});
