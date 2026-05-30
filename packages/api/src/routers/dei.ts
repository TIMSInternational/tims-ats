import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { db } from '@tims/db';

export const deiRouter = router({
  // ── Gender Representation ──────────────────────────────────────────
  getGenderRepresentation: permissionProcedure('dei', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        organizationId: ctx.user.organizationId,
        isActive: true,
        ...(input?.companyId ? { companyId: input.companyId } : {}),
        ...(input?.businessUnitId ? { businessUnitId: input.businessUnitId } : {}),
      };

      const employees = await db.employee.groupBy({
        by: ['gender'],
        where,
        _count: { id: true },
      });

      const total = employees.reduce((sum: number, g: any) => sum + g._count.id, 0);

      return employees.map((g: any) => ({
        gender: g.gender,
        count: g._count.id,
        percentage: total ? Math.round((g._count.id / total) * 10000) / 100 : 0,
      }));
    }),

  // ── Pay Equity ─────────────────────────────────────────────────────
  getPayEquity: permissionProcedure('dei', 'read')
    .input(
      z.object({
        groupBy: z.enum(['gender', 'ethnicity', 'age_range']).default('gender'),
        companyId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const { groupBy = 'gender', companyId } = input ?? {};

      const employees = await db.employee.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(companyId ? { companyId } : {}),
        },
        select: {
          id: true,
          gender: true,
          ethnicity: true,
          dateOfBirth: true,
          baseSalary: true,
          jobLevel: true,
        },
      });

      const groups: Record<string, { salaries: number[]; count: number }> = {};

      for (const emp of employees) {
        let key: string;
        if (groupBy === 'gender') key = emp.gender ?? 'unknown';
        else if (groupBy === 'ethnicity') key = (emp as any).ethnicity ?? 'unknown';
        else {
          const age = emp.dateOfBirth
            ? Math.floor((Date.now() - new Date(emp.dateOfBirth).getTime()) / 31557600000)
            : 0;
          key = age < 30 ? '<30' : age < 40 ? '30-39' : age < 50 ? '40-49' : '50+';
        }

        if (!groups[key]) groups[key] = { salaries: [], count: 0 };
        if (emp.baseSalary) {
          groups[key].salaries.push(Number(emp.baseSalary));
          groups[key].count++;
        }
      }

      const results = Object.entries(groups).map(([group, data]) => {
        const avg = data.salaries.length
          ? data.salaries.reduce((a, b) => a + b, 0) / data.salaries.length
          : 0;
        const median = data.salaries.length
          ? data.salaries.sort((a, b) => a - b)[Math.floor(data.salaries.length / 2)]
          : 0;
        return {
          group,
          count: data.count,
          averageSalary: Math.round(avg),
          medianSalary: median,
        };
      });

      return { groupBy, results };
    }),

  // ── Age Distribution ───────────────────────────────────────────────
  getAgeDistribution: permissionProcedure('dei', 'read')
    .input(
      z.object({ companyId: z.string().uuid().optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const employees = await db.employee.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
        },
        select: { dateOfBirth: true },
      });

      const buckets: Record<string, number> = { '<25': 0, '25-34': 0, '35-44': 0, '45-54': 0, '55+': 0 };

      for (const emp of employees) {
        if (!emp.dateOfBirth) continue;
        const age = Math.floor((Date.now() - new Date(emp.dateOfBirth).getTime()) / 31557600000);
        if (age < 25) buckets['<25']++;
        else if (age < 35) buckets['25-34']++;
        else if (age < 45) buckets['35-44']++;
        else if (age < 55) buckets['45-54']++;
        else buckets['55+']++;
      }

      const total = employees.length || 1;
      return Object.entries(buckets).map(([range, count]) => ({
        range,
        count,
        percentage: Math.round((count / total) * 10000) / 100,
      }));
    }),

  // ── Nationality Diversity ──────────────────────────────────────────
  getNationalityDiversity: permissionProcedure('dei', 'read')
    .input(
      z.object({ companyId: z.string().uuid().optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const employees = await db.employee.groupBy({
        by: ['nationality'],
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      });

      const total = employees.reduce((sum: number, g: any) => sum + g._count.id, 0);

      return {
        totalNationalities: employees.length,
        distribution: employees.map((g: any) => ({
          nationality: g.nationality ?? 'unknown',
          count: g._count.id,
          percentage: total ? Math.round((g._count.id / total) * 10000) / 100 : 0,
        })),
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
      const where: any = {
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
        select: { id: true, gender: true, stage: true },
      });

      const stages = ['applied', 'screened', 'interviewed', 'offered', 'hired'];
      const funnel = stages.map((stage) => {
        const stageGroup = candidates.filter((c: any) => c.stage === stage);
        const byGender: Record<string, number> = {};
        for (const c of stageGroup) {
          const g = (c as any).gender ?? 'unknown';
          byGender[g] = (byGender[g] || 0) + 1;
        }
        return { stage, total: stageGroup.length, byGender };
      });

      return funnel;
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
      const startDate = new Date(`${year}-01-01`);
      const endDate = new Date(`${year + 1}-01-01`);

      const promotions = await db.promotion.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          effectiveDate: { gte: startDate, lt: endDate },
        },
        include: {
          employee: { select: { gender: true, ethnicity: true } },
        },
      });

      const byGender: Record<string, number> = {};
      for (const p of promotions) {
        const g = (p.employee as any)?.gender ?? 'unknown';
        byGender[g] = (byGender[g] || 0) + 1;
      }

      return { year, totalPromotions: promotions.length, byGender };
    }),

  // ── Leadership Diversity ───────────────────────────────────────────
  getLeadershipDiversity: permissionProcedure('dei', 'read').query(async ({ ctx }) => {
    const leaders = await db.employee.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        isActive: true,
        jobLevel: { in: ['director', 'vp', 'c_level', 'manager'] },
      },
      select: { gender: true, ethnicity: true, nationality: true, jobLevel: true },
    });

    const byGender: Record<string, number> = {};
    const byLevel: Record<string, Record<string, number>> = {};

    for (const l of leaders) {
      const g = (l as any).gender ?? 'unknown';
      byGender[g] = (byGender[g] || 0) + 1;

      const level = (l as any).jobLevel ?? 'unknown';
      if (!byLevel[level]) byLevel[level] = {};
      byLevel[level][g] = (byLevel[level][g] || 0) + 1;
    }

    return { totalLeaders: leaders.length, byGender, byLevel };
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

      const inclusionQuestions = (survey.questions as any[]).filter(
        (q: any) => q.category === 'inclusion',
      );

      if (!inclusionQuestions.length) return { index: null, totalResponses: survey.responses.length };

      const scores = survey.responses.flatMap((r: any) =>
        inclusionQuestions
          .map((q: any) => Number((r.answers as any)?.[q.text]))
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
        sections: z.array(z.string()).optional(),
      }),
    )
    .mutation(async () => {
      // TODO: integrate report generation service (e.g., AWS Lambda + Puppeteer)
      return { status: 'pending' as const, message: 'Generacion de reportes no implementada aun' };
    }),

  // ── Dashboard KPIs ─────────────────────────────────────────────────
  getDashboardKpis: permissionProcedure('dei', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const [totalEmployees, genderGroups, nationalityCount] = await Promise.all([
      db.employee.count({ where: { organizationId: orgId, isActive: true } }),
      db.employee.groupBy({
        by: ['gender'],
        where: { organizationId: orgId, isActive: true },
        _count: { id: true },
      }),
      db.employee.groupBy({
        by: ['nationality'],
        where: { organizationId: orgId, isActive: true },
      }),
    ]);

    const femaleCount = genderGroups.find((g: any) => g.gender === 'female')?._count?.id ?? 0;
    const genderParityIndex = totalEmployees
      ? Math.round((femaleCount / totalEmployees) * 10000) / 100
      : 0;

    return {
      totalEmployees,
      genderParityIndex,
      totalNationalities: nationalityCount.length,
    };
  }),
});
