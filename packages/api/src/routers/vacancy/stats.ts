import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const vacancyStatsRouter = router({
  // 4.18 — Get vacancy stats (application counts by stage)
  getStats: permissionProcedure('vacancy', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      const [totalApplications, activeApplications, rejectedApplications, stageBreakdown] =
        await Promise.all([
          db.application.count({ where: { vacancyId: input.id } }),
          db.application.count({ where: { vacancyId: input.id, status: 'active' } }),
          db.application.count({ where: { vacancyId: input.id, status: 'rejected' } }),
          db.pipelineStage.findMany({
            where: { vacancyId: input.id },
            orderBy: { order: 'asc' },
            select: {
              id: true,
              name: true,
              order: true,
              _count: { select: { applications: true } },
            },
          }),
        ]);

      return {
        vacancyId: input.id,
        totalApplications,
        activeApplications,
        rejectedApplications,
        stageBreakdown: stageBreakdown.map((s) => ({
          stageId: s.id,
          stageName: s.name,
          order: s.order,
          count: s._count.applications,
        })),
      };
    }),

  // 4.20 — Get dashboard KPIs across all vacancies
  getDashboardKpis: permissionProcedure('vacancy', 'read')
    .query(async ({ ctx }) => {
      const orgId = ctx.user.organizationId;

      const [
        totalOpen,
        totalDraft,
        totalPendingApproval,
        totalPublished,
        totalClosed,
        totalApplications,
        recentVacancies,
      ] = await Promise.all([
        db.vacancy.count({ where: { organizationId: orgId, status: { in: ['approved', 'published'] }, deletedAt: null } }),
        db.vacancy.count({ where: { organizationId: orgId, status: 'draft', deletedAt: null } }),
        db.vacancy.count({ where: { organizationId: orgId, status: 'pending_approval', deletedAt: null } }),
        db.vacancy.count({ where: { organizationId: orgId, status: 'published', deletedAt: null } }),
        db.vacancy.count({ where: { organizationId: orgId, status: 'closed', deletedAt: null } }),
        db.application.count({ where: { organizationId: orgId } }),
        db.vacancy.findMany({
          where: { organizationId: orgId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
            _count: { select: { applications: true } },
          },
        }),
      ]);

      return {
        totalOpen,
        totalDraft,
        totalPendingApproval,
        totalPublished,
        totalClosed,
        totalApplications,
        recentVacancies,
      };
    }),
});
