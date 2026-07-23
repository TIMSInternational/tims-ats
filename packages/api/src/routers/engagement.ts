import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertScoped, assertSubjectInScope, requireOrgScope, suppressBelowMin5 } from '../access';
import {
  computeEnps,
  summarizeSurveyResults,
  buildClimateHeatmap,
  buildResultsByArea,
  buildEngagementKpis,
} from '@tims/shared';

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

      // Raw-scalar floor (round 7, finding 6): Survey carries a `responseCount` scalar.
      // A bare findMany (no explicit select) returns every Survey field including
      // responseCount, so a 3-response survey exposes responseCount:3 directly — a
      // sub-floor head-count over the survey-respondent population. Use an EXPLICIT
      // select of the fields a list UI needs (omitting the raw responseCount) and emit
      // a min-5-FLOORED responseCount + suppression flag instead (null/suppressed for
      // 1..4; 0 and >=5 pass through). This also satisfies the no-unselected-findMany rule.
      const [rows, total] = await Promise.all([
        db.survey.findMany({
          where,
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            startsAt: true,
            endsAt: true,
            createdAt: true,
            updatedAt: true,
            responseCount: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.survey.count({ where }),
      ]);

      const items = rows.map(({ responseCount, ...rest }) => {
        const floor = suppressBelowMin5(responseCount);
        return { ...rest, responseCount: floor.count, responseCountSuppressed: floor.suppressed };
      });

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
            options: z.array(z.string().max(200)).max(100).optional(),
            required: z.boolean().default(true),
            category: z.string().max(100).optional(),
          }),
        ).min(1),
        targetGroups: z.object({
          companyIds: z.array(z.string().uuid()).max(1000).optional(),
          businessUnitIds: z.array(z.string().uuid()).max(1000).optional(),
          teamIds: z.array(z.string().uuid()).max(1000).optional(),
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

  activateSurvey: permissionProcedure('engagement', 'create')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.survey.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        select: { id: true, startsAt: true },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      return db.survey.update({
        where: { id: existing.id },
        data: { status: 'active', startsAt: existing.startsAt ?? new Date() },
        select: { id: true, status: true },
      });
    }),

  getSurveyResults: permissionProcedure('engagement', 'read')
    .input(z.object({ surveyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Aggregate over all respondents. requireOrgScope stays as defense-in-depth
      // on top of the slice-6 min-5 k-anonymity suppression applied below.
      requireOrgScope(ctx.access);

      // §21 minimal-select: the result computation reads only the survey scalars used
      // below (title, questions) and each response's `answers` JSON — never userId or
      // other response columns. Select exactly those instead of `include: responses:true`.
      const survey = await db.survey.findFirst({
        where: {
          id: input.surveyId,
          organizationId: ctx.user.organizationId,
        },
        select: {
          id: true,
          title: true,
          questions: true,
          responses: { select: { answers: true } },
        },
      });

      if (!survey) {
        throw new Error('Encuesta no encontrada');
      }

      // Per-question summaries + the survey/question/skip all-or-nothing min-5 suppression live in the shared
      // kernel (golden-fixtured both stacks). The router owns only the auth + fetch + the surveyId/title wrap.
      const summary = summarizeSurveyResults(
        survey.questions as Array<Record<string, unknown>>,
        survey.responses as Array<{ answers: Record<string, unknown> | null }>,
      );
      return { surveyId: survey.id, title: survey.title, ...summary };
    }),

  // ── My Pending Surveys (Slice 5B) ──────────────────────────────────
  // OWN-scoped self-service read: the ACTIVE surveys the caller has NOT yet
  // responded to. NOT an org rollup, so NO requireOrgScope (it would FORBID the
  // own-scoped employee caller). `survey` is NOT a scopeWhereFor entity, so the
  // org + anti-join filter is hand-rolled rather than composed via the helper.
  //
  // "Pending" = active Survey rows (status active + within the start/end window)
  // MINUS the surveys this user already answered, expressed as an anti-join on the
  // `responses` relation: `responses: { none: { userId: ctx.user.id } }`. The
  // user filter lives INSIDE the relation `none`, so it narrows to the caller —
  // it cannot widen. Explicit select (list-UI fields only, never the raw
  // responseCount scalar) + bounded take.
  myPendingSurveys: permissionProcedure('engagement', 'read').query(async ({ ctx }) => {
    const now = new Date();
    return db.survey.findMany({
      where: {
        AND: [
          { organizationId: ctx.user.organizationId },
          // Active window: status active AND (no startsAt or already started) AND
          // (no endsAt or not yet ended). Open-ended dates are treated as active.
          { status: 'active' },
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          // Anti-join: exclude surveys the CALLER has already responded to.
          { responses: { none: { userId: ctx.user.id } } },
        ],
      },
      select: {
        id: true,
        title: true,
        type: true,
        startsAt: true,
        endsAt: true,
      },
      orderBy: { endsAt: 'asc' },
      take: 50,
    });
  }),

  // ── Take a Survey (own-scoped renderable definition) ───────────────
  // OWN-scoped self-service read used by the take form. The employee holds the
  // engagement:read@own grant, so this is permissionProcedure('engagement',
  // 'read') and intentionally does no org-rollup gate (an org-rollup gate would
  // FORBID the own-scoped caller — contrast the org-only aggregate reads above).
  //
  // `survey` is not a row-scoped entity, so the org filter + answerability gate
  // is hand-rolled in the where-clause: a survey is renderable to the caller
  // ONLY if it is `status: 'active'`, within its `[startsAt, endsAt]` window
  // (null bounds = open), and in the caller's organization. Anything else →
  // NOT_FOUND (never leak the existence of an out-of-window / cross-org survey).
  //
  // Explicit select of the RENDERABLE fields only (id/title/type/questions) —
  // never the raw responseCount scalar and never other respondents' answers.
  // already-answered is intentionally NOT pre-checked here: the submit endpoint
  // owns the duplicate-response CONFLICT, which the take UI handles.
  getSurveyForResponse: permissionProcedure('engagement', 'read')
    .input(z.object({ surveyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const survey = await db.survey.findFirst({
        where: {
          AND: [
            { id: input.surveyId },
            { organizationId: ctx.user.organizationId },
            { status: 'active' },
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          ],
        },
        select: {
          id: true,
          title: true,
          type: true,
          questions: true,
        },
      });

      if (!survey) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Encuesta no encontrada o no disponible' });
      }

      return survey;
    }),

  submitSurveyResponse: permissionProcedure('engagement', 'create')
    .input(
      z.object({
        surveyId: z.string().uuid(),
        answers: z
          .record(z.string().max(200), z.union([z.string().max(5000), z.number()]))
          .refine((obj) => Object.keys(obj).length <= 100, {
            message: 'Demasiadas respuestas (max 100)',
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Existence/active check only — select the id alone (no Survey scalars, esp. not
      // responseCount) so the unselected-findFirst rule holds and no sensitive scalar
      // is even read here.
      const survey = await db.survey.findFirst({
        where: {
          id: input.surveyId,
          organizationId: ctx.user.organizationId,
          status: 'active',
        },
        select: { id: true },
      });

      if (!survey) {
        throw new Error('Encuesta no encontrada o no activa');
      }

      try {
        // §21 minimal-select: a write response must never echo the confidential
        // `answers` JSON back. The caller (the respondent) only needs a submission
        // confirmation — id + submittedAt — not the row it just wrote.
        return await db.surveyResponse.create({
          data: {
            surveyId: input.surveyId,
            userId: ctx.user.id,
            answers: input.answers as unknown as Prisma.JsonObject,
            organizationId: ctx.user.organizationId,
          },
          select: { id: true, submittedAt: true },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Ya respondiste esta encuesta' });
        }
        throw err;
      }
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
      // min-5 (slice 6): getEnps returns a SINGLE org-wide eNPS score and the
      // promoter/passive/detractor split. Those are raw small-group head-counts: for a
      // period with 1..4 eNPS responses they expose the exact split (and the totalled
      // count is itself a small head-count), re-identifying individuals. Suppress the
      // whole result below the floor. requireOrgScope stays as defense-in-depth.
      requireOrgScope(ctx.access);

      const { period = 'quarter' } = input ?? {};
      const now = new Date();
      const since = new Date(now);

      if (period === 'month') since.setMonth(now.getMonth() - 1);
      else if (period === 'quarter') since.setMonth(now.getMonth() - 3);
      else since.setFullYear(now.getFullYear() - 1);

      // §21 minimal-select: the eNPS computation reads ONLY the score out of each
      // response's `answers` JSON (Object.values(answers)[0]). Select just `answers`
      // so we never over-fetch full SurveyResponse rows (userId, ids, timestamps).
      const responses = await db.surveyResponse.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          survey: { type: 'enps' },
          submittedAt: { gte: since },
        },
        select: { answers: true },
      });

      // The eNPS score + promoter/passive/detractor split + the response/skip/per-split min-5 floors live in
      // the shared kernel (golden-fixtured both stacks). It reads the raw response `answers` objects (first
      // value → number as-is else parseInt), so the router owns only the auth + period window + fetch.
      return computeEnps(
        responses.map((r) => r.answers as Record<string, unknown>),
        period,
      );
    }),

  // ── Climate ────────────────────────────────────────────────────────
  getClimateHeatmap: permissionProcedure('engagement', 'read')
    .input(
      z.object({
        surveyId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      // min-5 (slice 6): the heatmap is per-CATEGORY (survey dimension) scores, each
      // averaged over ALL respondents to the survey — categories are question groupings,
      // not respondent segments, so no PER-CATEGORY suppression applies. BUT a survey
      // with 1..4 total respondents derives every category average from <5 people, so a
      // survey-LEVEL floor is required: suppress all categories below the floor.
      // requireOrgScope stays as defense-in-depth.
      requireOrgScope(ctx.access);

      // §21 minimal-select: the heatmap reads only survey scalars (title, questions) and
      // each response's `answers` JSON — select those, not full response rows.
      const surveys = await db.survey.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          type: 'climate',
          ...(input?.surveyId ? { id: input.surveyId } : {}),
        },
        select: {
          id: true,
          title: true,
          questions: true,
          responses: { select: { answers: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      const survey = surveys[0];
      if (!survey) return { surveyId: null as string | null, title: '', suppressed: false, data: [] };

      // Per-category averages + the survey/per-category/skip all-or-nothing min-5 suppression live in the
      // shared kernel (golden-fixtured both stacks); the router owns the auth + fetch + surveyId/title wrap.
      const heatmap = buildClimateHeatmap(
        survey.questions as Array<Record<string, unknown>>,
        survey.responses as Array<{ answers: Record<string, unknown> | null }>,
      );
      return { surveyId: survey.id, title: survey.title, ...heatmap };
    }),

  getResultsByArea: permissionProcedure('engagement', 'read')
    .input(
      z.object({
        surveyId: z.string().uuid(),
        groupBy: z.enum(['company', 'businessUnit', 'team']).default('company'),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Per-area breakdown: each area is a respondent SEGMENT (company / business unit),
      // so an area with 1..4 respondents re-identifies. min-5 (slice 6) suppresses small
      // areas below. requireOrgScope stays as defense-in-depth.
      requireOrgScope(ctx.access);

      // §21 minimal-select: per-area aggregation reads each response's `answers` JSON
      // and its user's company/business-unit only — select exactly those, not full
      // response or user rows.
      const survey = await db.survey.findFirst({
        where: { id: input.surveyId, organizationId: ctx.user.organizationId },
        select: {
          id: true,
          responses: {
            select: {
              answers: true,
              user: {
                select: { companyId: true, businessUnitId: true },
              },
            },
          },
        },
      });

      if (!survey) throw new Error('Encuesta no encontrada');

      // Per-area averages + counts and the respondent/numeric-contributor/skip/unassigned all-or-nothing min-5
      // suppression (incl. the cross-endpoint differencing guard) live in the shared kernel (golden-fixtured
      // both stacks). The router resolves each response's area key (company|businessUnit per groupBy; a
      // falsy/absent key → the implicit unassigned bucket) and hands the raw answers to the kernel.
      const rows = survey.responses.map((r) => {
        const user = r.user as Record<string, unknown> | null;
        const key = input.groupBy === 'company' ? user?.companyId : user?.businessUnitId;
        return {
          answers: r.answers as Record<string, unknown> | null,
          areaKey: key ? (key as string) : null,
        };
      });
      const byArea = buildResultsByArea(rows);
      return { surveyId: survey.id, groupBy: input.groupBy, ...byArea };
    }),

  // ── Stubs ──────────────────────────────────────────────────────────
  getWordCloud: permissionProcedure('engagement', 'read')
    .input(z.object({ surveyId: z.string().uuid() }))
    .query(async ({ ctx }) => {
      // min-5 (slice 6): stub — returns no data yet. When the NLP service lands, word
      // frequencies must be suppressed for surveys with <5 respondents (a word said by
      // one person re-identifies). requireOrgScope stays as defense-in-depth.
      requireOrgScope(ctx.access);

      // TODO: integrate NLP service for word frequency extraction
      return { words: [] as { text: string; weight: number }[] };
    }),

  getSentiment: permissionProcedure('engagement', 'read')
    .input(z.object({ surveyId: z.string().uuid() }))
    .query(async ({ ctx }) => {
      // min-5 (slice 6): stub — returns no data yet. When sentiment analysis lands it
      // returns a single org-wide split over all respondents (no per-segment partition),
      // but `highlights` (verbatim quotes) must be suppressed for surveys with <5
      // respondents. requireOrgScope stays as defense-in-depth.
      requireOrgScope(ctx.access);

      // TODO: integrate NLP/AI service for sentiment analysis
      return { positive: 0, neutral: 0, negative: 0, highlights: [] as string[] };
    }),

  // ── Alerts & Action Plans ──────────────────────────────────────────
  getLowClimateAlerts: permissionProcedure('engagement', 'read')
    .input(
      z.object({ threshold: z.number().min(0).max(10).default(3) }).optional(),
    )
    .query(async ({ ctx }) => {
      // Aggregate over all respondents — org-only until slice-6 min-5
      // scope-aware aggregation (recorded in REMAINING-WORK).
      requireOrgScope(ctx.access);

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
      // Row-level list: compose the actionPlan scope fragment so narrow-scoped
      // callers only see plans they are responsible for (own) or within their
      // team/unit subject set.
      const scopeWhere = (await scopeWhereFor('actionPlan', ctx.access, ctx.user.id)) as Prisma.ActionPlanWhereInput;

      return db.actionPlan.findMany({
        where: {
          AND: [
            { organizationId: ctx.user.organizationId },
            scopeWhere,
            { ...(input?.status ? { status: input.status } : {}) },
          ],
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
      // Write-rule: the responsible person must be within the caller's subject set.
      await assertSubjectInScope(ctx.access, ctx.user.id, input.responsibleId, 'No puedes asignar este plan a ese usuario');

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
      // Probe the action plan so narrow-scoped callers cannot update out-of-scope plans.
      await assertScoped('actionPlan', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);
      // Codex: reassigning responsibility must also target the caller's
      // subject set — otherwise an in-scope plan can be pushed out of scope.
      if (input.responsibleId) {
        await assertSubjectInScope(ctx.access, ctx.user.id, input.responsibleId, 'No puedes asignar este plan a ese usuario');
      }

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
      // LeaderCommitment rows anchor on leaderId — the fragment scopes them
      // (own → only mine; team/unit → leaders in my subject set; org → all).
      // The input leaderId filter can only intersect, never widen.
      const scopeWhere = await scopeWhereFor('leaderCommitment', ctx.access, ctx.user.id);
      return db.leaderCommitment.findMany({
        where: {
          AND: [
            { organizationId: ctx.user.organizationId },
            scopeWhere as Prisma.LeaderCommitmentWhereInput,
            {
              ...(input?.leaderId ? { leaderId: input.leaderId } : {}),
              ...(input?.status ? { status: input.status } : {}),
            },
          ],
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
      // Aggregate over org users — org-only until slice-6 min-5
      // scope-aware aggregation (recorded in REMAINING-WORK).
      requireOrgScope(ctx.access);

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
    // Org-rollup aggregate: only available at org/company scope until slice-6
    // introduces scope-aware aggregation (recorded in REMAINING-WORK).
    requireOrgScope(ctx.access);

    const orgId = ctx.user.organizationId;

    const [activeSurveys, totalResponses, perSurveyGroups, actionPlansOpen] = await Promise.all([
      db.survey.count({ where: { organizationId: orgId, status: 'active' } }),
      db.surveyResponse.count({ where: { organizationId: orgId } }),
      db.surveyResponse.groupBy({
        by: ['surveyId'],
        where: { organizationId: orgId },
        _count: { _all: true },
      }),
      db.actionPlan.count({ where: { organizationId: orgId, status: { in: ['pending', 'in_progress'] } } }),
    ]);

    // The org-total min-5 floor + the cross-endpoint per-survey DIFFERENCING guard live in the shared kernel
    // (golden-fixtured both stacks): if ANY per-survey response count is 1..4, the org total is nulled too
    // (else the visible surveys' sum subtracted from the org total recovers a suppressed survey's count).
    return buildEngagementKpis(
      activeSurveys,
      totalResponses,
      perSurveyGroups.map((g) => g._count._all),
      actionPlansOpen,
    );
  }),
});
