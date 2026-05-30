import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';

export const engagementRouter = router({
  // ── Surveys ────────────────────────────────────────────────────────
  listSurveys: permissionProcedure('engagement', 'read')
    .input(
      z.object({
        status: z.enum(['draft', 'active', 'closed']).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const { status, page = 1, limit = 20 } = input ?? {};
      const where = {
        organizationId: ctx.user.organizationId,
        ...(status ? { status } : {}),
      };

      const [items, total] = await Promise.all([
        db.survey.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.survey.count({ where }),
      ]);

      return { items, total, page, limit };
    }),

  createSurvey: permissionProcedure('engagement', 'create')
    .input(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        type: z.enum(['pulse', 'enps', 'climate', 'custom']),
        questions: z.array(
          z.object({
            text: z.string().min(1),
            type: z.enum(['scale', 'text', 'multiple_choice', 'yes_no']),
            options: z.array(z.string()).optional(),
            required: z.boolean().default(true),
            category: z.string().optional(),
          }),
        ).min(1),
        targetAudience: z.object({
          companyIds: z.array(z.string().uuid()).optional(),
          businessUnitIds: z.array(z.string().uuid()).optional(),
          teamIds: z.array(z.string().uuid()).optional(),
        }).optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return db.survey.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          status: 'draft',
        },
      });
    }),

  getSurveyResults: permissionProcedure('engagement', 'read')
    .input(z.object({ surveyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const survey = await db.survey.findFirst({
        where: {
          id: input.surveyId,
          organizationId: ctx.user.organizationId,
        },
        include: {
          responses: true,
        },
      });

      if (!survey) {
        throw new Error('Encuesta no encontrada');
      }

      const totalResponses = survey.responses.length;
      const questionSummaries = (survey.questions as any[]).map((q: any) => {
        const answers = survey.responses
          .map((r: any) => (r.answers as any)?.[q.text])
          .filter(Boolean);

        if (q.type === 'scale') {
          const nums = answers.map(Number).filter((n: number) => !isNaN(n));
          const avg = nums.length ? nums.reduce((a: number, b: number) => a + b, 0) / nums.length : 0;
          return { question: q.text, type: q.type, average: Math.round(avg * 100) / 100, count: nums.length };
        }

        return { question: q.text, type: q.type, count: answers.length };
      });

      return { surveyId: survey.id, title: survey.title, totalResponses, questionSummaries };
    }),

  submitSurveyResponse: protectedProcedure
    .input(
      z.object({
        surveyId: z.string().uuid(),
        answers: z.record(z.string(), z.union([z.string(), z.number()])),
        anonymous: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const survey = await db.survey.findFirst({
        where: {
          id: input.surveyId,
          organizationId: ctx.user.organizationId,
          status: 'active',
        },
      });

      if (!survey) {
        throw new Error('Encuesta no encontrada o no activa');
      }

      return db.surveyResponse.create({
        data: {
          surveyId: input.surveyId,
          respondentId: input.anonymous ? null : ctx.user.id,
          answers: input.answers,
          organizationId: ctx.user.organizationId,
        },
      });
    }),

  // ── eNPS ───────────────────────────────────────────────────────────
  getEnps: permissionProcedure('engagement', 'read')
    .input(
      z.object({
        period: z.enum(['month', 'quarter', 'year']).default('quarter'),
        companyId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const { period = 'quarter', companyId } = input ?? {};
      const now = new Date();
      const since = new Date(now);

      if (period === 'month') since.setMonth(now.getMonth() - 1);
      else if (period === 'quarter') since.setMonth(now.getMonth() - 3);
      else since.setFullYear(now.getFullYear() - 1);

      const responses = await db.surveyResponse.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          survey: { type: 'enps' },
          createdAt: { gte: since },
          ...(companyId ? { survey: { type: 'enps', targetAudience: { path: ['companyIds'], array_contains: companyId } } } : {}),
        },
      });

      const scores = responses
        .map((r: any) => {
          const vals = Object.values(r.answers as Record<string, unknown>);
          return typeof vals[0] === 'number' ? (vals[0] as number) : parseInt(vals[0] as string, 10);
        })
        .filter((n: number) => !isNaN(n));

      const total = scores.length || 1;
      const promoters = scores.filter((s: number) => s >= 9).length;
      const detractors = scores.filter((s: number) => s <= 6).length;
      const enps = Math.round(((promoters - detractors) / total) * 100);

      return {
        enps,
        promoters,
        passives: total - promoters - detractors,
        detractors,
        totalResponses: scores.length,
        period,
      };
    }),

  // ── Climate ────────────────────────────────────────────────────────
  getClimateHeatmap: permissionProcedure('engagement', 'read')
    .input(
      z.object({
        surveyId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const surveys = await db.survey.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          type: 'climate',
          ...(input?.surveyId ? { id: input.surveyId } : {}),
        },
        include: { responses: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      const survey = surveys[0];
      if (!survey) return { categories: [], teams: [], data: [] };

      const categories = [...new Set((survey.questions as any[]).map((q: any) => q.category).filter(Boolean))];

      const data = categories.map((cat: string) => {
        const catQuestions = (survey.questions as any[]).filter((q: any) => q.category === cat);
        const scores = survey.responses.flatMap((r: any) =>
          catQuestions
            .map((q: any) => Number((r.answers as any)?.[q.text]))
            .filter((n: number) => !isNaN(n)),
        );
        const avg = scores.length ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;
        return { category: cat, score: Math.round(avg * 100) / 100 };
      });

      return { surveyId: survey.id, title: survey.title, data };
    }),

  getResultsByArea: permissionProcedure('engagement', 'read')
    .input(
      z.object({
        surveyId: z.string().uuid(),
        groupBy: z.enum(['company', 'businessUnit', 'team']).default('company'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const survey = await db.survey.findFirst({
        where: { id: input.surveyId, organizationId: ctx.user.organizationId },
        include: {
          responses: {
            include: {
              respondent: {
                select: { companyId: true, businessUnitId: true, teamId: true },
              },
            },
          },
        },
      });

      if (!survey) throw new Error('Encuesta no encontrada');

      const groups: Record<string, number[]> = {};
      for (const r of survey.responses) {
        const key =
          input.groupBy === 'company'
            ? (r.respondent as any)?.companyId
            : input.groupBy === 'businessUnit'
              ? (r.respondent as any)?.businessUnitId
              : (r.respondent as any)?.teamId;
        if (!key) continue;
        if (!groups[key]) groups[key] = [];
        const vals = Object.values(r.answers as Record<string, unknown>)
          .map(Number)
          .filter((n: number) => !isNaN(n));
        groups[key].push(...vals);
      }

      const results = Object.entries(groups).map(([id, scores]) => ({
        groupId: id,
        average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100,
        responses: scores.length,
      }));

      return { surveyId: survey.id, groupBy: input.groupBy, results };
    }),

  // ── Stubs ──────────────────────────────────────────────────────────
  getWordCloud: permissionProcedure('engagement', 'read')
    .input(z.object({ surveyId: z.string().uuid() }))
    .query(async () => {
      // TODO: integrate NLP service for word frequency extraction
      return { words: [] as { text: string; weight: number }[] };
    }),

  getSentiment: permissionProcedure('engagement', 'read')
    .input(z.object({ surveyId: z.string().uuid() }))
    .query(async () => {
      // TODO: integrate NLP/AI service for sentiment analysis
      return { positive: 0, neutral: 0, negative: 0, highlights: [] as string[] };
    }),

  // ── Alerts & Action Plans ──────────────────────────────────────────
  getLowClimateAlerts: permissionProcedure('engagement', 'read')
    .input(
      z.object({ threshold: z.number().min(0).max(10).default(3) }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const threshold = input?.threshold ?? 3;

      const alerts = await db.engagementAlert.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          type: 'low_climate',
          score: { lte: threshold },
          resolvedAt: null,
        },
        orderBy: { score: 'asc' },
      });

      return alerts;
    }),

  listActionPlans: permissionProcedure('engagement', 'read')
    .input(
      z.object({
        status: z.enum(['open', 'in_progress', 'completed']).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      return db.actionPlan.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input?.status ? { status: input.status } : {}),
        },
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }),

  createActionPlan: permissionProcedure('engagement', 'create')
    .input(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        ownerId: z.string().uuid(),
        category: z.string().optional(),
        dueDate: z.string().datetime().optional(),
        linkedSurveyId: z.string().uuid().optional(),
        linkedAlertId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return db.actionPlan.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          status: 'open',
        },
      });
    }),

  updateActionPlan: permissionProcedure('engagement', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        status: z.enum(['open', 'in_progress', 'completed']).optional(),
        ownerId: z.string().uuid().optional(),
        dueDate: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return db.actionPlan.update({
        where: { id, organizationId: ctx.user.organizationId },
        data,
      });
    }),

  // ── Leader Commitments ─────────────────────────────────────────────
  listLeaderCommitments: permissionProcedure('engagement', 'read')
    .input(
      z.object({
        leaderId: z.string().uuid().optional(),
        status: z.enum(['pending', 'fulfilled', 'overdue']).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      return db.leaderCommitment.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input?.leaderId ? { leaderId: input.leaderId } : {}),
          ...(input?.status ? { status: input.status } : {}),
        },
        include: {
          leader: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
        orderBy: { dueDate: 'asc' },
      });
    }),

  // ── Rotation Risk ──────────────────────────────────────────────────
  getRotationRisk: permissionProcedure('engagement', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const employees = await db.employee.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
          ...(input?.businessUnitId ? { businessUnitId: input.businessUnitId } : {}),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          rotationRiskScore: true,
          rotationRiskLevel: true,
          lastSurveyScore: true,
          tenure: true,
        },
        orderBy: { rotationRiskScore: 'desc' },
      });

      const high = employees.filter((e: any) => e.rotationRiskLevel === 'high').length;
      const medium = employees.filter((e: any) => e.rotationRiskLevel === 'medium').length;
      const low = employees.filter((e: any) => e.rotationRiskLevel === 'low').length;

      return {
        summary: { high, medium, low, total: employees.length },
        topRisk: employees.slice(0, 10),
      };
    }),

  // ── Dashboard KPIs ─────────────────────────────────────────────────
  getDashboardKpis: permissionProcedure('engagement', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const [activeSurveys, totalResponses, actionPlansOpen, highRiskCount] = await Promise.all([
      db.survey.count({ where: { organizationId: orgId, status: 'active' } }),
      db.surveyResponse.count({ where: { organizationId: orgId } }),
      db.actionPlan.count({ where: { organizationId: orgId, status: { in: ['open', 'in_progress'] } } }),
      db.employee.count({ where: { organizationId: orgId, rotationRiskLevel: 'high', isActive: true } }),
    ]);

    return {
      activeSurveys,
      totalResponses,
      actionPlansOpen,
      highRiskCount,
    };
  }),
});
