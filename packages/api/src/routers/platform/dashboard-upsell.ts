import { router } from '../../trpc';
import { db, SubscriptionStatus } from '@tims/db';
import { platformProcedure } from './_common';
import { PLAN_PRICES } from '../../lib/plan-prices';

const UPSELL_RULES = {
  starter_to_professional: {
    minUsers: 8,
    minFeatures: 5,
    targetPlan: 'professional' as const,
    currentPlan: 'starter' as const,
    mrrIncrease: (PLAN_PRICES.professional ?? 999) - (PLAN_PRICES.starter ?? 499),
  },
  professional_to_enterprise: {
    minUsers: 20,
    minFeatures: 8,
    targetPlan: 'enterprise' as const,
    currentPlan: 'professional' as const,
    mrrIncrease: (PLAN_PRICES.enterprise ?? 2499) - (PLAN_PRICES.professional ?? 999),
  },
  trial_to_starter: {
    minUsers: 3,
    minFeatures: 2,
    targetPlan: 'starter' as const,
    currentPlan: 'trial' as const,
    mrrIncrease: PLAN_PRICES.starter ?? 499,
  },
};

export const dashboardUpsellRouter = router({
  getUpsellOpportunities: platformProcedure.query(async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const orgs = await db.organization.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        plan: true,
        subscription: {
          select: { plan: true, status: true, trialEndsAt: true },
        },
        _count: {
          select: { users: true, featureFlags: true, vacancies: true },
        },
        users: {
          where: { isActive: true, lastLoginAt: { gte: sevenDaysAgo } },
          select: { id: true },
        },
      },
    });

    type Opportunity = {
      orgId: string;
      orgName: string;
      currentPlan: string;
      targetPlan: string;
      mrrIncrease: number;
      reason: string;
      signals: { activeUsers: number; totalUsers: number; features: number; vacancies: number };
      confidence: 'high' | 'medium' | 'low';
    };

    const opportunities: Opportunity[] = [];

    for (const org of orgs) {
      const plan = org.subscription?.plan ?? org.plan ?? 'trial';
      const isActive = org.subscription?.status === SubscriptionStatus.active || org.subscription?.status === SubscriptionStatus.trialing;
      if (!isActive) continue;

      const totalUsers = org._count.users;
      const activeUsers = org.users.length;
      const features = org._count.featureFlags;
      const vacancies = org._count.vacancies;

      // Check each upsell rule
      for (const [, rule] of Object.entries(UPSELL_RULES)) {
        if (plan !== rule.currentPlan) continue;

        const reasons: string[] = [];
        let score = 0;

        if (totalUsers >= rule.minUsers) {
          reasons.push(`${totalUsers} users (threshold: ${rule.minUsers})`);
          score += 40;
        }
        if (features >= rule.minFeatures) {
          reasons.push(`${features} features adopted (threshold: ${rule.minFeatures})`);
          score += 30;
        }
        if (activeUsers >= Math.ceil(rule.minUsers * 0.7)) {
          reasons.push(`${activeUsers} active in last 7d`);
          score += 20;
        }
        if (vacancies >= 3) {
          reasons.push(`${vacancies} active vacancies`);
          score += 10;
        }

        if (score >= 40) {
          const confidence: 'high' | 'medium' | 'low' = score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low';
          opportunities.push({
            orgId: org.id,
            orgName: org.name,
            currentPlan: plan,
            targetPlan: rule.targetPlan,
            mrrIncrease: rule.mrrIncrease,
            reason: reasons[0],
            signals: { activeUsers, totalUsers, features, vacancies },
            confidence,
          });
        }
      }
    }

    // Sort by MRR increase descending
    opportunities.sort((a, b) => b.mrrIncrease - a.mrrIncrease);

    const totalPotentialMrr = opportunities.reduce((sum, o) => sum + o.mrrIncrease, 0);

    return {
      opportunities,
      totalPotentialMrr,
      highConfidence: opportunities.filter((o) => o.confidence === 'high').length,
      mediumConfidence: opportunities.filter((o) => o.confidence === 'medium').length,
    };
  }),

  getAiCostAnomalies: platformProcedure.query(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get all agents with org configs that are enabled
    const enabledConfigs = await db.aiAgentOrgConfig.findMany({
      where: { enabled: true },
      select: {
        agentId: true,
        organizationId: true,
        monthlyBudget: true,
        agent: { select: { id: true, name: true, slug: true, costPerCall: true, status: true } },
        organization: { select: { id: true, name: true } },
      },
    });

    // Get usage per agent+org in last 30 days
    const usageLogs = await db.aiAgentUsageLog.groupBy({
      by: ['agentId', 'organizationId'],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _sum: { costUsd: true },
      _count: true,
    });

    const usageMap = new Map<string, { cost: number; calls: number }>();
    for (const log of usageLogs) {
      usageMap.set(`${log.agentId}:${log.organizationId}`, {
        cost: log._sum.costUsd ?? 0,
        calls: log._count,
      });
    }

    type Anomaly = {
      type: 'zero_usage' | 'over_budget' | 'high_cost';
      agentName: string;
      agentSlug: string;
      orgName: string;
      orgId: string;
      detail: string;
      monthlyCost: number;
      monthlyBudget: number | null;
      potentialSavings: number;
    };

    const anomalies: Anomaly[] = [];
    let totalPotentialSavings = 0;

    for (const config of enabledConfigs) {
      if (config.agent.status === 'stub') continue;

      const key = `${config.agentId}:${config.organizationId}`;
      const usage = usageMap.get(key);
      const monthlyCost = usage?.cost ?? 0;
      const calls = usage?.calls ?? 0;

      // Zero usage anomaly: enabled agent with $0 spend
      if (calls === 0) {
        const estimatedWaste = config.agent.costPerCall * 10; // Assume min 10 calls expected
        anomalies.push({
          type: 'zero_usage',
          agentName: config.agent.name,
          agentSlug: config.agent.slug,
          orgName: config.organization.name,
          orgId: config.organization.id,
          detail: `Enabled but 0 calls in 30 days`,
          monthlyCost: 0,
          monthlyBudget: config.monthlyBudget,
          potentialSavings: estimatedWaste,
        });
        totalPotentialSavings += estimatedWaste;
      }

      // Over budget anomaly
      if (config.monthlyBudget && monthlyCost > config.monthlyBudget) {
        const overage = monthlyCost - config.monthlyBudget;
        anomalies.push({
          type: 'over_budget',
          agentName: config.agent.name,
          agentSlug: config.agent.slug,
          orgName: config.organization.name,
          orgId: config.organization.id,
          detail: `$${monthlyCost.toFixed(2)} spent vs $${config.monthlyBudget.toFixed(2)} budget`,
          monthlyCost,
          monthlyBudget: config.monthlyBudget,
          potentialSavings: overage,
        });
        totalPotentialSavings += overage;
      }
    }

    // Sort by potential savings descending
    anomalies.sort((a, b) => b.potentialSavings - a.potentialSavings);

    return {
      anomalies,
      totalPotentialSavings,
      zeroUsageCount: anomalies.filter((a) => a.type === 'zero_usage').length,
      overBudgetCount: anomalies.filter((a) => a.type === 'over_budget').length,
    };
  }),
});
