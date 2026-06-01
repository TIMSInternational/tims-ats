import { z } from 'zod';
import { router } from '../../trpc';
import { db, OrgPlan, SubscriptionStatus } from '@tims/db';
import { platformProcedure } from './_common';

export const subscriptionsRouter = router({
  getSubscriptionKpis: platformProcedure.query(async () => {
    const prices: Record<string, number> = { trial: 0, starter: 499, professional: 999, enterprise: 2499 };

    const [allSubs, activeSubs, trialingSubs, pastDueSubs, expiringTrials] = await Promise.all([
      db.subscription.count(),
      db.subscription.count({ where: { status: SubscriptionStatus.active } }),
      db.subscription.count({ where: { status: SubscriptionStatus.trialing } }),
      db.subscription.count({ where: { status: SubscriptionStatus.past_due } }),
      db.subscription.findMany({
        where: {
          status: SubscriptionStatus.trialing,
          trialEndsAt: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        },
        include: { organization: { select: { id: true, name: true, slug: true } } },
      }),
    ]);

    const activeSubsForMrr = await db.subscription.findMany({
      where: { status: SubscriptionStatus.active },
      select: { plan: true },
    });
    const mrr = activeSubsForMrr.reduce((sum, s) => sum + (prices[s.plan] || 0), 0);

    return {
      mrr,
      total: allSubs,
      active: activeSubs,
      trialing: trialingSubs,
      pastDue: pastDueSubs,
      expiringTrials,
    };
  }),

  listSubscriptions: platformProcedure
    .input(z.object({
      page: z.number().int().min(0).default(0),
      limit: z.number().min(1).max(50).default(20),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { page, limit, status } = input;
      const where: any = {};
      if (status) where.status = status;

      const [subs, total] = await Promise.all([
        db.subscription.findMany({
          where,
          take: limit,
          skip: page * limit,
          orderBy: { createdAt: 'desc' },
          include: {
            organization: { select: { id: true, name: true, slug: true } },
          },
        }),
        db.subscription.count({ where }),
      ]);

      return { subscriptions: subs, total };
    }),

  updateSubscription: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      plan: z.nativeEnum(OrgPlan).optional(),
      status: z.nativeEnum(SubscriptionStatus).optional(),
      trialEndsAt: z.date().optional(),
    }))
    .mutation(async ({ input }) => {
      return db.subscription.update({
        where: { organizationId: input.organizationId },
        data: {
          ...(input.plan !== undefined && { plan: input.plan }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.trialEndsAt !== undefined && { trialEndsAt: input.trialEndsAt }),
        },
      });
    }),
});
