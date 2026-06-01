import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';

export const performanceDashboardRouter = router({
  // 11.16 — Dashboard KPIs
  getDashboardKpis: permissionProcedure('performance', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

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

    return {
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
