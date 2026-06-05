import { router } from '../../trpc';
import { db, SubscriptionStatus, InvoiceStatus, InvitationStatus } from '@tims/db';
import { platformProcedure } from './_common';
import { PLAN_PRICES } from '../../lib/plan-prices';
import { searchInput } from './dashboard.schemas';
import { buildAttentionItems, SEARCH_PAGES } from './dashboard.helpers';

export const dashboardRouter = router({
  getDashboardKpis: platformProcedure.query(async () => {
    const now = new Date();

    // Start of current month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Start of previous month & end of previous month
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    // 7 days from now (for expiring trials)
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalOrgs,
      newOrgsThisMonth,
      totalUsers,
      newUsersThisMonth,
      activeSubs,
      activeTrials,
      trialsExpiringSoon,
      prevMonthSubs,
      overdueInvoices,
    ] = await Promise.all([
      db.organization.count(),
      db.organization.count({
        where: { createdAt: { gte: monthStart } },
      }),
      db.user.count({ where: { isActive: true } }),
      db.user.count({
        where: { isActive: true, createdAt: { gte: monthStart } },
      }),
      db.subscription.findMany({
        where: { status: SubscriptionStatus.active },
        select: { plan: true },
      }),
      db.subscription.count({
        where: { status: SubscriptionStatus.trialing },
      }),
      db.subscription.count({
        where: {
          status: SubscriptionStatus.trialing,
          trialEndsAt: { lte: sevenDaysFromNow, gte: now },
        },
      }),
      // Subscriptions that were active as of end of previous month
      db.subscription.findMany({
        where: {
          status: SubscriptionStatus.active,
          createdAt: { lte: prevMonthEnd },
        },
        select: { plan: true },
      }),
      db.invoice.findMany({
        where: {
          status: InvoiceStatus.pending,
          dueDate: { lt: now },
        },
        select: { amount: true },
      }),
    ]);

    const mrr = activeSubs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan] || 0), 0);
    const mrrPrevMonth = prevMonthSubs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan] || 0), 0);

    return {
      totalOrgs,
      totalOrgsChange: newOrgsThisMonth,
      totalUsers,
      totalUsersChange: newUsersThisMonth,
      mrr,
      mrrPrevMonth,
      activeTrials,
      trialsExpiringThisWeek: trialsExpiringSoon,
      overdueInvoices: overdueInvoices.length,
      outstandingAmount: overdueInvoices.reduce((sum, inv) => sum + inv.amount, 0),
    };
  }),

  getAttentionItems: platformProcedure.query(async () => {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const [overdueInvoices, expiringTrials, pastDueSubs, staleInvitations, suspendedOrgs] =
      await Promise.all([
        // Overdue invoices: pending + past due date
        db.invoice.findMany({
          where: {
            status: InvoiceStatus.pending,
            dueDate: { lt: now },
          },
          select: {
            id: true,
            amount: true,
            currency: true,
            dueDate: true,
            organization: { select: { id: true, name: true } },
          },
          orderBy: { dueDate: 'asc' },
          take: 20,
        }),
        // Trials expiring within 7 days
        db.subscription.findMany({
          where: {
            status: SubscriptionStatus.trialing,
            trialEndsAt: { lte: sevenDaysFromNow, gte: now },
          },
          select: {
            id: true,
            trialEndsAt: true,
            organization: { select: { id: true, name: true } },
          },
          orderBy: { trialEndsAt: 'asc' },
          take: 20,
        }),
        // Past-due subscriptions
        db.subscription.findMany({
          where: { status: SubscriptionStatus.past_due },
          select: {
            id: true,
            plan: true,
            organization: { select: { id: true, name: true } },
          },
          take: 20,
        }),
        // Invitations sent > 5 days ago still pending/sent
        db.platformInvitation.findMany({
          where: {
            status: { in: [InvitationStatus.pending, InvitationStatus.sent] },
            createdAt: { lt: fiveDaysAgo },
          },
          select: {
            id: true,
            email: true,
            createdAt: true,
            organization: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 20,
        }),
        // Suspended orgs
        db.organization.findMany({
          where: { isActive: false },
          select: { id: true, name: true },
          take: 20,
        }),
      ]);

    return buildAttentionItems({
      now,
      planPrices: PLAN_PRICES,
      overdueInvoices,
      expiringTrials,
      pastDueSubs,
      staleInvitations,
      suspendedOrgs,
    });
  }),

  getRevenueByCustomer: platformProcedure.query(async () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const orgs = await db.organization.findMany({
      select: {
        id: true,
        name: true,
        subscription: {
          select: { plan: true, status: true },
        },
        invoices: {
          select: { amount: true, status: true, paidAt: true },
        },
        users: {
          select: { lastLoginAt: true },
          where: { isActive: true },
        },
      },
    });

    const result = orgs.map((org) => {
      const plan = org.subscription?.plan ?? 'trial';
      const isActive = org.subscription?.status === SubscriptionStatus.active;
      const mrr = isActive ? (PLAN_PRICES[plan] || 0) : 0;

      const paidLast30d = org.invoices
        .filter((inv) => inv.status === InvoiceStatus.paid && inv.paidAt && inv.paidAt >= thirtyDaysAgo)
        .reduce((sum, inv) => sum + inv.amount, 0);

      const outstandingAmount = org.invoices
        .filter((inv) => inv.status === InvoiceStatus.pending || inv.status === InvoiceStatus.draft)
        .reduce((sum, inv) => sum + inv.amount, 0);

      const userCount = org.users.length;

      const lastActiveAt = org.users.reduce<Date | null>((latest, u) => {
        if (!u.lastLoginAt) return latest;
        if (!latest || u.lastLoginAt > latest) return u.lastLoginAt;
        return latest;
      }, null);

      return {
        orgId: org.id,
        orgName: org.name,
        plan,
        mrr,
        paidLast30d,
        outstandingAmount,
        userCount,
        lastActiveAt,
      };
    });

    // Sort by MRR descending
    result.sort((a, b) => b.mrr - a.mrr);

    return result;
  }),

  getCustomerHealth: platformProcedure.query(async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const orgs = await db.organization.findMany({
      select: {
        id: true,
        name: true,
        subscription: {
          select: { plan: true, status: true, trialEndsAt: true },
        },
        invoices: {
          where: { status: InvoiceStatus.pending, dueDate: { lt: now } },
          select: { id: true },
        },
        users: {
          where: { isActive: true },
          select: { lastLoginAt: true },
        },
      },
    });

    const result = orgs.map((org) => {
      const plan = org.subscription?.plan ?? 'trial';
      const activeUsers = org.users;
      const totalUsers = activeUsers.length;

      // Login rate: % of active users who logged in within last 7 days
      const recentLogins = activeUsers.filter(
        (u) => u.lastLoginAt && u.lastLoginAt >= sevenDaysAgo
      ).length;
      const loginRate = totalUsers > 0 ? Math.round((recentLogins / totalUsers) * 100) : 0;

      // Most recent login across all users
      const lastLogin = activeUsers.reduce<Date | null>((latest, u) => {
        if (!u.lastLoginAt) return latest;
        if (!latest || u.lastLoginAt > latest) return u.lastLoginAt;
        return latest;
      }, null);

      const daysSinceLastLogin = lastLogin
        ? Math.floor((now.getTime() - lastLogin.getTime()) / (1000 * 60 * 60 * 24))
        : 999; // No login ever = treat as very stale

      const overdueInvoices = org.invoices.length;

      // Trial days left
      let trialDaysLeft: number | null = null;
      if (org.subscription?.status === SubscriptionStatus.trialing && org.subscription.trialEndsAt) {
        trialDaysLeft = Math.ceil(
          (org.subscription.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      // Health score logic
      let health: 'healthy' | 'at_risk' | 'critical';
      if (overdueInvoices > 0 || daysSinceLastLogin >= 14) {
        health = 'critical';
      } else if (loginRate < 30 || (trialDaysLeft !== null && trialDaysLeft < 5)) {
        health = 'at_risk';
      } else {
        health = 'healthy';
      }

      return {
        orgId: org.id,
        orgName: org.name,
        plan,
        health,
        signals: {
          loginRate,
          overdueInvoices,
          trialDaysLeft,
          daysSinceLastLogin,
        },
      };
    });

    // Sort: critical first, then at_risk, then healthy
    const healthOrder: Record<string, number> = { critical: 0, at_risk: 1, healthy: 2 };
    result.sort((a, b) => healthOrder[a.health] - healthOrder[b.health]);

    return result;
  }),

  getRecentActivity: platformProcedure.query(async () => {
    const [recentOrgs, recentUsers, recentAudit] = await Promise.all([
      db.organization.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, name: true, plan: true, createdAt: true } }),
      db.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, firstName: true, lastName: true, email: true, createdAt: true, isPlatformOwner: true } }),
      db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, action: true, entity: true, entityId: true, createdAt: true, ipAddress: true }, where: { action: { not: 'access' } } }),
    ]);

    const activity: Array<{ id: string; type: string; title: string; timestamp: Date; meta?: string }> = [];

    for (const org of recentOrgs) {
      activity.push({ id: org.id, type: 'org_created', title: `Nueva organizacion: ${org.name}`, timestamp: org.createdAt, meta: org.plan });
    }
    for (const user of recentUsers) {
      activity.push({ id: user.id, type: user.isPlatformOwner ? 'platform_owner' : 'user_created', title: `Nuevo usuario: ${user.firstName} ${user.lastName}`, timestamp: user.createdAt, meta: user.email });
    }

    return activity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10);
  }),

  getPlanDistribution: platformProcedure.query(async () => {
    const subs = await db.subscription.findMany({ select: { plan: true } });
    const dist: Record<string, number> = { trial: 0, starter: 0, professional: 0, enterprise: 0 };
    for (const s of subs) dist[s.plan] = (dist[s.plan] || 0) + 1;
    const total = subs.length || 1;
    return Object.entries(dist).map(([plan, count]) => ({
      plan,
      count,
      percentage: Math.round((count / total) * 100),
    }));
  }),

  getUserGrowth: platformProcedure.query(async () => {
    const months: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date();
      start.setMonth(start.getMonth() - i, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      const count = await db.user.count({
        where: { createdAt: { gte: start, lt: end } },
      });
      months.push({
        month: start.toLocaleDateString('es', { month: 'short' }),
        count,
      });
    }
    return months;
  }),

  search: platformProcedure
    .input(searchInput)
    .query(async ({ input }) => {
      const q = input.query.trim();
      if (!q) return { organizations: [], users: [], pages: [] };

      const [organizations, users] = await Promise.all([
        db.organization.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q, mode: 'insensitive' } },
              { domain: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 5,
          select: { id: true, name: true, slug: true, plan: true, isActive: true },
          orderBy: { name: 'asc' },
        }),
        db.user.findMany({
          where: {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 5,
          select: {
            id: true, firstName: true, lastName: true, email: true,
            isPlatformOwner: true, isActive: true, avatar: true,
            organization: { select: { name: true } },
          },
          orderBy: { firstName: 'asc' },
        }),
      ]);

      // Match pages by name
      const ql = q.toLowerCase();
      const pages = SEARCH_PAGES.filter(
        (p) => p.name.toLowerCase().includes(ql) || p.keywords.includes(ql)
      ).slice(0, 4);

      return { organizations, users, pages };
    }),

  getMrrTrend: platformProcedure.query(async () => {
    const months: { month: string; mrr: number }[] = [];
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
      months.push({
        month: start.toLocaleDateString('es', { month: 'short', year: '2-digit' }),
        mrr,
      });
    }
    return months;
  }),
});
