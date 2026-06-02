import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';

export const deiRouter = router({
  // ── Gender Representation ──────────────────────────────────────────
  // Note: User model does not have gender/ethnicity fields.
  // These endpoints return placeholder data until schema is extended.
  getGenderRepresentation: permissionProcedure('dei', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const total = await db.user.count({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
          ...(input?.businessUnitId ? { businessUnitId: input.businessUnitId } : {}),
        },
      });

      return [{ gender: 'not_tracked', count: total, percentage: 100 }];
    }),

  // ── Pay Equity ─────────────────────────────────────────────────────
  getPayEquity: permissionProcedure('dei', 'read')
    .input(
      z.object({
        groupBy: z.enum(['gender', 'ethnicity', 'age_range']).default('gender'),
        companyId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx }) => {
      const compensations = await db.employeeCompensation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
        },
        select: { currentSalary: true },
      });

      const salaries = compensations.map((c) => Number(c.currentSalary)).filter(Boolean);
      const avg = salaries.length ? salaries.reduce((a, b) => a + b, 0) / salaries.length : 0;
      const sorted = [...salaries].sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

      return {
        groupBy: 'all',
        results: [
          {
            group: 'all',
            count: salaries.length,
            averageSalary: Math.round(avg),
            medianSalary: median,
          },
        ],
      };
    }),

  // ── Age Distribution ───────────────────────────────────────────────
  getAgeDistribution: permissionProcedure('dei', 'read')
    .input(
      z.object({ companyId: z.string().uuid().optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      // User model doesn't have dateOfBirth; return empty distribution
      const total = await db.user.count({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
        },
      });

      return [
        { range: '<25', count: 0, percentage: 0 },
        { range: '25-34', count: 0, percentage: 0 },
        { range: '35-44', count: 0, percentage: 0 },
        { range: '45-54', count: 0, percentage: 0 },
        { range: '55+', count: total, percentage: 100 },
      ];
    }),

  // ── Nationality Diversity ──────────────────────────────────────────
  getNationalityDiversity: permissionProcedure('dei', 'read')
    .input(
      z.object({ companyId: z.string().uuid().optional() }).optional(),
    )
    .query(async ({ ctx }) => {
      // User model doesn't have nationality; return stub
      const total = await db.user.count({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
        },
      });

      return {
        totalNationalities: 0,
        distribution: [{ nationality: 'not_tracked', count: total, percentage: 100 }],
      };
    }),

  // ── Hiring Funnel ──────────────────────────────────────────────────
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

      const candidates = await db.candidate.findMany({
        where,
        select: { id: true },
      });

      return [{ stage: 'all', total: candidates.length, byGender: {} as Record<string, number> }];
    }),

  // ── Promotion Equity ───────────────────────────────────────────────
  getPromotionEquity: permissionProcedure('dei', 'read')
    .input(
      z.object({
        year: z.number().int().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const year = input?.year ?? new Date().getFullYear();

      // No Promotion model exists; count salary adjustments of type 'promotion'
      const startDate = new Date(`${year}-01-01`);
      const endDate = new Date(`${year + 1}-01-01`);

      const promotions = await db.salaryAdjustment.count({
        where: {
          organizationId: ctx.user.organizationId,
          type: 'promotion',
          effectiveDate: { gte: startDate, lt: endDate },
        },
      });

      return { year, totalPromotions: promotions, byGender: {} as Record<string, number> };
    }),

  // ── Leadership Diversity ───────────────────────────────────────────
  getLeadershipDiversity: permissionProcedure('dei', 'read').query(async ({ ctx }) => {
    const leaders = await db.user.count({
      where: {
        organizationId: ctx.user.organizationId,
        isActive: true,
      },
    });

    return { totalLeaders: leaders, byGender: {} as Record<string, number>, byLevel: {} as Record<string, Record<string, number>> };
  }),

  // ── Inclusion Index ────────────────────────────────────────────────
  getInclusionIndex: permissionProcedure('dei', 'read')
    .input(
      z.object({ surveyId: z.string().uuid().optional() }).optional(),
    )
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
        (q: Record<string, unknown>) => q.category === 'inclusion',
      );

      if (!inclusionQuestions.length) return { index: null, totalResponses: survey.responses.length };

      const scores = survey.responses.flatMap((r) =>
        inclusionQuestions
          .map((q: Record<string, unknown>) => Number((r.answers as Record<string, unknown> | null)?.[q.text as string]))
          .filter((n: number) => !isNaN(n)),
      );

      const avg = scores.length ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;

      return {
        index: Math.round(avg * 100) / 100,
        totalResponses: survey.responses.length,
        questionsEvaluated: inclusionQuestions.length,
      };
    }),

  // ── Report (stub) ──────────────────────────────────────────────────
  generateReport: permissionProcedure('dei', 'export')
    .input(
      z.object({
        format: z.enum(['pdf', 'xlsx']).default('pdf'),
        sections: z.array(z.string().max(100)).optional(),
      }),
    )
    .mutation(async () => {
      // TODO: integrate report generation service (e.g., AWS Lambda + Puppeteer)
      return { status: 'pending' as const, message: 'Generacion de reportes no implementada aun' };
    }),

  // ── Dashboard KPIs ─────────────────────────────────────────────────
  getDashboardKpis: permissionProcedure('dei', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const totalUsers = await db.user.count({ where: { organizationId: orgId, isActive: true } });

    return {
      totalEmployees: totalUsers,
      genderParityIndex: 0,
      totalNationalities: 0,
    };
  }),
});
