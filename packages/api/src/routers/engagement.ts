import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';

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
        type: z.enum(['pulse', 'enps', 'climate', 'custom']),
        questions: z.array(
          z.object({
            text: z.string().min(1).max(500),
            type: z.enum(['scale', 'text', 'multiple_choice', 'yes_no']),
            options: z.array(z.string().max(200)).optional(),
            required: z.boolean().default(true),
            category: z.string().max(100).optional(),
          }),
        ).min(1),
        targetGroups: z.object({
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
          title: input.title,
          type: input.type,
          questions: input.questions as unknown as Prisma.JsonArray,
          targetGroups: input.targetGroups as unknown as Prisma.JsonObject ?? undefined,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
          endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
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
      const questionSummaries = (survey.questions as Array<Record<string, unknown>>).map((q: Record<string, unknown>) => {
        const answers = survey.responses
          .map((r) => (r.answers as Record<string, unknown> | null)?.[q.text as string])
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
          userId: input.anonymous ? null : ctx.user.id,
          answers: input.answers as unknown as Prisma.JsonObject,
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
      const { period = 'quarter' } = input ?? {};
      const now = new Date();
      const since = new Date(now);

      if (period === 'month') since.setMonth(now.getMonth() - 1);
      else if (period === 'quarter') since.setMonth(now.getMonth() - 3);
      else since.setFullYear(now.getFullYear() - 1);

      const responses = await db.surveyResponse.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          survey: { type: 'enps' },
          submittedAt: { gte: since },
        },
      });

      const scores = responses
        .map((r) => {
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
      if (!survey) return { surveyId: null as string | null, title: '', data: [] as { category: string; score: number }[] };

      const categories = [...new Set((survey.questions as Array<Record<string, unknown>>).map((q: Record<string, unknown>) => q.category as string).filter(Boolean))];

      const data = categories.map((cat: string) => {
        const catQuestions = (survey.questions as Array<Record<string, unknown>>).filter((q: Record<string, unknown>) => q.category === cat);
        const scores = survey.responses.flatMap((r) =>
          catQuestions
            .map((q: Record<string, unknown>) => Number((r.answers as Record<string, unknown> | null)?.[q.text as string]))
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
              user: {
                select: { companyId: true, businessUnitId: true },
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
            ? (r.user as Record<string, unknown> | null)?.companyId as string | undefined
            : (r.user as Record<string, unknown> | null)?.businessUnitId as string | undefined;
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
    .query(async ({ ctx }) => {
      // No EngagementAlert model; use the Alert model from monitoring
      const alerts = await db.alert.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          module: 'engagement',
          status: 'active',
        },
        orderBy: { createdAt: 'desc' },
      });

      return alerts;
    }),

  listActionPlans: permissionProcedure('engagement', 'read')
    .input(
      z.object({
        status: z.enum(['open', 'in_progress', 'completed', 'pending']).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      return db.actionPlan.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input?.status ? { status: input.status } : {}),
        },
        include: {
          responsible: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }),

  createActionPlan: permissionProcedure('engagement', 'create')
    .input(
      z.object({
        title: z.string().min(1).max(200),
        responsibleId: z.string().uuid(),
        area: z.string().max(200).optional(),
        notes: z.string().max(2000).optional(),
        dueDate: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return db.actionPlan.create({
        data: {
          title: input.title,
          responsibleId: input.responsibleId,
          area: input.area,
          notes: input.notes,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
          organizationId: ctx.user.organizationId,
          status: 'pending',
        },
      });
    }),

  updateActionPlan: permissionProcedure('engagement', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        notes: z.string().max(2000).optional(),
        status: z.enum(['pending', 'in_progress', 'completed']).optional(),
        responsibleId: z.string().uuid().optional(),
        dueDate: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, dueDate, ...data } = input;
      return db.actionPlan.update({
        where: { id, organizationId: ctx.user.organizationId },
        data: {
          ...data,
          ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        },
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
      // User model doesn't have rotation risk fields; return empty
      const total = await db.user.count({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
          ...(input?.businessUnitId ? { businessUnitId: input.businessUnitId } : {}),
        },
      });

      return {
        summary: { high: 0, medium: 0, low: 0, total },
        topRisk: [] as Array<Record<string, unknown>>,
      };
    }),

  // ── Dashboard KPIs ─────────────────────────────────────────────────
  getDashboardKpis: permissionProcedure('engagement', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const [activeSurveys, totalResponses, actionPlansOpen] = await Promise.all([
      db.survey.count({ where: { organizationId: orgId, status: 'active' } }),
      db.surveyResponse.count({ where: { organizationId: orgId } }),
      db.actionPlan.count({ where: { organizationId: orgId, status: { in: ['pending', 'in_progress'] } } }),
    ]);

    return {
      activeSurveys,
      totalResponses,
      actionPlansOpen,
      highRiskCount: 0,
    };
  }),
});
