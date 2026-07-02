import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { deiService } from '../services/dei.service';
import { suppressBelowMin5 } from '../access';

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
      // min-5 floor (round 6 sweep): totalPromotions is a COUNT over salaryAdjustment
      // (a §21-restricted sensitive population). A 1..4 count is a sub-floor disclosure
      // over that population — suppressBelowMin5 it. 0 passes through (reveals no one).
      const floored = suppressBelowMin5(totalPromotions);
      return { year, totalPromotions: floored.count, suppressed: floored.suppressed };
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

      if (!survey) return { index: null, totalResponses: null as number | null, suppressed: false };

      // Survey-level min-5 floor (slice 6 round 5): mirror getClimateHeatmap /
      // getSurveyResults. A climate survey with 1..4 respondents derives every
      // inclusion average from <5 people and leaks the raw respondent count — suppress
      // the whole result (index + totalResponses null, suppressed: true). 0 respondents
      // passes through unsuppressed (it reveals no individual). This guard fires BEFORE
      // the no-inclusion-question branch so a small survey is masked regardless of which
      // questions exist.
      const surveyLevel = suppressBelowMin5(survey.responses.length);
      if (surveyLevel.suppressed) {
        return { index: null as number | null, totalResponses: null as number | null, suppressed: true };
      }

      const inclusionQuestions = (survey.questions as Array<Record<string, unknown>>).filter(
        (q) => q.category === 'inclusion',
      );
      if (!inclusionQuestions.length) {
        // No inclusion question: there is no index, only the (>=5) respondent count.
        return { index: null as number | null, totalResponses: survey.responses.length as number | null, suppressed: false };
      }

      // Distinct-respondent floor (slice 6 round 5): even with >=5 respondents to the
      // survey, the inclusion average may be computed over a SUB-FLOOR set of people who
      // actually answered an inclusion question — that average IS individual-level data.
      // Count distinct contributing respondents and suppress the index if 1..4.
      let contributingRespondents = 0;
      const scores = survey.responses.flatMap((r) => {
        const rowScores = inclusionQuestions
          .map((q) => Number((r.answers as Record<string, unknown> | null)?.[q.text as string]))
          .filter((n) => !isNaN(n));
        if (rowScores.length) contributingRespondents += 1;
        return rowScores;
      });

      // Contributor + skip floor (round 9): the index average is over the CONTRIBUTOR set,
      // and the complementary SKIP bucket (survey respondents − inclusion contributors) is
      // its own small group. Suppress when EITHER is 1..4 — consistent with the all-or-
      // nothing contributor/skip policy applied to getSurveyResults / getResultsByArea.
      const inclusionSkipped = survey.responses.length - contributingRespondents;
      if (
        suppressBelowMin5(contributingRespondents).suppressed ||
        suppressBelowMin5(inclusionSkipped).suppressed
      ) {
        return { index: null as number | null, totalResponses: survey.responses.length as number | null, suppressed: true };
      }

      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

      return {
        index: (Math.round(avg * 100) / 100) as number | null,
        totalResponses: survey.responses.length as number | null,
        suppressed: false,
        questionsEvaluated: inclusionQuestions.length,
      };
    }),

  // ── Report (stub) ──────────────────────────────────────────────────
  generateReport: permissionProcedure('dei', 'export')
    .input(z.object({ format: z.enum(['pdf', 'xlsx']).default('pdf'), sections: z.array(z.string().max(100)).max(100).optional() }))
    .mutation(async () => {
      return { status: 'pending' as const, message: 'Generacion de reportes no implementada aun' };
    }),
});
