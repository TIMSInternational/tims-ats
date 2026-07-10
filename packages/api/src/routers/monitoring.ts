import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { ALERT_METRIC_KEYS } from '@tims/shared';
import { suppressBelowMin5 } from '../access';

export const monitoringRouter = router({
  // ── Executive KPIs ─────────────────────────────────────────────────
  getExecutiveKpis: permissionProcedure('monitoring', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const [
      totalUsers,
      activeVacancies,
      pendingAdjustments,
      activeSurveys,
      openAlerts,
    ] = await Promise.all([
      db.user.count({ where: { organizationId: orgId, isActive: true } }),
      db.vacancy.count({ where: { organizationId: orgId, status: { in: ['approved', 'published'] }, deletedAt: null } }),
      db.salaryAdjustment.count({ where: { organizationId: orgId, status: 'pending' } }),
      db.survey.count({ where: { organizationId: orgId, status: 'active' } }),
      db.alert.count({ where: { organizationId: orgId, status: 'active' } }),
    ]);

    // Raw-scalar floor (slice 6 round 8): pendingAdjustments is a raw COUNT over
    // SalaryAdjustment, a §21-restricted sensitive population. monitoring:read (which
    // hr_admin holds per seed) would otherwise receive an exact 1..4 count — a sub-floor
    // disclosure. Route it through suppressBelowMin5: null + suppressed flag for 1..4
    // (mirrors compensation getDashboardKpis). 0 passes through (reveals no one). The
    // other KPIs (users/vacancies/surveys/alerts) are not over a restricted model.
    const pendingFloor = suppressBelowMin5(pendingAdjustments);

    return {
      totalEmployees: totalUsers,
      activeVacancies,
      pendingAdjustments: pendingFloor.count,
      pendingAdjustmentsSuppressed: pendingFloor.suppressed,
      activeSurveys,
      openAlerts,
      turnoverRate: 0,
      terminationsLast12m: 0,
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
        module: z.string().max(100).optional(),
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
          select: {
            id: true,
            severity: true,
            module: true,
            title: true,
            message: true,
            createdAt: true,
          },
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
        },
        select: { id: true, status: true },
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

      // Build the month window labels and date boundaries first.
      const window: { label: string; monthStart: Date; monthEnd: Date }[] = [];
      for (let i = months - 1; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        window.push({
          label,
          monthStart: new Date(date.getFullYear(), date.getMonth(), 1),
          monthEnd: new Date(date.getFullYear(), date.getMonth() + 1, 0),
        });
      }

      // Non-sensitive metrics: headcount (User), alerts (Alert). Apply per-point as before.
      // Sensitive metrics: engagement (SurveyResponse) — §21-restricted population.
      //
      // SLICE 6 (all-or-nothing, round 11): per-point suppression on the engagement metric
      // is insufficient — a caller who knows the window total (e.g. from
      // getExecutiveKpis or getDashboardKpis) can subtract visible months to recover a
      // suppressed month's exact count (monthly-differencing oracle). Example: 1 survey,
      // 8 responses, Jan=5 Feb=3 → per-point: Jan=5, Feb=null; caller computes 8−5=3.
      //
      // Fix: compute ALL monthly counts first, then if ANY month is 1..4 (sub-floor),
      // null EVERY month in the series and mark suppressed=true on every point. This
      // removes every complementary bucket a differencing attack could use.
      //
      // Metrics treated as SENSITIVE here (count a §21-restricted model):
      //   • engagement → surveyResponse
      // Non-sensitive (headcount → User; alerts → Alert; turnover → not tracked):
      //   those models are not §21-restricted; per-point suppression is not needed.

      if (input.metric === 'engagement') {
        // Phase 1: fetch all monthly raw counts.
        const rawCounts = await Promise.all(
          window.map(({ monthStart, monthEnd }) =>
            db.surveyResponse.count({
              where: {
                organizationId: orgId,
                submittedAt: { gte: monthStart, lte: monthEnd },
              },
            }),
          ),
        );

        // Phase 2: all-or-nothing gate. If ANY month is sub-floor (1..4), suppress all.
        const anyMonthSubFloor = rawCounts.some((c) => suppressBelowMin5(c).suppressed);
        const dataPoints = window.map(({ label }, idx) => ({
          month: label,
          value: anyMonthSubFloor ? null : rawCounts[idx] ?? null,
          suppressed: anyMonthSubFloor,
        }));

        return { metric: input.metric, period: input.period, data: dataPoints };
      }

      // Non-sensitive metrics: compute and return per point (no floor needed).
      // value is nullable for shape compatibility with the engagement branch.
      const dataPoints: { month: string; value: number | null; suppressed: boolean }[] = [];

      for (const { label, monthStart, monthEnd } of window) {
        let value: number | null = 0;

        if (input.metric === 'headcount') {
          value = await db.user.count({
            where: {
              organizationId: orgId,
              isActive: true,
              createdAt: { lte: monthEnd },
            },
          });
        } else if (input.metric === 'alerts') {
          value = await db.alert.count({
            where: {
              organizationId: orgId,
              createdAt: { gte: monthStart, lte: monthEnd },
            },
          });
        }
        // 'turnover' not tracked without Employee model — value stays 0.

        dataPoints.push({ month: label, value, suppressed: false });
      }

      return { metric: input.metric, period: input.period, data: dataPoints };
    }),

  // ── Alert Rules ────────────────────────────────────────────────────
  getAlertRules: permissionProcedure('monitoring', 'read').query(async ({ ctx }) => {
    return db.alertRule.findMany({
      where: { organizationId: ctx.user.organizationId },
      select: {
        id: true,
        module: true,
        condition: true,
        severity: true,
        message: true,
        isActive: true,
      },
      orderBy: [{ module: 'asc' }],
    });
  }),

  configureAlertRules: permissionProcedure('monitoring', 'update')
    .input(
      z.object({
        rules: z.array(
          z.object({
            id: z.string().uuid().optional(),
            module: z.string().max(100),
            condition: z.object({
              // Constrained to the shared metric registry so the cron engine can
              // actually evaluate every rule the UI writes (no free-text metrics).
              metric: z.enum(ALERT_METRIC_KEYS),
              operator: z.enum(['gt', 'lt', 'eq', 'gte', 'lte']),
              threshold: z.number().finite(),
            }),
            severity: z.enum(['info', 'warning', 'critical']),
            message: z.string().min(1).max(500),
            isActive: z.boolean().default(true),
          }),
        ).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Deliberately NOT wrapped in an interactive `$transaction`: this router uses
      // `tenantDb` (RLS), whose extension sets the org GUC/role per-operation; an
      // interactive `$transaction(tx => …)` would not carry that GUC into the tx and
      // would fail closed under RLS. Rules are independent rows and the input is
      // pre-validated, so a partial save is recoverable (admin re-saves; the client
      // surfaces the error via onError). See RLS notes in .claude/rules/api-security.md.
      const select = { id: true, module: true, severity: true, isActive: true } as const;
      const results = [];

      for (const rule of input.rules) {
        if (rule.id) {
          const updated = await db.alertRule.update({
            where: { id: rule.id, organizationId: ctx.user.organizationId },
            data: {
              module: rule.module,
              condition: rule.condition as unknown as Prisma.JsonObject,
              severity: rule.severity,
              message: rule.message,
              isActive: rule.isActive,
            },
            select,
          });
          results.push(updated);
        } else {
          const created = await db.alertRule.create({
            data: {
              module: rule.module,
              condition: rule.condition as unknown as Prisma.JsonObject,
              severity: rule.severity,
              message: rule.message,
              isActive: rule.isActive,
              organizationId: ctx.user.organizationId,
              createdById: ctx.user.id,
            },
            select,
          });
          results.push(created);
        }
      }

      return results;
    }),
});
