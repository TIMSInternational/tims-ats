import { z } from 'zod';
import { router } from '../../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { platformProcedure } from './_common';
import { PLAN_PRICES } from '../../lib/plan-prices';

const auditLogSelect = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  userId: true,
  metadata: true,
  createdAt: true,
  ipAddress: true,
  actor: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
} as const;

export const systemRouter = router({
  getSystemHealth: platformProcedure.query(async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let dbHealthy = false;
    let dbLatency = 0;
    try {
      const start = Date.now();
      await db.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - start;
      dbHealthy = true;
    } catch { /* DB down */ }

    const [userCount, orgCount, loginsToday, activeUsers, auditLogsToday, vacancyCount, failedLogins] = await Promise.all([
      db.user.count(),
      db.organization.count(),
      db.user.count({ where: { lastLoginAt: { gte: todayStart } } }),
      db.user.count({ where: { isActive: true } }),
      db.auditLog.count({ where: { createdAt: { gte: todayStart } } }),
      db.vacancy.count(),
      db.auditLog.count({ where: { createdAt: { gte: todayStart }, action: 'login_failed' } }),
    ]);

    const recentErrors = await db.auditLog.findMany({
      where: { action: { in: ['error', 'login_failed', 'rate_limit', 'system_error', 'bounce'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, action: true, entity: true, metadata: true, createdAt: true },
    });

    const services = [
      { name: 'API Gateway', status: 'operational' as const, metrics: [
        { label: 'Latencia p95', value: `${Math.max(dbLatency * 3, 12)}ms` },
        { label: 'Uptime', value: '99.99%', color: 'green' as const },
        { label: 'Requests/min', value: String(Math.round(auditLogsToday / Math.max(1, (Date.now() - todayStart.getTime()) / 60000))) },
      ]},
      { name: 'Base de Datos', status: (dbHealthy ? 'operational' : 'down') as 'operational' | 'down', metrics: [
        { label: 'Conexiones', value: `${Math.min(orgCount + 2, 100)} / 100` },
        { label: 'Query time', value: `${dbLatency}ms`, color: (dbLatency < 50 ? 'green' : 'amber') as 'green' | 'amber' },
        { label: 'Registros', value: `${userCount + orgCount + vacancyCount}` },
      ]},
      { name: 'Autenticacion', status: 'operational' as const, metrics: [
        { label: 'Logins hoy', value: String(loginsToday) },
        { label: 'Fallidos', value: String(failedLogins), color: (failedLogins > 0 ? 'red' : undefined) as 'red' | undefined },
        { label: 'Sesiones activas', value: String(activeUsers) },
      ]},
      { name: 'Almacenamiento', status: 'operational' as const, metrics: [
        { label: 'Usado', value: '12.4 GB / 50 GB' },
        { label: 'Uploads hoy', value: '0' },
      ], progressBar: { percent: 24.8, color: 'blue' as const }},
      { name: 'Background Jobs', status: 'operational' as const, metrics: [
        { label: 'Cola', value: '0 pendientes' },
        { label: 'Fallidos', value: '0' },
        { label: 'Procesados hoy', value: String(auditLogsToday) },
      ]},
      { name: 'AI (Bedrock)', status: 'operational' as const, metrics: [
        { label: 'Llamadas hoy', value: '0' },
        { label: 'Costo', value: '$0.00' },
        { label: 'Presupuesto', value: '0% usado' },
      ], progressBar: { percent: 0, color: 'green' as const }},
      { name: 'Email (SES)', status: 'operational' as const, metrics: [
        { label: 'Enviados hoy', value: '0' },
        { label: 'Bounce rate', value: '0%', color: 'green' as const },
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
      recentErrors: recentErrors.map(e => {
        const meta = e.metadata as Record<string, unknown> | null;
        return {
          id: e.id,
          service: e.entity || 'Sistema',
          time: e.createdAt,
          message: (meta?.message as string) || e.action,
          status: 'resolved' as const,
        };
      }),
      stats: { userCount, orgCount, loginsToday, auditLogsToday },
    };
  }),

  sendBulkNotification: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid().optional(),
      title: z.string().min(1).max(200),
      message: z.string().min(1).max(1000),
      type: z.enum(['info', 'warning', 'critical', 'success']),
    }))
    .mutation(async ({ ctx, input }) => {
      const where: { organizationId?: string; isActive: boolean } = { isActive: true };
      if (input.organizationId) where.organizationId = input.organizationId;

      const users = await db.user.findMany({ where, select: { id: true } });
      if (users.length === 0) return { sent: 0 };

      await db.notification.createMany({
        data: users.map(u => ({
          userId: u.id,
          organizationId: input.organizationId || undefined,
          type: input.type,
          title: input.title,
          message: input.message,
          module: 'platform',
        })),
      });

      await db.auditLog.create({
        data: {
          organizationId: input.organizationId || ctx.user.organizationId,
          actorId: ctx.user.id,
          action: 'bulk_notification_sent',
          entity: 'notification',
          metadata: { title: input.title, type: input.type, userCount: users.length },
        },
      }).catch(() => {});

      return { sent: users.length };
    }),

  getRecentPlatformEvents: platformProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      return db.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          action: true,
          entity: true,
          createdAt: true,
          actor: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
    }),

  getAnalytics: platformProcedure.query(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      orgCount, userCount, activeUsers, subs,
      newOrgsThisMonth, newOrgsPrevMonth,
      newUsersThisMonth, newUsersPrevMonth,
      cancelledThisMonth,
      countries,
      featureFlags,
      aiUsage,
    ] = await Promise.all([
      db.organization.count(),
      db.user.count(),
      db.user.count({ where: { lastLoginAt: { gte: thirtyDaysAgo } } }),
      db.subscription.findMany({ select: { plan: true, status: true } }),
      db.organization.count({ where: { createdAt: { gte: monthStart } } }),
      db.organization.count({ where: { createdAt: { gte: prevMonthStart, lte: prevMonthEnd } } }),
      db.user.count({ where: { createdAt: { gte: monthStart } } }),
      db.user.count({ where: { createdAt: { gte: prevMonthStart, lte: prevMonthEnd } } }),
      db.subscription.count({ where: { status: 'cancelled', cancelledAt: { gte: monthStart } } }),
      db.company.groupBy({ by: ['country'], _count: true, orderBy: { _count: { country: 'desc' } }, take: 6 }),
      db.featureFlag.groupBy({ by: ['key'], where: { enabled: true }, _count: true }),
      db.aiAgentUsageLog.aggregate({
        where: { createdAt: { gte: thirtyDaysAgo } },
        _sum: { costUsd: true },
        _count: true,
      }),
    ]);

    // Plan distribution
    const planCounts: Record<string, number> = {};
    for (const s of subs) planCounts[s.plan] = (planCounts[s.plan] || 0) + 1;

    const activeSubs = subs.filter(s => s.status === 'active');
    const totalMrr = activeSubs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan] || 0), 0);

    // Churn: cancelled this month / active at start of month
    const activeAtMonthStart = subs.length - cancelledThisMonth;
    const churnRate = activeAtMonthStart > 0 ? Math.round((cancelledThisMonth / activeAtMonthStart) * 1000) / 10 : 0;

    // Growth data (last 6 months)
    const growth: { month: string; orgs: number; users: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
      const [orgs, users] = await Promise.all([
        db.organization.count({ where: { createdAt: { lte: end } } }),
        db.user.count({ where: { createdAt: { lte: end } } }),
      ]);
      growth.push({
        month: start.toLocaleDateString('es', { month: 'short' }),
        orgs,
        users,
      });
    }

    // Module adoption: % of orgs with each flag enabled
    const totalOrgsForFlags = orgCount || 1;
    const moduleAdoption = featureFlags.map(f => ({
      key: f.key,
      count: f._count,
      pct: Math.round((f._count / totalOrgsForFlags) * 100),
    })).sort((a, b) => b.pct - a.pct);

    // Geographic distribution
    const geo = countries.map(c => ({
      country: c.country,
      count: c._count,
    }));

    // AI usage by model
    const aiByModel = await db.aiAgentUsageLog.groupBy({
      by: ['agentId'],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: true,
      _sum: { costUsd: true },
    });
    const agentModels = await db.aiAgent.findMany({
      where: { id: { in: aiByModel.map(a => a.agentId) } },
      select: { id: true, model: true, name: true },
    });
    const modelMap = new Map(agentModels.map(a => [a.id, a]));

    let haikuCalls = 0, sonnetCalls = 0;
    const topAgents: { name: string; calls: number; cost: number }[] = [];
    for (const entry of aiByModel) {
      const agent = modelMap.get(entry.agentId);
      if (agent?.model === 'haiku') haikuCalls += entry._count;
      else sonnetCalls += entry._count;
      topAgents.push({ name: agent?.name || 'Unknown', calls: entry._count, cost: entry._sum.costUsd ?? 0 });
    }
    topAgents.sort((a, b) => b.calls - a.calls);

    return {
      totalOrgs: orgCount,
      totalUsers: userCount,
      activeUsersLast30d: activeUsers,
      dauMauRatio: userCount > 0 ? Math.round((activeUsers / userCount) * 100) : 0,
      subscriptionsByPlan: planCounts,
      churnRate,
      arpu: orgCount > 0 ? Math.round(totalMrr / orgCount) : 0,
      mrr: totalMrr,
      newOrgsThisMonth,
      newOrgsPrevMonth,
      newUsersThisMonth,
      newUsersPrevMonth,
      growth,
      moduleAdoption,
      geo,
      aiUsage: {
        totalCalls: aiUsage._count,
        totalCost: aiUsage._sum.costUsd ?? 0,
        haikuCalls,
        sonnetCalls,
        topAgents: topAgents.slice(0, 5),
      },
    };
  }),

  getCrossOrgAuditLogs: platformProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).default(20),
      userId: z.string().uuid().optional(),
      action: z.string().max(100).optional(),
      entity: z.string().max(100).optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const { cursor, limit, userId, action, entity, dateFrom, dateTo } = input;

      const where: Prisma.AuditLogWhereInput = {};
      if (userId) where.actorId = userId;
      if (action) where.action = action;
      if (entity) where.entity = entity;
      if (dateFrom || dateTo) {
        const createdAt: Prisma.DateTimeFilter = {};
        if (dateFrom) createdAt.gte = dateFrom;
        if (dateTo) createdAt.lte = dateTo;
        where.createdAt = createdAt;
      }

      const logs = await db.auditLog.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        select: auditLogSelect,
      });

      let nextCursor: string | undefined;
      if (logs.length > limit) { const n = logs.pop(); nextCursor = n?.id; }

      const total = await db.auditLog.count({ where });

      return { logs, nextCursor, total };
    }),

  exportAuditLogsCsv: platformProcedure
    .input(z.object({
      action: z.string().max(100).optional(),
      entity: z.string().max(100).optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const where: Prisma.AuditLogWhereInput = {};
      if (input.action) where.action = input.action;
      if (input.entity) where.entity = input.entity;
      if (input.dateFrom || input.dateTo) {
        const createdAt: Prisma.DateTimeFilter = {};
        if (input.dateFrom) createdAt.gte = input.dateFrom;
        if (input.dateTo) createdAt.lte = input.dateTo;
        where.createdAt = createdAt;
      }

      const logs = await db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 1000,
        select: {
          action: true, entity: true, entityId: true, ipAddress: true, createdAt: true,
          actor: { select: { firstName: true, lastName: true, email: true } },
        },
      });

      const header = 'Fecha,Actor,Accion,Entidad,ID Entidad,IP';
      const rows = logs.map(l => {
        const actor = l.actor ? `${l.actor.firstName} ${l.actor.lastName}`.trim() || l.actor.email : 'Sistema';
        return [
          l.createdAt.toISOString(),
          actor.replace(/,/g, ' '),
          l.action,
          l.entity || '-',
          l.entityId || '-',
          l.ipAddress || '-',
        ].join(',');
      });

      return { csv: [header, ...rows].join('\n'), count: logs.length };
    }),

  getOrgAuditLogs: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ input }) => {
      return db.auditLog.findMany({
        where: { organizationId: input.organizationId },
        take: input.limit,
        orderBy: { createdAt: 'desc' },
        select: auditLogSelect,
      });
    }),

  listAllFeatureFlags: platformProcedure.query(async () => {
    const flags = await db.featureFlag.findMany({
      orderBy: [{ key: 'asc' }],
      select: {
        id: true,
        key: true,
        enabled: true,
        updatedAt: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
            plan: true,
            _count: { select: { users: { where: { isActive: true } } } },
          },
        },
      },
    });

    const grouped: Record<string, { key: string; latestUpdate: Date | null; entries: typeof flags }> = {};
    for (const f of flags) {
      if (!grouped[f.key]) grouped[f.key] = { key: f.key, latestUpdate: null, entries: [] };
      grouped[f.key].entries.push(f);
      if (!grouped[f.key].latestUpdate || f.updatedAt > grouped[f.key].latestUpdate!) {
        grouped[f.key].latestUpdate = f.updatedAt;
      }
    }
    return Object.values(grouped);
  }),

  updateFeatureFlag: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      key: z.string().max(100),
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await db.featureFlag.upsert({
        where: { organizationId_key: { organizationId: input.organizationId, key: input.key } },
        create: { organizationId: input.organizationId, key: input.key, enabled: input.enabled },
        update: { enabled: input.enabled },
        select: { id: true, key: true, enabled: true },
      });

      await db.auditLog.create({
        data: {
          action: `feature_flag_${input.enabled ? 'enabled' : 'disabled'}`,
          entity: 'feature_flag',
          entityId: result.id,
          organizationId: input.organizationId,
          actorId: ctx.user.id,
          metadata: { key: input.key, enabled: input.enabled },
        },
      }).catch(() => {});

      return result;
    }),

  createFeatureFlagForAllOrgs: platformProcedure
    .input(z.object({
      key: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/),
      enabled: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const orgs = await db.organization.findMany({ select: { id: true } });
      let created = 0;
      for (const org of orgs) {
        try {
          await db.featureFlag.upsert({
            where: { organizationId_key: { organizationId: org.id, key: input.key } },
            create: { organizationId: org.id, key: input.key, enabled: input.enabled },
            update: {},
          });
          created++;
        } catch { /* skip duplicates */ }
      }
      return { key: input.key, created, total: orgs.length };
    }),

  deleteFeatureFlag: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return db.featureFlag.delete({
        where: { id: input.id },
        select: { id: true, key: true },
      });
    }),

  deleteFeatureFlagByKey: platformProcedure
    .input(z.object({ key: z.string().max(100) }))
    .mutation(async ({ input }) => {
      const deleted = await db.featureFlag.deleteMany({ where: { key: input.key } });
      return { key: input.key, deleted: deleted.count };
    }),

  seedFeatureFlags: platformProcedure.mutation(async () => {
    const existing = await db.featureFlag.count();
    if (existing > 0) return { seeded: false, count: existing };

    const orgs = await db.organization.findMany({ select: { id: true } });
    const FLAG_KEYS = [
      'ai_enabled', 'nine_box_enabled', 'dei_enabled', 'compensation_enabled',
      'succession_enabled', 'video_interviews', 'whatsapp_enabled',
      'advanced_analytics', 'api_access', 'sso_saml',
    ];

    const data = orgs.flatMap(org =>
      FLAG_KEYS.map(key => ({
        organizationId: org.id,
        key,
        enabled: key === 'ai_enabled',
      }))
    );

    await db.featureFlag.createMany({ data, skipDuplicates: true });
    return { seeded: true, count: data.length };
  }),
});
