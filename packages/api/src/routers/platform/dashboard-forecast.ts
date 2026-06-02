import { router } from '../../trpc';
import { db, SubscriptionStatus } from '@tims/db';
import { platformProcedure } from './_common';
import { PLAN_PRICES } from '../../lib/plan-prices';

export const dashboardForecastRouter = router({
  getMrrForecast: platformProcedure.query(async () => {
    // Build 12 months of historical MRR
    const historical: { month: string; mrr: number; type: 'historical' }[] = [];

    for (let i = 11; i >= 0; i--) {
      const start = new Date();
      start.setMonth(start.getMonth() - i, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);

      const subs = await db.subscription.findMany({
        where: { status: SubscriptionStatus.active, createdAt: { lt: end } },
        select: { plan: true },
      });
      const mrr = subs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan] || 0), 0);

      historical.push({
        month: start.toLocaleDateString('es', { month: 'short', year: '2-digit' }),
        mrr,
        type: 'historical',
      });
    }

    // Calculate average month-over-month growth rate from non-zero months
    const nonZero = historical.filter((m) => m.mrr > 0);
    let avgGrowthRate = 0;
    if (nonZero.length >= 2) {
      const growthRates: number[] = [];
      for (let i = 1; i < nonZero.length; i++) {
        if (nonZero[i - 1].mrr > 0) {
          growthRates.push((nonZero[i].mrr - nonZero[i - 1].mrr) / nonZero[i - 1].mrr);
        }
      }
      if (growthRates.length > 0) {
        avgGrowthRate = growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
      }
    }

    // Cap growth between -20% and +30% per month for realistic forecast
    avgGrowthRate = Math.max(-0.2, Math.min(0.3, avgGrowthRate));

    // Project 12 months forward
    const currentMrr = historical[historical.length - 1].mrr;
    const projected: { month: string; mrr: number; type: 'projected' }[] = [];

    for (let i = 1; i <= 12; i++) {
      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + i, 1);
      const projectedMrr = Math.round(currentMrr * Math.pow(1 + avgGrowthRate, i));

      projected.push({
        month: futureDate.toLocaleDateString('es', { month: 'short', year: '2-digit' }),
        mrr: projectedMrr,
        type: 'projected',
      });
    }

    // Key metrics
    const projectedMrr12m = projected[projected.length - 1].mrr;
    const projectedArr = projectedMrr12m * 12;
    const monthlyGrowthPct = Math.round(avgGrowthRate * 100 * 10) / 10;

    // Count current subscribers by plan for breakdown
    const currentSubs = await db.subscription.findMany({
      where: { status: SubscriptionStatus.active },
      select: { plan: true },
    });
    const planBreakdown: Record<string, { count: number; mrr: number }> = {};
    for (const s of currentSubs) {
      const price = PLAN_PRICES[s.plan] || 0;
      if (!planBreakdown[s.plan]) planBreakdown[s.plan] = { count: 0, mrr: 0 };
      planBreakdown[s.plan].count += 1;
      planBreakdown[s.plan].mrr += price;
    }

    // Pending upgrades — trials that could convert
    const pendingTrials = await db.subscription.count({
      where: { status: SubscriptionStatus.trialing },
    });
    const potentialMrrFromTrials = pendingTrials * (PLAN_PRICES.starter || 499);

    return {
      historical,
      projected,
      currentMrr,
      projectedMrr12m,
      projectedArr,
      monthlyGrowthPct,
      planBreakdown,
      pendingTrials,
      potentialMrrFromTrials,
    };
  }),
});
