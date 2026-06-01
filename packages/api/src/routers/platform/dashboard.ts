import { z } from 'zod';
import { router } from '../../trpc';
import { db, SubscriptionStatus } from '@tims/db';
import { platformProcedure } from './_common';

export const dashboardRouter = router({
  getDashboardKpis: platformProcedure.query(async () => {
    const [orgCount, userCount, activeTrials, subscriptions] = await Promise.all([
      db.organization.count(),
      db.user.count({ where: { isActive: true } }),
      db.subscription.count({ where: { status: SubscriptionStatus.trialing } }),
      db.subscription.findMany({ where: { status: SubscriptionStatus.active } }),
    ]);

    return {
      totalOrgs: orgCount,
      totalUsers: userCount,
      mrr: subscriptions.reduce((sum, s) => {
        const prices: Record<string, number> = { trial: 0, starter: 499, professional: 999, enterprise: 2499 };
        return sum + (prices[s.plan] || 0);
      }, 0),
      activeTrials,
      uptime: 99.97,
    };
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
    .input(z.object({ query: z.string().min(1).max(100) }))
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
      const PAGES = [
        { name: 'Dashboard', href: '/dashboard', keywords: 'inicio home panel' },
        { name: 'Organizaciones', href: '/platform/organizations', keywords: 'orgs empresas clients' },
        { name: 'Suscripciones', href: '/platform/subscriptions', keywords: 'billing planes pagos facturacion stripe' },
        { name: 'Usuarios', href: '/platform/users', keywords: 'users personas cuentas' },
        { name: 'Salud del Sistema', href: '/platform/health', keywords: 'health status uptime monitoreo' },
        { name: 'Feature Flags', href: '/platform/feature-flags', keywords: 'flags toggles features modulos' },
        { name: 'Agentes IA', href: '/platform/ai-agents', keywords: 'ai agents bedrock claude haiku sonnet inteligencia artificial agentes' },
        { name: 'Analytics', href: '/platform/analytics', keywords: 'metricas estadisticas growth crecimiento' },
        { name: 'Auditoria', href: '/platform/audit', keywords: 'audit logs registro actividad' },
        { name: 'Soporte', href: '/platform/support', keywords: 'support ayuda impersonar reset' },
        { name: 'Facturas', href: '/platform/invoices', keywords: 'invoices facturas pagos billing cobros' },
        { name: 'Invitaciones', href: '/platform/invitations', keywords: 'invitations invitaciones onboarding invite' },
      ];

      const ql = q.toLowerCase();
      const pages = PAGES.filter(
        (p) => p.name.toLowerCase().includes(ql) || p.keywords.includes(ql)
      ).slice(0, 4);

      return { organizations, users, pages };
    }),

  getMrrTrend: platformProcedure.query(async () => {
    const months: { month: string; mrr: number }[] = [];
    const prices: Record<string, number> = { trial: 0, starter: 499, professional: 999, enterprise: 2499 };
    for (let i = 5; i >= 0; i--) {
      const start = new Date();
      start.setMonth(start.getMonth() - i, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      const subs = await db.subscription.findMany({
        where: { status: SubscriptionStatus.active, createdAt: { lt: end } },
        select: { plan: true },
      });
      const mrr = subs.reduce((sum, s) => sum + (prices[s.plan] || 0), 0);
      months.push({
        month: start.toLocaleDateString('es', { month: 'short' }),
        mrr,
      });
    }
    return months;
  }),
});
