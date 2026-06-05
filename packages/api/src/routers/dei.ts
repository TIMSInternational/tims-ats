import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { deiService } from '../services/dei.service';

// ---------------------------------------------------------------------------
// DEI router — thin controller. Demographic metrics are backed by the
// EmployeeDemographics table via deiService (aggregates only, never individual
// self-ID rows — CLAUDE.md §7). Survey-/comp-derived endpoints (inclusion,
// hiring funnel, promotions) stay here as they read non-demographic data.
// ---------------------------------------------------------------------------

export const deiRouter = router({
  // ── Demographic distributions (real, demographics-backed) ──────────
  getDashboardKpis: permissionProcedure('dei', 'read').query(({ ctx }) =>
    deiService.getDashboardKpis(ctx.user.organizationId),
  ),

  getGenderRepresentation: permissionProcedure('dei', 'read').query(({ ctx }) =>
    deiService.getGenderRepresentation(ctx.user.organizationId),
  ),

  getAgeDistribution: permissionProcedure('dei', 'read').query(({ ctx }) =>
    deiService.getAgeDistribution(ctx.user.organizationId),
  ),

  getNationalityDiversity: permissionProcedure('dei', 'read').query(({ ctx }) =>
    deiService.getNationalityDiversity(ctx.user.organizationId),
  ),

  getEthnicityDistribution: permissionProcedure('dei', 'read').query(({ ctx }) =>
    deiService.getEthnicityDistribution(ctx.user.organizationId),
  ),

  getDisabilityDistribution: permissionProcedure('dei', 'read').query(({ ctx }) =>
    deiService.getDisabilityDistribution(ctx.user.organizationId),
  ),

  getPayEquity: permissionProcedure('dei', 'read').query(({ ctx }) =>
    deiService.getPayEquity(ctx.user.organizationId),
  ),

  getLeadershipDiversity: permissionProcedure('dei', 'read').query(({ ctx }) =>
    deiService.getLeadershipDiversity(ctx.user.organizationId),
  ),

  // ── Hiring funnel (candidates have no demographics — overall counts) ─
  getHiringFunnel: permissionProcedure('dei', 'read')
    .input(
      z.object({
        dateFrom: z.string().datetime().optional(),
        dateTo: z.string().datetime().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.CandidateWhereInput = {
        organizationId: ctx.user.organizationId,
        ...(input?.dateFrom || input?.dateTo
          ? {
              createdAt: {
                ...(input?.dateFrom ? { gte: new Date(input.dateFrom) } : {}),
                ...(input?.dateTo ? { lte: new Date(input.dateTo) } : {}),
              },
            }
          : {}),
      };
      const total = await db.candidate.count({ where });
      return { total };
    }),

  // ── Promotion equity (salary adjustments of type 'promotion') ──────
  getPromotionEquity: permissionProcedure('dei', 'read')
    .input(z.object({ year: z.number().int().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const year = input?.year ?? new Date().getFullYear();
      const startDate = new Date(`${year}-01-01`);
      const endDate = new Date(`${year + 1}-01-01`);
      const totalPromotions = await db.salaryAdjustment.count({
        where: {
          organizationId: ctx.user.organizationId,
          type: 'promotion',
          effectiveDate: { gte: startDate, lt: endDate },
        },
      });
      return { year, totalPromotions };
    }),

  // ── Inclusion index (climate survey, real) ─────────────────────────
  getInclusionIndex: permissionProcedure('dei', 'read')
    .input(z.object({ surveyId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const survey = await db.survey.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          type: 'climate',
          ...(input?.surveyId ? { id: input.surveyId } : {}),
        },
        include: { responses: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!survey) return { index: null, totalResponses: 0 };

      const inclusionQuestions = (survey.questions as Array<Record<string, unknown>>).filter(
        (q) => q.category === 'inclusion',
      );
      if (!inclusionQuestions.length) return { index: null, totalResponses: survey.responses.length };

      const scores = survey.responses.flatMap((r) =>
        inclusionQuestions
          .map((q) => Number((r.answers as Record<string, unknown> | null)?.[q.text as string]))
          .filter((n) => !isNaN(n)),
      );
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

      return {
        index: Math.round(avg * 100) / 100,
        totalResponses: survey.responses.length,
        questionsEvaluated: inclusionQuestions.length,
      };
    }),

  // ── Report (stub) ──────────────────────────────────────────────────
  generateReport: permissionProcedure('dei', 'export')
    .input(z.object({ format: z.enum(['pdf', 'xlsx']).default('pdf'), sections: z.array(z.string().max(100)).optional() }))
    .mutation(async () => {
      return { status: 'pending' as const, message: 'Generacion de reportes no implementada aun' };
    }),
});
