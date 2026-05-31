import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

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
      db.subscription.count({ where: { status: 'trialing' } }),
      db.subscription.findMany({ where: { status: 'active' } }),
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

  // ============ ORGANIZATIONS ============

  listOrganizations: platformProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      limit: z.number().min(1).max(50).default(20),
      search: z.string().optional(),
      plan: z.string().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { cursor, limit, search, plan, status } = input;

      const where: any = {};
      if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search, mode: 'insensitive' } }];
      if (plan) where.plan = plan;
      if (status === 'active') where.isActive = true;
      if (status === 'suspended') where.isActive = false;

      const orgs = await db.organization.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { users: true } },
          subscription: { select: { plan: true, status: true, trialEndsAt: true } },
        },
      });

      let nextCursor: string | undefined;
      if (orgs.length > limit) { const n = orgs.pop(); nextCursor = n?.id; }

      const total = await db.organization.count({ where });

      return { organizations: orgs, nextCursor, total };
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
      return db.$transaction(async (tx) => {
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
      return db.organization.update({
        where: { id: input.id },
        data: { isActive: !input.suspend },
      });
    }),

  // ============ USERS ============

  listAllUsers: platformProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      limit: z.number().min(1).max(50).default(20),
      search: z.string().optional(),
      organizationId: z.string().uuid().optional(),
      isPlatformOwner: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const { cursor, limit, search, organizationId, isPlatformOwner, isActive } = input;

      const where: any = {};
      if (search) where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
      if (organizationId) where.organizationId = organizationId;
      if (isPlatformOwner !== undefined) where.isPlatformOwner = isPlatformOwner;
      if (isActive !== undefined) where.isActive = isActive;

      const users = await db.user.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          organization: { select: { id: true, name: true } },
          userRoles: { include: { role: { select: { name: true, slug: true } } } },
        },
      });

      let nextCursor: string | undefined;
      if (users.length > limit) { const n = users.pop(); nextCursor = n?.id; }

      const total = await db.user.count({ where });

      return { users, nextCursor, total };
    }),

  // ============ SUBSCRIPTIONS ============

  listSubscriptions: platformProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      limit: z.number().min(1).max(50).default(20),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { cursor, limit, status } = input;
      const where: any = {};
      if (status) where.status = status;

      const subs = await db.subscription.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          organization: { select: { id: true, name: true, slug: true } },
        },
      });

      let nextCursor: string | undefined;
      if (subs.length > limit) { const n = subs.pop(); nextCursor = n?.id; }

      return { subscriptions: subs, nextCursor };
    }),

  updateSubscription: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      plan: z.string().optional(),
      status: z.string().optional(),
      trialEndsAt: z.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const { organizationId, ...data } = input;
      return db.subscription.update({ where: { organizationId }, data });
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
    // Real checks where possible, mock for external services
    let dbHealthy = false;
    try {
      await db.$queryRaw`SELECT 1`;
      dbHealthy = true;
    } catch {}

    const userCount = await db.user.count();
    const orgCount = await db.organization.count();

    return {
      services: [
        { name: 'API Gateway', status: 'operational' as const, latency: '45ms', uptime: '99.99%' },
        { name: 'Base de Datos', status: dbHealthy ? 'operational' as const : 'degraded' as const, detail: `${orgCount} orgs, ${userCount} users` },
        { name: 'Autenticacion', status: 'operational' as const, detail: 'Supabase Auth' },
        { name: 'Almacenamiento', status: 'operational' as const, detail: 'Supabase Storage' },
        { name: 'Background Jobs', status: 'operational' as const, detail: 'Trigger.dev' },
        { name: 'AI (Bedrock)', status: 'operational' as const, detail: 'Claude Haiku/Sonnet' },
        { name: 'Email (SES)', status: 'operational' as const, detail: 'AWS SES' },
        { name: 'Realtime', status: 'operational' as const, detail: 'Supabase Realtime' },
      ],
      overall: dbHealthy ? 'operational' : 'degraded',
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
});
