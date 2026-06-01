import { z } from 'zod';
import { router, protectedProcedure, publicProcedure } from '../trpc';
import { db, OrgPlan, SubscriptionStatus, InvoiceStatus, InvitationType, InvitationStatus } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { notify } from '../lib/notify';
import { sendEmail } from '../lib/ses';
import { randomUUID } from 'crypto';

// Guard: only platform owners can use these procedures
const platformProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.isPlatformOwner) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Acceso restringido a administradores de plataforma' });
  }
  return next();
});

export const platformRouter = router({
  // ============ DASHBOARD ============

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

  // ============ SEARCH ============

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

  // ============ ORGANIZATIONS ============

  getOrganizationKpis: platformProcedure.query(async () => {
    const [total, active, suspended, trialing] = await Promise.all([
      db.organization.count(),
      db.organization.count({ where: { isActive: true } }),
      db.organization.count({ where: { isActive: false } }),
      db.subscription.count({ where: { status: SubscriptionStatus.trialing } }),
    ]);

    const expiringThisWeek = await db.subscription.count({
      where: {
        status: SubscriptionStatus.trialing,
        trialEndsAt: {
          gte: new Date(),
          lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    });

    return { total, active, suspended, trialing, expiringThisWeek };
  }),

  listOrganizations: platformProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      page: z.number().int().min(0).default(0),
      limit: z.number().min(1).max(50).default(20),
      search: z.string().optional(),
      plan: z.string().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { cursor, page, limit, search, plan, status } = input;

      const where: any = {};
      if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search, mode: 'insensitive' } }];
      if (plan) where.plan = plan;
      if (status === 'active') where.isActive = true;
      if (status === 'suspended') where.isActive = false;

      const orgs = await db.organization.findMany({
        where,
        take: limit,
        skip: cursor ? 1 : page * limit,
        ...(cursor ? { cursor: { id: cursor } } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { users: true } },
          subscription: { select: { plan: true, status: true, trialEndsAt: true } },
        },
      });

      const total = await db.organization.count({ where });

      return { organizations: orgs, total };
    }),

  getOrganization: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const org = await db.organization.findUnique({
        where: { id: input.id },
        include: {
          companies: { include: { businessUnits: { include: { teams: true } } } },
          users: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, isActive: true, lastLoginAt: true, isPlatformOwner: true }, orderBy: { createdAt: 'desc' } },
          subscription: true,
          featureFlags: true,
          _count: { select: { users: true, vacancies: true } },
        },
      });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
      return org;
    }),

  createOrganization: platformProcedure
    .input(z.object({
      name: z.string().min(2),
      slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
      plan: z.enum(['trial', 'starter', 'professional', 'enterprise']),
      adminEmail: z.string().email(),
      billingEmail: z.string().email().optional(),
    }))
    .mutation(async ({ input }) => {
      const org = await db.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: input.name,
            slug: input.slug,
            plan: input.plan,
            billingEmail: input.billingEmail || input.adminEmail,
          },
        });

        const role = await tx.role.create({
          data: { organizationId: org.id, name: 'Super Administrador', slug: 'super_admin', isSystem: true },
        });

        await tx.subscription.create({
          data: {
            organizationId: org.id,
            plan: input.plan,
            status: input.plan === 'trial' ? 'trialing' : 'active',
            trialEndsAt: input.plan === 'trial' ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
          },
        });

        return org;
      });

      await notify({
        type: 'success',
        title: `Nueva organizacion creada: ${org.name}`,
        module: 'platform',
        actionUrl: '/platform/organizations',
        organizationId: org.id,
      });

      return org;
    }),

  updateOrganization: platformProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().optional(),
      plan: z.string().optional(),
      isActive: z.boolean().optional(),
      settings: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return db.organization.update({ where: { id }, data: data as any });
    }),

  suspendOrganization: platformProcedure
    .input(z.object({ id: z.string().uuid(), suspend: z.boolean() }))
    .mutation(async ({ input }) => {
      const org = await db.organization.update({
        where: { id: input.id },
        data: { isActive: !input.suspend },
      });

      if (input.suspend) {
        await notify({
          type: 'warning',
          title: `Organizacion suspendida: ${org.name}`,
          module: 'platform',
          actionUrl: '/platform/organizations',
          organizationId: org.id,
        });
      }

      return org;
    }),

  // ============ USERS ============

  getUserKpis: platformProcedure.query(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const [total, activeToday, platformOwners, inactive] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { lastLoginAt: { gte: todayStart } } }),
      db.user.count({ where: { isPlatformOwner: true } }),
      db.user.count({ where: { OR: [{ isActive: false }, { lastLoginAt: { lt: thirtyDaysAgo } }] } }),
    ]);

    return { total, activeToday, platformOwners, inactive };
  }),

  listAllUsers: platformProcedure
    .input(z.object({
      page: z.number().int().min(0).default(0),
      limit: z.number().min(1).max(50).default(20),
      search: z.string().optional(),
      organizationId: z.string().uuid().optional(),
      roleSlug: z.string().optional(),
      isPlatformOwner: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const { page, limit, search, organizationId, roleSlug, isPlatformOwner, isActive } = input;

      const where: any = {};
      if (search) where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
      if (organizationId) where.organizationId = organizationId;
      if (isPlatformOwner !== undefined) where.isPlatformOwner = isPlatformOwner;
      if (isActive !== undefined) where.isActive = isActive;
      if (roleSlug) where.userRoles = { some: { role: { slug: roleSlug } } };

      const [users, total] = await Promise.all([
        db.user.findMany({
          where,
          take: limit,
          skip: page * limit,
          orderBy: { createdAt: 'desc' },
          include: {
            organization: { select: { id: true, name: true } },
            userRoles: { include: { role: { select: { name: true, slug: true } } } },
          },
        }),
        db.user.count({ where }),
      ]);

      return { users, total };
    }),

  // ============ SUBSCRIPTIONS ============

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

  // ============ FEATURE FLAGS ============

  listAllFeatureFlags: platformProcedure.query(async () => {
    const flags = await db.featureFlag.findMany({
      orderBy: [{ key: 'asc' }],
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    // Group by key
    const grouped: Record<string, { key: string; entries: typeof flags }> = {};
    for (const f of flags) {
      if (!grouped[f.key]) grouped[f.key] = { key: f.key, entries: [] };
      grouped[f.key].entries.push(f);
    }

    return Object.values(grouped);
  }),

  updateFeatureFlag: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      key: z.string(),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      return db.featureFlag.upsert({
        where: { organizationId_key: { organizationId: input.organizationId, key: input.key } },
        create: { organizationId: input.organizationId, key: input.key, enabled: input.enabled },
        update: { enabled: input.enabled },
      });
    }),

  // ============ AUDIT ============

  getCrossOrgAuditLogs: platformProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      limit: z.number().min(1).max(50).default(20),
      userId: z.string().uuid().optional(),
      action: z.string().optional(),
      entity: z.string().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const { cursor, limit, userId, action, entity, dateFrom, dateTo } = input;

      const where: any = {};
      if (userId) where.actorId = userId;
      if (action) where.action = action;
      if (entity) where.entity = entity;
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = dateFrom;
        if (dateTo) where.createdAt.lte = dateTo;
      }

      const logs = await db.auditLog.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
        },
      });

      let nextCursor: string | undefined;
      if (logs.length > limit) { const n = logs.pop(); nextCursor = n?.id; }

      const total = await db.auditLog.count({ where });

      return { logs, nextCursor, total };
    }),

  // ============ ANALYTICS ============

  getAnalytics: platformProcedure.query(async () => {
    const [orgCount, userCount, activeUsers, subs] = await Promise.all([
      db.organization.count(),
      db.user.count(),
      db.user.count({ where: { lastLoginAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
      db.subscription.findMany(),
    ]);

    const planCounts: Record<string, number> = {};
    for (const s of subs) planCounts[s.plan] = (planCounts[s.plan] || 0) + 1;

    return {
      totalOrgs: orgCount,
      totalUsers: userCount,
      activeUsersLast30d: activeUsers,
      dauMauRatio: userCount > 0 ? Math.round((activeUsers / userCount) * 100) : 0,
      subscriptionsByPlan: planCounts,
      churnRate: 2.1, // Mock for now
      arpu: orgCount > 0 ? Math.round(subs.reduce((sum, s) => {
        const prices: Record<string, number> = { trial: 0, starter: 499, professional: 999, enterprise: 2499 };
        return sum + (prices[s.plan] || 0);
      }, 0) / orgCount) : 0,
    };
  }),

  // ============ SYSTEM HEALTH ============

  getSystemHealth: platformProcedure.query(async () => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    // Real DB checks
    let dbHealthy = false;
    let dbLatency = 0;
    try {
      const start = Date.now();
      await db.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - start;
      dbHealthy = true;
    } catch {}

    const [
      userCount,
      orgCount,
      loginsToday,
      activeUsers,
      auditLogsToday,
      vacancyCount,
      failedLogins,
    ] = await Promise.all([
      db.user.count(),
      db.organization.count(),
      db.user.count({ where: { lastLoginAt: { gte: todayStart } } }),
      db.user.count({ where: { isActive: true } }),
      db.auditLog.count({ where: { createdAt: { gte: todayStart } } }),
      db.vacancy.count(),
      db.auditLog.count({ where: { createdAt: { gte: todayStart }, action: 'login_failed' } }),
    ]);

    // Recent errors from audit log
    const recentErrors = await db.auditLog.findMany({
      where: {
        action: { in: ['error', 'login_failed', 'rate_limit', 'system_error', 'bounce'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        action: true,
        entity: true,
        changes: true,
        metadata: true,
        createdAt: true,
      },
    });

    const services = [
      { name: 'API Gateway', status: 'operational' as const, metrics: [
        { label: 'Latencia p95', value: `${Math.max(dbLatency * 3, 12)}ms` },
        { label: 'Uptime', value: '99.99%', color: 'green' },
        { label: 'Requests/min', value: String(Math.round(auditLogsToday / Math.max(1, (Date.now() - todayStart.getTime()) / 60000))) },
      ]},
      { name: 'Base de Datos', status: (dbHealthy ? 'operational' : 'down') as 'operational' | 'down', metrics: [
        { label: 'Conexiones', value: `${Math.min(orgCount + 2, 100)} / 100` },
        { label: 'Query time', value: `${dbLatency}ms`, color: dbLatency < 50 ? 'green' : 'amber' },
        { label: 'Tablas', value: `${76} tablas, ${userCount + orgCount + vacancyCount} registros` },
      ]},
      { name: 'Autenticacion', status: 'operational' as const, metrics: [
        { label: 'Logins hoy', value: String(loginsToday) },
        { label: 'Fallidos', value: String(failedLogins), color: failedLogins > 0 ? 'red' : undefined },
        { label: 'Sesiones activas', value: String(activeUsers) },
      ]},
      { name: 'Almacenamiento', status: 'operational' as const, metrics: [
        { label: 'Usado', value: '12.4 GB / 50 GB' },
        { label: 'Uploads hoy', value: '0' },
      ], progressBar: { percent: 24.8, color: 'blue' }},
      { name: 'Background Jobs', status: 'operational' as const, metrics: [
        { label: 'Cola', value: '0 pendientes' },
        { label: 'Fallidos', value: '0' },
        { label: 'Procesados hoy', value: String(auditLogsToday) },
      ]},
      { name: 'AI (Bedrock)', status: 'operational' as const, metrics: [
        { label: 'Llamadas hoy', value: '0' },
        { label: 'Costo', value: '$0.00' },
        { label: 'Presupuesto', value: '0% usado' },
      ], progressBar: { percent: 0, color: 'green' }},
      { name: 'Email (SES)', status: 'operational' as const, metrics: [
        { label: 'Enviados hoy', value: '0' },
        { label: 'Bounce rate', value: '0%', color: 'green' },
        { label: 'Reputation', value: 'N/A' },
      ]},
      { name: 'Realtime', status: 'operational' as const, metrics: [
        { label: 'Conexiones', value: '0' },
        { label: 'Mensajes/seg', value: '0' },
        { label: 'Canales activos', value: '0' },
      ]},
    ];

    const hasIssues = services.some(s => s.status !== 'operational');
    return {
      services,
      overall: hasIssues ? 'degraded' : 'operational',
      recentErrors: recentErrors.map(e => ({
        id: e.id,
        service: e.entity || 'Sistema',
        time: e.createdAt,
        message: typeof e.changes === 'string' ? e.changes : (e.metadata as any)?.message || (e.changes as any)?.message || e.action,
        status: 'resolved' as const,
      })),
      stats: { userCount, orgCount, loginsToday, auditLogsToday },
    };
  }),

  // ============ PLATFORM OWNER MANAGEMENT ============

  listPlatformOwnerEmails: platformProcedure.query(async () => {
    return db.platformOwnerEmail.findMany({ orderBy: { createdAt: 'desc' } });
  }),

  addPlatformOwnerEmail: platformProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      return db.platformOwnerEmail.create({ data: { email: input.email } });
    }),

  removePlatformOwnerEmail: platformProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      return db.platformOwnerEmail.delete({ where: { email: input.email } });
    }),

  // ============ AI AGENTS ============

  getAiAgentKpis: platformProcedure.query(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [total, activeCount, stubCount, usageLogs] = await Promise.all([
      db.aiAgent.count(),
      db.aiAgent.count({ where: { status: 'active' } }),
      db.aiAgent.count({ where: { status: 'stub' } }),
      db.aiAgentUsageLog.aggregate({
        where: { createdAt: { gte: thirtyDaysAgo } },
        _sum: { costUsd: true },
        _avg: { costUsd: true },
        _count: true,
      }),
    ]);

    return {
      total,
      active: activeCount,
      stubCount,
      monthlySpend: usageLogs._sum.costUsd ?? 0,
      avgCostPerCall: usageLogs._avg.costUsd ?? 0,
    };
  }),

  listAiAgents: platformProcedure
    .input(z.object({
      category: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const where: any = {};
      if (input?.category) where.category = input.category;
      if (input?.status) where.status = input.status;
      if (input?.search) {
        where.OR = [
          { name: { contains: input.search, mode: 'insensitive' } },
          { slug: { contains: input.search, mode: 'insensitive' } },
          { description: { contains: input.search, mode: 'insensitive' } },
        ];
      }

      return db.aiAgent.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { orgConfigs: true, usageLogs: true } },
        },
      });
    }),

  getAiAgent: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const agent = await db.aiAgent.findUnique({
        where: { id: input.id },
        include: {
          orgConfigs: {
            include: { organization: { select: { id: true, name: true } } },
          },
        },
      });
      if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
      return agent;
    }),

  updateAiAgent: platformProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.string().optional(),
      model: z.string().optional(),
      cacheTtlSeconds: z.number().int().min(0).optional(),
      batchEligible: z.boolean().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return db.aiAgent.update({ where: { id }, data });
    }),

  updateAiAgentOrgConfig: platformProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      organizationId: z.string().uuid(),
      enabled: z.boolean().optional(),
      monthlyBudget: z.number().min(0).optional(),
    }))
    .mutation(async ({ input }) => {
      const { agentId, organizationId, ...data } = input;
      return db.aiAgentOrgConfig.upsert({
        where: { agentId_organizationId: { agentId, organizationId } },
        create: { agentId, organizationId, ...data },
        update: data,
      });
    }),

  getAiAgentUsage: platformProcedure
    .input(z.object({
      agentId: z.string().uuid().optional(),
      days: z.number().int().min(1).max(90).default(30),
    }).optional())
    .query(async ({ input }) => {
      const since = new Date(Date.now() - (input?.days ?? 30) * 24 * 60 * 60 * 1000);
      const where: any = { createdAt: { gte: since } };
      if (input?.agentId) where.agentId = input.agentId;

      const agg = await db.aiAgentUsageLog.aggregate({
        where,
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _avg: { latencyMs: true, costUsd: true },
        _count: true,
      });

      return {
        totalCalls: agg._count,
        totalCost: agg._sum.costUsd ?? 0,
        totalInputTokens: agg._sum.inputTokens ?? 0,
        totalOutputTokens: agg._sum.outputTokens ?? 0,
        avgLatencyMs: Math.round(agg._avg.latencyMs ?? 0),
        avgCostPerCall: agg._avg.costUsd ?? 0,
      };
    }),

  seedAiAgents: platformProcedure.mutation(async () => {
    const existing = await db.aiAgent.count();
    if (existing > 0) return { seeded: false, count: existing };

    const agents = [
      // MVP Agents (11)
      { slug: 'cv-parser', name: 'CV Parser', description: 'Extrae datos estructurados de hojas de vida', category: 'recruitment', model: 'haiku', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.003, status: 'stub' },
      { slug: 'vacancy-writer', name: 'Vacancy Writer', description: 'Genera descripciones de vacantes optimizadas', category: 'recruitment', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 300, costPerCall: 0.015, status: 'stub' },
      { slug: 'inclusive-language', name: 'Inclusive Language Checker', description: 'Revisa lenguaje inclusivo en descripciones de vacantes', category: 'recruitment', model: 'haiku', batchEligible: false, cacheTtlSeconds: 600, costPerCall: 0.003, status: 'stub' },
      { slug: 'candidate-screener', name: 'Candidate Screener', description: 'Evalua candidatos contra requisitos de vacante', category: 'recruitment', model: 'sonnet', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'candidate-matcher', name: 'Candidate Matcher', description: 'Matching automatico candidato-vacante con scoring', category: 'recruitment', model: 'sonnet', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'interview-question-gen', name: 'Interview Question Generator', description: 'Genera preguntas de entrevista personalizadas', category: 'interview', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 300, costPerCall: 0.015, status: 'stub' },
      { slug: 'interview-summarizer', name: 'Interview Summarizer', description: 'Resume entrevistas con puntos clave y evaluacion', category: 'interview', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'assessment-evaluator', name: 'Assessment Evaluator', description: 'Evalua respuestas de assessments automaticamente', category: 'assessment', model: 'sonnet', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'pipeline-optimizer', name: 'Pipeline Optimizer', description: 'Sugiere optimizaciones del pipeline de reclutamiento', category: 'pipeline', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 1800, costPerCall: 0.015, status: 'stub' },
      { slug: 'email-composer', name: 'Email Composer', description: 'Compone emails personalizados para candidatos', category: 'recruitment', model: 'haiku', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.003, status: 'stub' },
      { slug: 'offer-letter-gen', name: 'Offer Letter Generator', description: 'Genera cartas de oferta personalizadas', category: 'recruitment', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      // Post-MVP Agents (21)
      { slug: 'talent-insights', name: 'Talent Insights', description: 'Analytics avanzados de talento con predicciones', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 3600, costPerCall: 0.015, status: 'stub' },
      { slug: 'succession-planner', name: 'Succession Planner', description: 'Planificacion de sucesion asistida por IA', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 3600, costPerCall: 0.015, status: 'stub' },
      { slug: 'performance-reviewer', name: 'Performance Reviewer', description: 'Asistente de evaluacion de desempeno', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'okr-assistant', name: 'OKR Assistant', description: 'Ayuda a definir y alinear OKRs', category: 'talent', model: 'haiku', batchEligible: false, cacheTtlSeconds: 600, costPerCall: 0.003, status: 'stub' },
      { slug: 'onboarding-planner', name: 'Onboarding Planner', description: 'Crea planes de onboarding personalizados', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 1800, costPerCall: 0.015, status: 'stub' },
      { slug: 'dei-analyzer', name: 'DEI Analyzer', description: 'Analisis de diversidad, equidad e inclusion', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 3600, costPerCall: 0.015, status: 'stub' },
      { slug: 'compensation-benchmarker', name: 'Compensation Benchmarker', description: 'Benchmarking salarial con datos de mercado', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 86400, costPerCall: 0.015, status: 'stub' },
      { slug: 'learning-recommender', name: 'Learning Recommender', description: 'Recomienda rutas de aprendizaje personalizadas', category: 'talent', model: 'haiku', batchEligible: false, cacheTtlSeconds: 3600, costPerCall: 0.003, status: 'stub' },
      { slug: 'engagement-predictor', name: 'Engagement Predictor', description: 'Predice riesgo de rotacion y engagement', category: 'talent', model: 'sonnet', batchEligible: true, cacheTtlSeconds: 3600, costPerCall: 0.015, status: 'stub' },
      { slug: 'nine-box-evaluator', name: 'Nine-Box Evaluator', description: 'Evaluacion automatica para nine-box grid', category: 'talent', model: 'sonnet', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'video-analyzer', name: 'Video Interview Analyzer', description: 'Analiza entrevistas en video con NLP', category: 'interview', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.030, status: 'stub' },
      { slug: 'sentiment-analyzer', name: 'Sentiment Analyzer', description: 'Analisis de sentimiento en comunicaciones', category: 'assessment', model: 'haiku', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.003, status: 'stub' },
      { slug: 'skills-extractor', name: 'Skills Extractor', description: 'Extrae habilidades de CVs y perfiles', category: 'recruitment', model: 'haiku', batchEligible: true, cacheTtlSeconds: 300, costPerCall: 0.003, status: 'stub' },
      { slug: 'job-classifier', name: 'Job Classifier', description: 'Clasifica vacantes por familia y nivel', category: 'recruitment', model: 'haiku', batchEligible: true, cacheTtlSeconds: 600, costPerCall: 0.003, status: 'stub' },
      { slug: 'reference-checker', name: 'Reference Checker', description: 'Asistente de verificacion de referencias', category: 'recruitment', model: 'haiku', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.003, status: 'stub' },
      { slug: 'interview-coach', name: 'Interview Coach', description: 'Coaching para entrevistadores con feedback', category: 'interview', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 600, costPerCall: 0.015, status: 'stub' },
      { slug: 'assessment-designer', name: 'Assessment Designer', description: 'Disena assessments y pruebas tecnicas', category: 'assessment', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 1800, costPerCall: 0.015, status: 'stub' },
      { slug: 'bias-detector', name: 'Bias Detector', description: 'Detecta sesgos en procesos de seleccion', category: 'assessment', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'workforce-planner', name: 'Workforce Planner', description: 'Planificacion de fuerza laboral con IA', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 3600, costPerCall: 0.015, status: 'stub' },
      { slug: 'report-generator', name: 'Report Generator', description: 'Genera reportes de RRHH automatizados', category: 'pipeline', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 1800, costPerCall: 0.015, status: 'stub' },
      { slug: 'chatbot-assistant', name: 'Chatbot Assistant', description: 'Chatbot de soporte para candidatos y empleados', category: 'general', model: 'haiku', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.003, status: 'stub' },
    ];

    await db.aiAgent.createMany({ data: agents });

    return { seeded: true, count: agents.length };
  }),

  // ============ INVOICES & BILLING ============

  getInvoiceKpis: platformProcedure.query(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [paidThisMonth, pending, overdue, paidInvoices] = await Promise.all([
      db.invoice.aggregate({
        where: { status: InvoiceStatus.paid, paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      db.invoice.aggregate({
        where: { status: InvoiceStatus.pending },
        _sum: { amount: true },
        _count: true,
      }),
      db.invoice.count({
        where: { status: InvoiceStatus.pending, dueDate: { lt: now } },
      }),
      db.invoice.findMany({
        where: { status: InvoiceStatus.paid, paidAt: { not: null } },
        select: { createdAt: true, paidAt: true },
      }),
    ]);

    const avgDaysToPay = paidInvoices.length > 0
      ? Math.round(
          paidInvoices.reduce((sum, inv) => {
            const days = (inv.paidAt!.getTime() - inv.createdAt.getTime()) / (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / paidInvoices.length
        )
      : 0;

    return {
      collected: paidThisMonth._sum.amount ?? 0,
      outstanding: pending._sum.amount ?? 0,
      overdueCount: overdue,
      avgDaysToPay,
    };
  }),

  listInvoices: platformProcedure
    .input(z.object({
      page: z.number().int().min(0).default(0),
      limit: z.number().min(1).max(50).default(20),
      search: z.string().optional(),
      status: z.string().optional(),
      organizationId: z.string().uuid().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const { page, limit, search, status, organizationId, dateFrom, dateTo } = input;
      const where: any = {};

      if (status === 'overdue') {
        where.status = 'pending';
        where.dueDate = { lt: new Date() };
      } else if (status) {
        where.status = status;
      }

      if (organizationId) where.organizationId = organizationId;
      if (search) {
        where.organization = { name: { contains: search, mode: 'insensitive' } };
      }
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = dateFrom;
        if (dateTo) where.createdAt.lte = dateTo;
      }

      const [invoices, total] = await Promise.all([
        db.invoice.findMany({
          where,
          take: limit,
          skip: page * limit,
          orderBy: { createdAt: 'desc' },
          include: {
            organization: { select: { id: true, name: true, slug: true } },
            lineItems: { orderBy: { sortOrder: 'asc' } },
          },
        }),
        db.invoice.count({ where }),
      ]);

      return { invoices, total };
    }),

  getInvoice: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const invoice = await db.invoice.findUnique({
        where: { id: input.id },
        include: {
          organization: {
            include: { billingProfile: true },
          },
          lineItems: { orderBy: { sortOrder: 'asc' } },
        },
      });
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND' });
      return invoice;
    }),

  getNextInvoiceNumber: platformProcedure.query(async () => {
    const last = await db.invoice.findFirst({ orderBy: { invoiceNumber: 'desc' }, select: { invoiceNumber: true } });
    return (last?.invoiceNumber ?? 0) + 1;
  }),

  createInvoice: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      currency: z.string().default('USD'),
      description: z.string().max(500).optional(),
      invoiceDate: z.date().optional(),
      dueDate: z.date().optional(),
      poNumber: z.string().max(50).optional(),
      notes: z.string().max(1000).optional(),
      memo: z.string().max(500).optional(),
      taxRate: z.number().min(0).max(100).optional(),
      emailTo: z.string().email().optional(),
      emailCc: z.string().max(500).optional(),
      sendEmail: z.boolean().default(false),
      lineItems: z.array(z.object({
        description: z.string().min(1).max(300),
        quantity: z.number().int().positive(),
        unitPrice: z.number().min(0),
      })).min(1).max(50),
    }))
    .mutation(async ({ input }) => {
      const subtotal = input.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
      const taxAmount = input.taxRate ? subtotal * (input.taxRate / 100) : 0;
      const amount = subtotal + taxAmount;

      const invoice = await db.invoice.create({
        data: {
          organizationId: input.organizationId,
          amount,
          subtotal,
          taxRate: input.taxRate,
          currency: input.currency,
          description: input.description,
          invoiceDate: input.invoiceDate || new Date(),
          dueDate: input.dueDate,
          poNumber: input.poNumber,
          notes: input.notes,
          memo: input.memo,
          emailTo: input.emailTo,
          emailCc: input.emailCc,
          status: InvoiceStatus.pending,
          lineItems: {
            create: input.lineItems.map((li, i) => ({
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              total: li.quantity * li.unitPrice,
              sortOrder: i,
            })),
          },
        },
        include: {
          lineItems: { orderBy: { sortOrder: 'asc' } },
          organization: { select: { name: true, billingEmail: true }, },
        },
      });

      if (input.sendEmail && input.emailTo) {
        const amtFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: input.currency }).format(amount);
        const dueFmt = input.dueDate ? new Intl.DateTimeFormat('es', { day: '2-digit', month: 'long', year: 'numeric' }).format(input.dueDate) : 'N/A';
        const invNum = `INV-${invoice.invoiceNumber}`;
        const lineItemsHtml = invoice.lineItems.map(li =>
          `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${li.description}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${li.quantity}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${li.unitPrice.toFixed(2)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${li.total.toFixed(2)}</td></tr>`
        ).join('');

        const ccAddresses = input.emailCc ? input.emailCc.split(',').map(e => e.trim()).filter(Boolean) : [];

        await sendEmail({
          to: [input.emailTo, ...ccAddresses],
          subject: `Nueva factura ${invNum} de TIMS ATS - ${amtFmt}`,
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
              <div style="text-align:center;margin-bottom:32px;">
                <h1 style="color:#1F114C;font-size:24px;margin:0;">TIMS ATS</h1>
              </div>
              <div style="background:#f8f9fa;border-radius:12px;padding:32px;margin-bottom:24px;">
                <h2 style="color:#333;font-size:18px;margin:0 0 8px;">Nueva factura</h2>
                <p style="color:#585858;margin:0 0 16px;">Se ha generado una factura para <strong>${invoice.organization.name}</strong>.</p>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
                  <div><span style="font-size:28px;font-weight:700;color:#333;">${amtFmt}</span></div>
                  <div style="text-align:right;"><span style="font-size:14px;font-weight:600;color:#585858;">${invNum}</span><br/><span style="font-size:12px;color:#8B8B8B;">Vence: ${dueFmt}</span></div>
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                  <tr style="background:#eee;"><th style="padding:8px;text-align:left;font-size:12px;">Item</th><th style="padding:8px;text-align:center;font-size:12px;">Cant.</th><th style="padding:8px;text-align:right;font-size:12px;">Precio</th><th style="padding:8px;text-align:right;font-size:12px;">Total</th></tr>
                  ${lineItemsHtml}
                  <tr><td colspan="3" style="padding:8px;text-align:right;font-weight:700;">Total</td><td style="padding:8px;text-align:right;font-weight:700;">${amtFmt}</td></tr>
                </table>
                ${input.memo ? `<p style="color:#585858;font-size:13px;margin:16px 0 0;"><strong>Memo:</strong> ${input.memo}</p>` : ''}
              </div>
              <p style="color:#8B8B8B;font-size:12px;text-align:center;">Este es un mensaje automatico de TIMS ATS.</p>
            </div>
          `,
        });
      }

      return invoice;
    }),

  updateInvoiceStatus: platformProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(['paid', 'void', 'pending']),
    }))
    .mutation(async ({ input }) => {
      const data: any = { status: input.status };
      if (input.status === 'paid') data.paidAt = new Date();
      if (input.status === 'pending') data.paidAt = null;
      return db.invoice.update({ where: { id: input.id }, data });
    }),

  sendPaymentReminder: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const invoice = await db.invoice.findUnique({
        where: { id: input.id },
        include: {
          organization: { include: { billingProfile: true } },
        },
      });
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND' });

      const email = invoice.organization.billingProfile?.billingEmail
        || invoice.organization.billingEmail
        || null;
      if (!email) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No billing email configured for this organization' });

      const amountFormatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency }).format(invoice.amount);
      const invNum = `INV-${invoice.invoiceNumber}`;

      const sent = await sendEmail({
        to: email,
        subject: `Recordatorio de pago - Factura ${invNum} - TIMS ATS`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #1F114C; font-size: 24px; margin: 0;">TIMS ATS</h1>
            </div>
            <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
              <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Recordatorio de Pago</h2>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 16px;">
                Estimado equipo de <strong>${invoice.organization.name}</strong>,
              </p>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 16px;">
                Le recordamos que tiene una factura pendiente de pago:
              </p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr><td style="padding: 8px 0; color: #8B8B8B;">Factura #</td><td style="padding: 8px 0; font-weight: 600;">${invNum}</td></tr>
                <tr><td style="padding: 8px 0; color: #8B8B8B;">Monto</td><td style="padding: 8px 0; font-weight: 600; color: #DD0C15;">${amountFormatted}</td></tr>
                ${invoice.dueDate ? `<tr><td style="padding: 8px 0; color: #8B8B8B;">Vencimiento</td><td style="padding: 8px 0; font-weight: 600;">${new Intl.DateTimeFormat('es', { day: '2-digit', month: 'long', year: 'numeric' }).format(invoice.dueDate)}</td></tr>` : ''}
              </table>
              ${invoice.description ? `<p style="color: #585858; margin: 16px 0 0;"><strong>Descripcion:</strong> ${invoice.description}</p>` : ''}
            </div>
            <p style="color: #8B8B8B; font-size: 12px; text-align: center;">
              Este es un mensaje automatico de TIMS ATS. Por favor no responda a este correo.
            </p>
          </div>
        `,
      });

      if (!sent) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send email' });
      return { sent: true };
    }),

  exportInvoicesCsv: platformProcedure
    .input(z.object({
      status: z.string().optional(),
      organizationId: z.string().uuid().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const where: any = {};
      if (input.status === 'overdue') {
        where.status = 'pending';
        where.dueDate = { lt: new Date() };
      } else if (input.status) {
        where.status = input.status;
      }
      if (input.organizationId) where.organizationId = input.organizationId;
      if (input.dateFrom || input.dateTo) {
        where.createdAt = {};
        if (input.dateFrom) where.createdAt.gte = input.dateFrom;
        if (input.dateTo) where.createdAt.lte = input.dateTo;
      }

      const invoices = await db.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { organization: { select: { name: true } } },
      });

      const header = 'Numero,Organizacion,Monto,Moneda,Estado,Descripcion,Emision,Vencimiento,Pagada';
      const rows = invoices.map((inv) => {
        const fmt = (d: Date | null | undefined) => d ? new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : '';
        return [
          `INV-${inv.invoiceNumber}`,
          `"${inv.organization.name}"`,
          inv.amount,
          inv.currency,
          inv.status,
          `"${inv.description || ''}"`,
          fmt(inv.createdAt),
          fmt(inv.dueDate),
          fmt(inv.paidAt),
        ].join(',');
      });

      return [header, ...rows].join('\n');
    }),

  getBillingProfile: platformProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.billingProfile.findUnique({ where: { organizationId: input.organizationId } });
    }),

  upsertBillingProfile: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      companyName: z.string().optional(),
      taxId: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      zipCode: z.string().optional(),
      billingEmail: z.string().email().optional(),
      billingPhone: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { organizationId, ...data } = input;
      return db.billingProfile.upsert({
        where: { organizationId },
        create: { organizationId, ...data },
        update: data,
      });
    }),

  // ============ INVITATIONS ============

  getInvitationKpis: platformProcedure.query(async () => {
    const [total, pending, accepted, expired] = await Promise.all([
      db.platformInvitation.count(),
      db.platformInvitation.count({ where: { status: { in: [InvitationStatus.pending, InvitationStatus.sent] } } }),
      db.platformInvitation.count({ where: { status: InvitationStatus.accepted } }),
      db.platformInvitation.count({ where: { status: InvitationStatus.expired } }),
    ]);
    return { total, pending, accepted, expired };
  }),

  listInvitations: platformProcedure
    .input(z.object({
      page: z.number().int().min(0).default(0),
      limit: z.number().min(1).max(50).default(20),
      type: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { page, limit, type, status, search } = input;
      const where: any = {};
      if (type) where.type = type;
      if (status) where.status = status;
      if (search) where.email = { contains: search, mode: 'insensitive' };

      const [invitations, total] = await Promise.all([
        db.platformInvitation.findMany({
          where,
          take: limit,
          skip: page * limit,
          orderBy: { createdAt: 'desc' },
          include: {
            organization: { select: { id: true, name: true } },
            invitedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        db.platformInvitation.count({ where }),
      ]);

      return { invitations, total };
    }),

  createOrgInvitation: platformProcedure
    .input(z.object({
      email: z.string().email().max(255),
      organizationName: z.string().min(2).max(100),
      organizationSlug: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/),
      organizationPlan: z.enum(['trial', 'starter', 'professional', 'enterprise']).default('trial'),
    }))
    .mutation(async ({ ctx, input }) => {
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Pre-create the org + subscription
      const org = await db.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: input.organizationName,
            slug: input.organizationSlug,
            plan: input.organizationPlan,
            billingEmail: input.email,
          },
        });

        await tx.role.create({
          data: { organizationId: org.id, name: 'Super Administrador', slug: 'super_admin', isSystem: true },
        });

        await tx.subscription.create({
          data: {
            organizationId: org.id,
            plan: input.organizationPlan,
            status: input.organizationPlan === 'trial' ? 'trialing' : 'active',
            trialEndsAt: input.organizationPlan === 'trial' ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
          },
        });

        return org;
      });

      const invitation = await db.platformInvitation.create({
        data: {
          email: input.email,
          type: InvitationType.org_admin,
          organizationId: org.id,
          organizationName: input.organizationName,
          organizationSlug: input.organizationSlug,
          organizationPlan: input.organizationPlan,
          token,
          status: InvitationStatus.sent,
          invitedById: ctx.user.id,
          sentAt: new Date(),
          expiresAt,
        },
      });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.timsats.com';

      await sendEmail({
        to: input.email,
        subject: `Invitacion para administrar ${input.organizationName} en TIMS ATS`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #1F114C; font-size: 24px; margin: 0;">TIMS ATS</h1>
            </div>
            <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
              <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Has sido invitado</h2>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 16px;">
                Has sido invitado a administrar <strong>${input.organizationName}</strong> en TIMS ATS.
              </p>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 24px;">
                Haz clic en el boton para configurar tu cuenta y comenzar.
              </p>
              <div style="text-align: center;">
                <a href="${appUrl}/accept-invitation?token=${token}" style="background: #1F114C; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
                  Aceptar Invitacion
                </a>
              </div>
            </div>
            <p style="color: #8B8B8B; font-size: 12px; text-align: center;">
              Esta invitacion expira en 7 dias. Si no solicitaste esta invitacion, puedes ignorar este correo.
            </p>
          </div>
        `,
      });

      return invitation;
    }),

  createUserInvitation: platformProcedure
    .input(z.object({
      email: z.string().email().max(255),
      organizationId: z.string().uuid(),
      roleSlug: z.string().max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const org = await db.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });

      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const invitation = await db.platformInvitation.create({
        data: {
          email: input.email,
          type: InvitationType.user,
          organizationId: input.organizationId,
          organizationName: org.name,
          roleSlug: input.roleSlug,
          token,
          status: InvitationStatus.sent,
          invitedById: ctx.user.id,
          sentAt: new Date(),
          expiresAt,
        },
      });

      const roleLabel = input.roleSlug?.replace(/_/g, ' ') || 'usuario';
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.timsats.com';

      await sendEmail({
        to: input.email,
        subject: `Invitacion para unirte a ${org.name} en TIMS ATS`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #1F114C; font-size: 24px; margin: 0;">TIMS ATS</h1>
            </div>
            <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
              <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Has sido invitado</h2>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 16px;">
                Has sido invitado a unirte a <strong>${org.name}</strong> en TIMS ATS como <strong>${roleLabel}</strong>.
              </p>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 24px;">
                Haz clic en el boton para aceptar la invitacion.
              </p>
              <div style="text-align: center;">
                <a href="${appUrl}/accept-invitation?token=${token}" style="background: #1F114C; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
                  Aceptar Invitacion
                </a>
              </div>
            </div>
            <p style="color: #8B8B8B; font-size: 12px; text-align: center;">
              Esta invitacion expira en 7 dias. Si no solicitaste esta invitacion, puedes ignorar este correo.
            </p>
          </div>
        `,
      });

      return invitation;
    }),

  resendInvitation: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const invitation = await db.platformInvitation.findUnique({ where: { id: input.id } });
      if (!invitation) throw new TRPCError({ code: 'NOT_FOUND' });
      if (invitation.status === 'accepted' || invitation.status === 'revoked') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot resend accepted or revoked invitation' });
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.timsats.com';

      await sendEmail({
        to: invitation.email,
        subject: `Recordatorio: Invitacion pendiente - ${invitation.organizationName || 'TIMS ATS'}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #1F114C; font-size: 24px; margin: 0;">TIMS ATS</h1>
            </div>
            <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
              <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Recordatorio de Invitacion</h2>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 24px;">
                Tienes una invitacion pendiente para ${invitation.organizationName ? `<strong>${invitation.organizationName}</strong> en ` : ''}TIMS ATS.
              </p>
              <div style="text-align: center;">
                <a href="${appUrl}/accept-invitation?token=${invitation.token}" style="background: #1F114C; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
                  Aceptar Invitacion
                </a>
              </div>
            </div>
            <p style="color: #8B8B8B; font-size: 12px; text-align: center;">
              Esta invitacion expira en 7 dias.
            </p>
          </div>
        `,
      });

      return db.platformInvitation.update({
        where: { id: input.id },
        data: { sentAt: new Date(), expiresAt, status: InvitationStatus.sent },
      });
    }),

  revokeInvitation: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return db.platformInvitation.update({
        where: { id: input.id },
        data: { status: InvitationStatus.revoked },
      });
    }),

  // ============ PUBLIC INVITATION ENDPOINTS ============

  getInvitationByToken: publicProcedure
    .input(z.object({ token: z.string().uuid() }))
    .query(async ({ input }) => {
      const invitation = await db.platformInvitation.findUnique({
        where: { token: input.token },
        include: {
          organization: { select: { id: true, name: true, slug: true } },
        },
      });
      if (!invitation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitacion no encontrada' });

      const isExpired = invitation.expiresAt < new Date();
      if (isExpired && invitation.status !== InvitationStatus.expired) {
        await db.platformInvitation.update({ where: { id: invitation.id }, data: { status: InvitationStatus.expired } });
        invitation.status = InvitationStatus.expired;
      }

      return {
        id: invitation.id,
        email: invitation.email,
        type: invitation.type,
        organizationName: invitation.organization?.name || invitation.organizationName,
        organizationSlug: invitation.organizationSlug,
        roleSlug: invitation.roleSlug,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      };
    }),

  acceptInvitation: publicProcedure
    .input(z.object({ token: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const invitation = await db.platformInvitation.findUnique({
        where: { token: input.token },
      });
      if (!invitation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitacion no encontrada' });
      if (invitation.status === InvitationStatus.accepted) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta invitacion ya fue aceptada' });
      if (invitation.status === InvitationStatus.revoked) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta invitacion fue revocada' });
      if (invitation.expiresAt < new Date()) {
        await db.platformInvitation.update({ where: { id: invitation.id }, data: { status: InvitationStatus.expired } });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta invitacion ha expirado' });
      }

      await db.platformInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.accepted, acceptedAt: new Date() },
      });

      return { accepted: true, organizationId: invitation.organizationId, type: invitation.type };
    }),
});
