import { z } from 'zod';
import { router } from '../../trpc';
import { db, OrgPlan, SubscriptionStatus } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { platformProcedure } from './_common';
import { PLAN_PRICES } from '../../lib/plan-prices';

const subscriptionSelect = {
  id: true,
  organizationId: true,
  plan: true,
  status: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  trialEndsAt: true,
  cancelledAt: true,
  createdAt: true,
  organization: { select: { id: true, name: true, slug: true } },
} as const;

function computeBillingPeriod(start: Date | null, end: Date | null): 'monthly' | 'annual' | null {
  if (!start || !end) return null;
  const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays > 180 ? 'annual' : 'monthly';
}

export const subscriptionsRouter = router({
  getSubscriptionKpis: platformProcedure.query(async () => {
    const now = new Date();
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [allSubs, activeSubs, pastDueSubs, expiringTrials, prevMonthActiveSubs] = await Promise.all([
      db.subscription.count(),
      db.subscription.findMany({
        where: { status: SubscriptionStatus.active },
        select: { plan: true },
      }),
      db.subscription.count({ where: { status: SubscriptionStatus.past_due } }),
      db.subscription.findMany({
        where: {
          status: SubscriptionStatus.trialing,
          trialEndsAt: { gte: now, lte: sevenDaysFromNow },
        },
        select: {
          id: true,
          organizationId: true,
          trialEndsAt: true,
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              _count: { select: { users: { where: { isActive: true } } } },
            },
          },
        },
      }),
      db.subscription.findMany({
        where: {
          status: SubscriptionStatus.active,
          createdAt: { lte: prevMonthEnd },
        },
        select: { plan: true },
      }),
    ]);

    const mrr = activeSubs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan] || 0), 0);
    const mrrPrevMonth = prevMonthActiveSubs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan] || 0), 0);
    const mrrChangePercent = mrrPrevMonth > 0
      ? Math.round(((mrr - mrrPrevMonth) / mrrPrevMonth) * 100)
      : mrr > 0 ? 100 : 0;

    return {
      mrr,
      mrrChangePercent,
      total: allSubs,
      active: activeSubs.length,
      pastDue: pastDueSubs,
      expiringTrials: expiringTrials.map((t) => ({
        id: t.id,
        organizationId: t.organizationId,
        trialEndsAt: t.trialEndsAt,
        organization: {
          id: t.organization.id,
          name: t.organization.name,
          slug: t.organization.slug,
          activeUserCount: t.organization._count.users,
        },
      })),
    };
  }),

  listSubscriptions: platformProcedure
    .input(z.object({
      page: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(20),
      status: z.nativeEnum(SubscriptionStatus).optional(),
      plan: z.nativeEnum(OrgPlan).optional(),
      search: z.string().max(100).optional(),
      sortBy: z.enum(['orgName', 'plan', 'status', 'mrr', 'createdAt']).default('createdAt'),
      sortDirection: z.enum(['asc', 'desc']).default('desc'),
    }))
    .query(async ({ input }) => {
      const { page, limit, status, plan, search, sortBy, sortDirection } = input;

      const where: {
        status?: SubscriptionStatus;
        plan?: OrgPlan;
        organization?: { name: { contains: string; mode: 'insensitive' } };
      } = {};
      if (status) where.status = status;
      if (plan) where.plan = plan;
      if (search?.trim()) {
        where.organization = { name: { contains: search.trim(), mode: 'insensitive' } };
      }

      const orderBy = sortBy === 'orgName'
        ? { organization: { name: sortDirection } as const }
        : sortBy === 'mrr'
          ? { plan: sortDirection }
          : { [sortBy]: sortDirection };

      const [subs, total] = await Promise.all([
        db.subscription.findMany({
          where,
          take: limit,
          skip: page * limit,
          orderBy,
          select: subscriptionSelect,
        }),
        db.subscription.count({ where }),
      ]);

      const subscriptions = subs.map((sub) => ({
        ...sub,
        mrr: sub.status === SubscriptionStatus.active ? (PLAN_PRICES[sub.plan] || 0) : 0,
        billingPeriod: computeBillingPeriod(sub.currentPeriodStart, sub.currentPeriodEnd),
      }));

      return { subscriptions, total };
    }),

  updateSubscription: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      plan: z.nativeEnum(OrgPlan).optional(),
      status: z.nativeEnum(SubscriptionStatus).optional(),
      trialEndsAt: z.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const existing = await db.subscription.findUnique({
        where: { organizationId: input.organizationId },
        select: { id: true, status: true, plan: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Suscripcion no encontrada' });
      }

      const data: {
        plan?: OrgPlan;
        status?: SubscriptionStatus;
        trialEndsAt?: Date;
        cancelledAt?: Date | null;
      } = {};
      if (input.plan !== undefined) data.plan = input.plan;
      if (input.status !== undefined) {
        data.status = input.status;
        if (input.status === SubscriptionStatus.cancelled) {
          data.cancelledAt = new Date();
        }
      }
      if (input.trialEndsAt !== undefined) data.trialEndsAt = input.trialEndsAt;

      return db.subscription.update({
        where: { organizationId: input.organizationId },
        data,
        select: subscriptionSelect,
      });
    }),

  reactivateSubscription: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      const existing = await db.subscription.findUnique({
        where: { organizationId: input.organizationId },
        select: { id: true, status: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Suscripcion no encontrada' });
      }
      if (existing.status !== SubscriptionStatus.cancelled) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Solo se pueden reactivar suscripciones canceladas' });
      }

      return db.subscription.update({
        where: { organizationId: input.organizationId },
        data: { status: SubscriptionStatus.active, cancelledAt: null },
        select: subscriptionSelect,
      });
    }),

  getSubscriptionDetail: platformProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ input }) => {
      const sub = await db.subscription.findUnique({
        where: { organizationId: input.organizationId },
        select: {
          ...subscriptionSelect,
          invoices: {
            select: { id: true, amount: true, status: true, invoiceDate: true },
            orderBy: { invoiceDate: 'desc' },
            take: 5,
          },
        },
      });
      if (!sub) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Suscripcion no encontrada' });
      }

      return {
        ...sub,
        mrr: sub.status === SubscriptionStatus.active ? (PLAN_PRICES[sub.plan] || 0) : 0,
        billingPeriod: computeBillingPeriod(sub.currentPeriodStart, sub.currentPeriodEnd),
        planOptions: Object.entries(PLAN_PRICES).map(([plan, price]) => ({
          plan,
          price,
          isCurrent: plan === sub.plan,
        })),
      };
    }),

  exportSubscriptionsCsv: platformProcedure
    .input(z.object({
      status: z.nativeEnum(SubscriptionStatus).optional(),
      plan: z.nativeEnum(OrgPlan).optional(),
    }))
    .query(async ({ input }) => {
      const where: {
        status?: SubscriptionStatus;
        plan?: OrgPlan;
      } = {};
      if (input.status) where.status = input.status;
      if (input.plan) where.plan = input.plan;

      const subs = await db.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: subscriptionSelect,
      });

      const header = 'Organizacion,Plan,Estado,MRR,Periodo,Trial Vence,Creada';
      const rows = subs.map((sub) => {
        const mrr = sub.status === SubscriptionStatus.active ? (PLAN_PRICES[sub.plan] || 0) : 0;
        const period = computeBillingPeriod(sub.currentPeriodStart, sub.currentPeriodEnd) || '—';
        const trialEnd = sub.trialEndsAt ? sub.trialEndsAt.toISOString().split('T')[0] : '—';
        const created = sub.createdAt.toISOString().split('T')[0];
        const orgName = sub.organization.name.replace(/,/g, ' ');
        return `${orgName},${sub.plan},${sub.status},$${mrr},${period},${trialEnd},${created}`;
      });

      return { csv: [header, ...rows].join('\n'), count: subs.length };
    }),

  sendDunningReminder: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      message: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const sub = await db.subscription.findUnique({
        where: { organizationId: input.organizationId },
        select: {
          id: true,
          status: true,
          plan: true,
          organization: { select: { id: true, name: true, billingEmail: true } },
        },
      });
      if (!sub) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Suscripcion no encontrada' });
      }
      if (sub.status !== SubscriptionStatus.past_due) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Solo se pueden enviar recordatorios a suscripciones con pago vencido' });
      }

      await db.auditLog.create({
        data: {
          action: 'dunning_reminder_sent',
          entity: 'subscription',
          entityId: sub.id,
          organizationId: sub.organization.id,
          metadata: {
            plan: sub.plan,
            billingEmail: sub.organization.billingEmail,
            message: input.message || 'Recordatorio de pago automatico',
          },
        },
      });

      return {
        sent: true,
        orgName: sub.organization.name,
        billingEmail: sub.organization.billingEmail,
      };
    }),
});
