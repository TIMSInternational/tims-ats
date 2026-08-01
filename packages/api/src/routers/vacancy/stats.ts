import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { scopeWhereFor } from '../../access';
import { cacheGet, cacheSet } from '../../lib/cache';
import { pipelineAnalyticsService } from '../../services/pipeline-analytics.service';

export const vacancyStatsRouter = router({
  // 4.18 — Get vacancy stats (application counts by stage)
  getStats: permissionProcedure('vacancy', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('vacancy', ctx.access, ctx.user.id);
      const vacancy = await db.vacancy.findFirst({
        where: {
          AND: [
            { id: input.id, organizationId: ctx.user.organizationId, deletedAt: null },
            scopeWhere as Prisma.VacancyWhereInput,
          ],
        },
        select: { id: true },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      // The counts below are keyed to this single scope-gated vacancyId, so they
      // need no per-count scope fragment. Do NOT copy this shape for any
      // multi-vacancy aggregate — those must compose scopeWhereFor per query
      // (see getDashboardKpis).
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

      // Scope-dependent: team/unit/own users see different vacancy/application counts.
      // Sub-org scopes (team/unit/own) are anchored per user (scopeWhereFor resolves
      // ledTeamIds/unitIds/assignedTo from ctx.user.id). Two different team leaders
      // share the same scope LEVEL but NOT the same data — so we must key on userId,
      // not just scope. Org/company callers produce identical org-rollup data and
      // may safely share one entry.
      const isSubOrgScope = ctx.access.scope !== 'organization' && ctx.access.scope !== 'company';
      const scopeDiscriminator = isSubOrgScope
        ? `${ctx.access.scope}:${ctx.user.id}`   // sub-org scopes are user-anchored → key per user
        : ctx.access.scope;                        // org/company callers share the identical org rollup
      const cacheKey = `tims:kpis:vacancy:${orgId}:${scopeDiscriminator}`;

      type RecentVacancy = {
        id: string;
        title: string;
        status: string;
        createdAt: Date;
        _count: { applications: number };
      };

      type KpiResult = {
        totalOpen: number;
        totalDraft: number;
        totalPendingApproval: number;
        totalPublished: number;
        totalClosed: number;
        totalApplications: number;
        totalSlaOverdue: number;
        recentVacancies: RecentVacancy[];
      };

      const cached = await cacheGet<KpiResult>(cacheKey);
      if (cached) {
        return {
          ...cached,
          recentVacancies: cached.recentVacancies.map((v) => ({
            ...v,
            createdAt: new Date(v.createdAt),
          })),
        };
      }

      const scopeWhere = (await scopeWhereFor('vacancy', ctx.access, ctx.user.id)) as Prisma.VacancyWhereInput;
      const appScopeWhere = (await scopeWhereFor('application', ctx.access, ctx.user.id)) as Prisma.ApplicationWhereInput;

      const [
        totalOpen,
        totalDraft,
        totalPendingApproval,
        totalPublished,
        totalClosed,
        totalApplications,
        totalSlaOverdue,
        recentVacancies,
      ] = await Promise.all([
        db.vacancy.count({ where: { AND: [{ organizationId: orgId, status: { in: ['approved', 'published'] }, deletedAt: null }, scopeWhere] } }),
        db.vacancy.count({ where: { AND: [{ organizationId: orgId, status: 'draft', deletedAt: null }, scopeWhere] } }),
        db.vacancy.count({ where: { AND: [{ organizationId: orgId, status: 'pending_approval', deletedAt: null }, scopeWhere] } }),
        db.vacancy.count({ where: { AND: [{ organizationId: orgId, status: 'published', deletedAt: null }, scopeWhere] } }),
        db.vacancy.count({ where: { AND: [{ organizationId: orgId, status: 'closed', deletedAt: null }, scopeWhere] } }),
        db.application.count({ where: { AND: [{ organizationId: orgId }, appScopeWhere] } }),
        pipelineAnalyticsService.getOrgSlaOverdueCount(orgId, appScopeWhere),
        db.vacancy.findMany({
          where: { AND: [{ organizationId: orgId, deletedAt: null }, scopeWhere] },
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

      const result: KpiResult = {
        totalOpen,
        totalDraft,
        totalPendingApproval,
        totalPublished,
        totalClosed,
        totalApplications,
        totalSlaOverdue,
        recentVacancies,
      };
      await cacheSet(cacheKey, result, 45);
      return result;
    }),
});
