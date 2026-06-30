import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import { requireOrgScope } from '../../access';
import { cacheGet, cacheSet } from '../../lib/cache';

export const performanceDashboardRouter = router({
  // 11.16 — Dashboard KPIs
  getDashboardKpis: permissionProcedure('performance', 'read').query(async ({ ctx }) => {
    // Org-rollup aggregates over every user's performance data — interim org-gate
    // until scope-aware aggregation lands (slice 6). No-op at org/company scope.
    requireOrgScope(ctx.access);
    const orgId = ctx.user.organizationId;

    type KpiResult = {
      activeOkrs: number;
      averageOkrProgress: number;
      scheduledSessions: number;
      completedSessions: number;
      pendingCommitments: number;
      completedCommitments: number;
      commitmentCompletionRate: number;
      totalFeedback: number;
      totalRecognitions: number;
    };

    // Safe to key on orgId alone ONLY while requireOrgScope() gates this to org/company callers (no sub-org scope reaches here). If scope-aware aggregation is added later, the key MUST include scope identity (see vacancy/stats.ts).
    const cacheKey = `tims:kpis:performance:${orgId}`;
    const cached = await cacheGet<KpiResult>(cacheKey);
    if (cached) return cached;

    const [
      activeOkrs,
      avgOkrProgress,
      scheduledSessions,
      completedSessions,
      pendingCommitments,
      completedCommitments,
      totalFeedback,
      totalRecognitions,
    ] = await Promise.all([
      db.okr.count({
        where: { organizationId: orgId, status: 'active' },
      }),
      db.okr.aggregate({
        where: { organizationId: orgId, status: 'active' },
        _avg: { progress: true },
      }),
      db.coachingSession.count({
        where: { organizationId: orgId, status: 'scheduled' },
      }),
      db.coachingSession.count({
        where: { organizationId: orgId, status: 'completed' },
      }),
      db.commitment.count({
        where: { organizationId: orgId, status: 'pending' },
      }),
      db.commitment.count({
        where: { organizationId: orgId, status: 'completed' },
      }),
      db.feedback.count({
        where: { organizationId: orgId },
      }),
      db.recognition.count({
        where: { organizationId: orgId },
      }),
    ]);

    const result: KpiResult = {
      activeOkrs,
      averageOkrProgress: Math.round(avgOkrProgress._avg.progress ?? 0),
      scheduledSessions,
      completedSessions,
      pendingCommitments,
      completedCommitments,
      commitmentCompletionRate:
        pendingCommitments + completedCommitments > 0
          ? Math.round(
              (completedCommitments / (pendingCommitments + completedCommitments)) * 100
            )
          : 0,
      totalFeedback,
      totalRecognitions,
    };
    await cacheSet(cacheKey, result, 45);
    return result;
  }),

  // 11.17 — Low progress alerts (OKRs below threshold)
  getLowProgressAlerts: permissionProcedure('performance', 'read')
    .input(
      z.object({
        threshold: z.number().min(0).max(100).default(30),
        period: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Org-rollup alert list across every user's OKRs/commitments — interim
      // org-gate until scope-aware aggregation lands (slice 6).
      requireOrgScope(ctx.access);
      const { threshold, period } = input;

      const lowOkrs = await db.okr.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          status: 'active',
          progress: { lt: threshold },
          ...(period ? { period } : {}),
        },
        orderBy: { progress: 'asc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          team: { select: { id: true, name: true } },
          keyResults: true,
        },
      });

      const overdueCommitments = await db.commitment.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          status: 'pending',
          dueDate: { lt: new Date() },
        },
        orderBy: { dueDate: 'asc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
        take: 50,
      });

      return {
        lowProgressOkrs: lowOkrs,
        overdueCommitments,
        totalAlerts: lowOkrs.length + overdueCommitments.length,
      };
    }),
});
