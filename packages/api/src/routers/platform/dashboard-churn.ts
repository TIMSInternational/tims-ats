import { router } from '../../trpc';
import { db, SubscriptionStatus, InvoiceStatus } from '@tims/db';
import { platformProcedure } from './_common';
import { PLAN_PRICES } from '../../lib/plan-prices';
import { sumMoney } from '../../lib/currency';
import { PLATFORM_BILLING_CURRENCY } from '@tims/shared';

export const dashboardChurnRouter = router({
  getChurnRisk: platformProcedure.query(async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const orgs = await db.organization.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        subscription: {
          select: { plan: true, status: true, trialEndsAt: true },
        },
        invoices: {
          where: { status: InvoiceStatus.pending, dueDate: { lt: now } },
          select: { id: true, amount: true, currency: true },
        },
        users: {
          where: { isActive: true },
          select: { lastLoginAt: true },
        },
        _count: {
          select: { featureFlags: true },
        },
      },
    });

    const results = await Promise.all(orgs.map(async (org) => {
      const plan = org.subscription?.plan ?? 'trial';
      const mrr = org.subscription?.status === SubscriptionStatus.active
        ? (PLAN_PRICES[plan] || 0)
        : 0;

      const totalUsers = org.users.length;

      // Signal 1: Login Rate (0-30 pts)
      // % of active users who logged in within last 7 days
      const recentLogins = org.users.filter(
        (u) => u.lastLoginAt && u.lastLoginAt >= sevenDaysAgo,
      ).length;
      const loginRate = totalUsers > 0 ? recentLogins / totalUsers : 0;
      const loginScore = Math.round(loginRate * 30);

      // Signal 2: Invoice Health (0-25 pts)
      // 0 overdue = 25, 1 = 10, 2+ = 0
      const overdueCount = org.invoices.length;
      const overdueAmount = await sumMoney(org.invoices, PLATFORM_BILLING_CURRENCY);
      const invoiceScore = overdueCount === 0 ? 25 : overdueCount === 1 ? 10 : 0;

      // Signal 3: Recency (0-20 pts)
      // Last login across all users
      const lastLogin = org.users.reduce<Date | null>((latest, u) => {
        if (!u.lastLoginAt) return latest;
        if (!latest || u.lastLoginAt > latest) return u.lastLoginAt;
        return latest;
      }, null);
      const daysSinceLastLogin = lastLogin
        ? Math.floor((now.getTime() - lastLogin.getTime()) / (1000 * 60 * 60 * 24))
        : 999;
      const recencyScore = daysSinceLastLogin <= 1 ? 20
        : daysSinceLastLogin <= 3 ? 16
        : daysSinceLastLogin <= 7 ? 12
        : daysSinceLastLogin <= 14 ? 6
        : 0;

      // Signal 4: Feature Adoption (0-15 pts)
      // More enabled features = healthier
      const featureCount = org._count.featureFlags;
      const adoptionScore = featureCount >= 8 ? 15
        : featureCount >= 5 ? 12
        : featureCount >= 3 ? 8
        : featureCount >= 1 ? 4
        : 0;

      // Signal 5: Tenure (0-10 pts)
      // Longer tenure = more invested
      const daysSinceCreation = Math.floor(
        (now.getTime() - org.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      const tenureScore = daysSinceCreation >= 180 ? 10
        : daysSinceCreation >= 90 ? 8
        : daysSinceCreation >= 30 ? 5
        : 2;

      // Total health score: 0-100
      const healthScore = loginScore + invoiceScore + recencyScore + adoptionScore + tenureScore;

      // Tier classification
      const tier: 'green' | 'yellow' | 'red' = healthScore >= 70 ? 'green'
        : healthScore >= 40 ? 'yellow'
        : 'red';

      // Build risk reasons and recommended actions
      const risks: string[] = [];
      const actions: string[] = [];

      if (overdueCount > 0) {
        risks.push(`${overdueCount} overdue invoice${overdueCount > 1 ? 's' : ''} (${PLATFORM_BILLING_CURRENCY} ${overdueAmount.amount.toLocaleString()})`);
        actions.push('send_dunning');
      }
      if (daysSinceLastLogin >= 14) {
        risks.push(`No login in ${daysSinceLastLogin} days`);
        actions.push('reactivation_email');
      } else if (daysSinceLastLogin >= 7) {
        risks.push(`Last login ${daysSinceLastLogin} days ago`);
        actions.push('check_in');
      }
      if (loginRate < 0.3 && totalUsers > 1) {
        risks.push(`Only ${Math.round(loginRate * 100)}% login rate (${recentLogins}/${totalUsers} users)`);
        actions.push('adoption_call');
      }
      if (featureCount < 3) {
        risks.push(`Only ${featureCount} features adopted`);
        actions.push('onboarding_session');
      }
      if (org.subscription?.status === SubscriptionStatus.trialing) {
        const trialDaysLeft = org.subscription.trialEndsAt
          ? Math.ceil((org.subscription.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        if (trialDaysLeft !== null && trialDaysLeft <= 7) {
          risks.push(`Trial expires in ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''}`);
          actions.push('conversion_call');
        }
      }

      // Primary risk reason (most impactful)
      const primaryRisk = risks[0] ?? 'Healthy';

      return {
        orgId: org.id,
        orgName: org.name,
        plan,
        mrr,
        healthScore,
        tier,
        totalUsers,
        loginRate: Math.round(loginRate * 100),
        daysSinceLastLogin: daysSinceLastLogin === 999 ? null : daysSinceLastLogin,
        overdueInvoices: overdueCount,
        overdueAmount: overdueAmount.amount,
        currency: PLATFORM_BILLING_CURRENCY,
        overdueAmountConverted: overdueAmount.converted,
        featureCount,
        primaryRisk,
        risks,
        actions,
        signals: {
          loginScore,
          invoiceScore,
          recencyScore,
          adoptionScore,
          tenureScore,
        },
      };
    }));

    // Sort: worst health first
    results.sort((a, b) => a.healthScore - b.healthScore);

    // Summary stats
    const green = results.filter((r) => r.tier === 'green').length;
    const yellow = results.filter((r) => r.tier === 'yellow').length;
    const red = results.filter((r) => r.tier === 'red').length;
    const atRiskMrr = results
      .filter((r) => r.tier === 'red')
      .reduce((sum, r) => sum + r.mrr, 0);

    return {
      organizations: results,
      summary: { green, yellow, red, total: results.length, atRiskMrr },
    };
  }),
});
