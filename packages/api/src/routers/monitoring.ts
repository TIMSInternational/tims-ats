import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { db } from '@tims/db';

export const monitoringRouter = router({
  // ── Executive KPIs ─────────────────────────────────────────────────
  getExecutiveKpis: permissionProcedure('monitoring', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const [
      totalEmployees,
      activeVacancies,
      pendingAdjustments,
      activeSurveys,
      openAlerts,
    ] = await Promise.all([
      db.employee.count({ where: { organizationId: orgId, isActive: true } }),
      db.vacancy.count({ where: { organizationId: orgId, status: 'open' } }),
      db.salaryAdjustment.count({ where: { organizationId: orgId, status: 'pending' } }),
      db.survey.count({ where: { organizationId: orgId, status: 'active' } }),
      db.alert.count({ where: { organizationId: orgId, status: 'active' } }),
    ]);

    // Turnover rate (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    const terminations = await db.employee.count({
      where: {
        organizationId: orgId,
        isActive: false,
        terminationDate: { gte: twelveMonthsAgo },
      },
    });

    const turnoverRate = totalEmployees
      ? Math.round((terminations / totalEmployees) * 10000) / 100
      : 0;

    return {
      totalEmployees,
      activeVacancies,
      pendingAdjustments,
      activeSurveys,
      openAlerts,
      turnoverRate,
      terminationsLast12m: terminations,
    };
  }),

  // ── Module Health ──────────────────────────────────────────────────
  getModuleHealth: permissionProcedure('monitoring', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const modules = [
      'recruitment',
      'onboarding',
      'people',
      'engagement',
      'compensation',
      'dei',
      'time',
      'performance',
    ];

    const alertCounts = await db.alert.groupBy({
      by: ['module'],
      where: { organizationId: orgId, status: 'active' },
      _count: { id: true },
    });

    const alertMap: Record<string, number> = {};
    for (const a of alertCounts) {
      alertMap[a.module] = a._count.id;
    }

    return modules.map((mod) => ({
      module: mod,
      activeAlerts: alertMap[mod] || 0,
      status: !alertMap[mod] ? 'healthy' : alertMap[mod] <= 2 ? 'warning' : 'critical',
    }));
  }),

  // ── Alerts ─────────────────────────────────────────────────────────
  getActiveAlerts: permissionProcedure('monitoring', 'read')
    .input(
      z.object({
        module: z.string().optional(),
        severity: z.enum(['info', 'warning', 'critical']).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const { module, severity, page = 1, limit = 20 } = input ?? {};
      const where = {
        organizationId: ctx.user.organizationId,
        status: 'active' as const,
        ...(module ? { module } : {}),
        ...(severity ? { severity } : {}),
      };

      const [items, total] = await Promise.all([
        db.alert.findMany({
          where,
          orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.alert.count({ where }),
      ]);

      return { items, total, page, limit };
    }),

  dismissAlert: permissionProcedure('monitoring', 'update')
    .input(
      z.object({
        alertId: z.string().uuid(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return db.alert.update({
        where: {
          id: input.alertId,
          organizationId: ctx.user.organizationId,
        },
        data: {
          status: 'dismissed',
          dismissedById: ctx.user.id,
          dismissedAt: new Date(),
          dismissReason: input.reason,
        },
      });
    }),

  // ── Cross-Module Trend ─────────────────────────────────────────────
  getCrossModuleTrend: permissionProcedure('monitoring', 'read')
    .input(
      z.object({
        metric: z.enum(['headcount', 'turnover', 'engagement', 'alerts']),
        period: z.enum(['6m', '12m', '24m']).default('12m'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = ctx.user.organizationId;
      const months = input.period === '6m' ? 6 : input.period === '12m' ? 12 : 24;
      const dataPoints: { month: string; value: number }[] = [];

      for (let i = months - 1; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        let value = 0;

        if (input.metric === 'headcount') {
          value = await db.employee.count({
            where: {
              organizationId: orgId,
              hireDate: { lte: monthEnd },
              OR: [
                { isActive: true },
                { terminationDate: { gt: monthEnd } },
              ],
            },
          });
        } else if (input.metric === 'turnover') {
          value = await db.employee.count({
            where: {
              organizationId: orgId,
              isActive: false,
              terminationDate: { gte: monthStart, lte: monthEnd },
            },
          });
        } else if (input.metric === 'engagement') {
          const responses = await db.surveyResponse.count({
            where: {
              organizationId: orgId,
              createdAt: { gte: monthStart, lte: monthEnd },
            },
          });
          value = responses;
        } else if (input.metric === 'alerts') {
          value = await db.alert.count({
            where: {
              organizationId: orgId,
              createdAt: { gte: monthStart, lte: monthEnd },
            },
          });
        }

        dataPoints.push({ month: label, value });
      }

      return { metric: input.metric, period: input.period, data: dataPoints };
    }),

  // ── Alert Rules ────────────────────────────────────────────────────
  getAlertRules: permissionProcedure('monitoring', 'read').query(async ({ ctx }) => {
    return db.alertRule.findMany({
      where: { organizationId: ctx.user.organizationId },
      orderBy: [{ module: 'asc' }, { name: 'asc' }],
    });
  }),

  configureAlertRules: permissionProcedure('monitoring', 'update')
    .input(
      z.object({
        rules: z.array(
          z.object({
            id: z.string().uuid().optional(),
            name: z.string().min(1).max(200),
            module: z.string(),
            condition: z.object({
              metric: z.string(),
              operator: z.enum(['gt', 'lt', 'eq', 'gte', 'lte']),
              threshold: z.number(),
            }),
            severity: z.enum(['info', 'warning', 'critical']),
            isActive: z.boolean().default(true),
            notifyRoles: z.array(z.string()).optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const results = [];

      for (const rule of input.rules) {
        if (rule.id) {
          const updated = await db.alertRule.update({
            where: { id: rule.id, organizationId: ctx.user.organizationId },
            data: {
              name: rule.name,
              module: rule.module,
              condition: rule.condition,
              severity: rule.severity,
              isActive: rule.isActive,
              notifyRoles: rule.notifyRoles,
            },
          });
          results.push(updated);
        } else {
          const created = await db.alertRule.create({
            data: {
              ...rule,
              organizationId: ctx.user.organizationId,
              createdById: ctx.user.id,
            },
          });
          results.push(created);
        }
      }

      return results;
    }),
});
