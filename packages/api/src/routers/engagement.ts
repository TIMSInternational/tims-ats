import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertScoped, assertSubjectInScope, requireOrgScope, suppressBelowMin5 } from '../access';
import { summarizeSurveyResults, buildResultsByArea } from '@tims/shared';

export const engagementRouter = router({
  // ── Surveys ────────────────────────────────────────────────────────
  listSurveys: permissionProcedure('engagement', 'read')
    .input(
      z
        .object({
          status: z.enum(['draft', 'active', 'closed']).optional(),
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(100).default(20),
        })
        .optional(),
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

  // TS-deletion (2026-07-31, NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed live in prod): the 8
  // reads with a live FE wrapper — the exact list is enumerated in
  // apps/web/lib/platform-api/engagement.ts's file header — were deleted here; the wrapper now
  // routes to the C# service unconditionally for all 8. getSurveyResults above and
  // getResultsByArea/getWordCloud/getSentiment/getRotationRisk below (plus listSurveys further
  // above) are untouched, pre-existing zero-wrapper procedures, unrelated to this deletion.
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
  // getLowClimateAlerts + listActionPlans (the two reads) were deleted in the 2026-07-31
  // TS-deletion pass — see the note above getResultsByArea. The two action-plan write
  // mutations below are unaffected (write-side, unrelated to the read flag).
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
      await assertSubjectInScope(
        ctx.access,
        ctx.user.id,
        input.responsibleId,
        'No puedes asignar este plan a ese usuario',
      );

      // H1 (both-stacks hardening — succession #171 / 11c precedent): assertSubjectInScope no-ops for
      // organization/company scope (write-rules.ts:20), and the pre-seed engagement:create grants are org-wide, so the
      // common caller path skips the subject check entirely. responsibleId is a bare FK to `users` — the FK only
      // checks the user EXISTS in ANY org, and the action_plans RLS WITH CHECK guards only organization_id — so an
      // org-scoped admin could otherwise persist a CROSS-ORG responsibleId. Prove the target is in the caller's org
      // (an RLS-scoped tenantDb read) and FORBID otherwise. Mirrors the C# EngagementWriteRepository backstop.
      const inOrg = await db.user.findFirst({
        where: { id: input.responsibleId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!inOrg) throw new TRPCError({ code: 'FORBIDDEN', message: 'No puedes asignar este plan a ese usuario' });

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
        await assertSubjectInScope(
          ctx.access,
          ctx.user.id,
          input.responsibleId,
          'No puedes asignar este plan a ese usuario',
        );
        // H1 (both-stacks): a reassignment must target a user in the caller's org. assertSubjectInScope no-ops for
        // org/company scope, so back it with an in-org existence check (RLS-scoped) — a cross-org responsibleId is a
        // cross-tenant integrity/enumeration hole. Mirrors createActionPlan + the C# EngagementWriteRepository backstop.
        const inOrg = await db.user.findFirst({
          where: { id: input.responsibleId, organizationId: ctx.user.organizationId },
          select: { id: true },
        });
        if (!inOrg) throw new TRPCError({ code: 'FORBIDDEN', message: 'No puedes asignar este plan a ese usuario' });
      }

      const { id, dueDate, ...data } = input;
      const updateData = {
        ...data,
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
      };
      // Codex HIGH (both stacks): assertScoped above and the UPDATE are separate statements — a concurrent
      // reassignment could move the plan out of the caller's narrow scope BETWEEN them, and a bare
      // update-by-{id,org} would still apply. Re-apply the caller's scope predicate ATOMICALLY in the WHERE:
      // updateMany (unlike update) admits a non-unique where, so count 0 ⇒ the plan left scope (or vanished) ⇒ 404.
      // Mirrors the C# EngagementWriteRepository FOR UPDATE scope re-check.
      const scopeWhere = (await scopeWhereFor('actionPlan', ctx.access, ctx.user.id)) as Prisma.ActionPlanWhereInput;
      const { count } = await db.actionPlan.updateMany({
        where: { AND: [{ id }, { organizationId: ctx.user.organizationId }, scopeWhere] },
        data: updateData,
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan de accion no encontrado' });
      // Codex recheck: `tenantDb` wraps each call in its own txn, so this read-back is a SEPARATE txn from the
      // guarded updateMany — a concurrent reassignment between them could otherwise echo an out-of-scope row in the
      // response. Re-apply `scopeWhere` here too: if the plan left the caller's scope post-write, this returns null
      // (leak-free) rather than a row the caller may no longer see. (The C# path is race-free — it mutates + returns
      // the FOR UPDATE-locked row in one txn.)
      return db.actionPlan.findFirst({
        where: { AND: [{ id }, { organizationId: ctx.user.organizationId }, scopeWhere] },
        select: {
          id: true,
          organizationId: true,
          title: true,
          responsibleId: true,
          area: true,
          status: true,
          dueDate: true,
          actions: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),

  // ── Rotation Risk ──────────────────────────────────────────────────
  // (listLeaderCommitments, formerly here, was deleted in the 2026-07-31 TS-deletion pass — see
  // the note above getResultsByArea.)
  getRotationRisk: permissionProcedure('engagement', 'read')
    .input(
      z
        .object({
          companyId: z.string().uuid().optional(),
          businessUnitId: z.string().uuid().optional(),
        })
        .optional(),
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

  // (getDashboardKpis, formerly here, was deleted in the 2026-07-31 TS-deletion pass — see the note
  // above getResultsByArea.)
});
