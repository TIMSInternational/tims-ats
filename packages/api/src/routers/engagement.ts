import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import { requireOrgScope, suppressBelowMin5 } from '../access';
import { summarizeSurveyResults, buildResultsByArea } from '@tims/shared';

// ── #56 disposition of the 8 residual TS procedures (2026-08-05) ──────────────────────────────
// Both engagement flags (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP / _WRITE_VIA_CSHARP) are live in
// prod and C# implements all 14 reads + all 5 writes. Each residual procedure was dispositioned
// individually; nothing here is "left over because nobody looked."
//
//   DELETED this pass (4):
//     createActionPlan / updateActionPlan — the ONLY remaining TS writers of `action_plans`, and
//       therefore the sole TS-side blocker on the #68 ownership flip. Zero call sites anywhere in
//       apps/web, workers or packages (verified by full-repo grep). C# owns both endpoints
//       (POST /engagement/action-plans, PATCH /engagement/action-plans/{id}) INCLUDING the H1
//       cross-tenant `responsibleId` hardening — EngagementWriteRepository.cs:175 (create),
//       :230-231 (reassign), the shared check at :291-293 — plus the FOR UPDATE scope re-check
//       that the TS updateMany was only approximating. Parity coverage does NOT regress: the
//       write parity harness (scripts/parity/write-surfaces.ts:1039-1120) drives the C# HTTP
//       endpoints and asserts side effects with raw SQL read-backs — it never had a `tsProcedure`
//       field (write-surfaces.ts:642), so it never depended on these procedures.
//     getWordCloud / getSentiment — deleted rather than converted to a 501. They were never
//       "honest-unavailable": each returned HTTP 200 with an EMPTY payload, which a caller cannot
//       distinguish from a survey that genuinely has no text answers — the dishonest variant of
//       unavailable. C# already serves both routes with the identical stub behind the identical
//       org-rollup gate (EngagementReadEndpoints.cs:277 and :297), so the domain stays covered and
//       a TS 501 would only add a second, weaker answer to a question C# already answers. Neither
//       is registered in the parity surface (they are Tier-2 by-id deferrals — surfaces.ts:238),
//       so deleting them costs zero verification coverage. climate-sidebar.tsx renders a static
//       unavailable placeholder and never called either.
//
//   KEPT, with reasons (4) — each is load-bearing TODAY, not inertia:
//     listSurveys / getRotationRisk — the TS half of the only two LIVE parity endpoints left on
//       the engagement read surface (scripts/parity/surfaces.ts:261 and :269 register them as
//       `tsProcedure`).
//
//       CORRECTED 2026-08-10: this comment used to call `tsProcedure` "a REQUIRED field —
//       surfaces.ts:7" and conclude that deleting either procedure "turns `verify engagement` into a
//       partial or total no-op". BOTH halves are now false. `tsProcedure` was made OPTIONAL by
//       `efb7553f` (PR #144, 2026-08-06) and is declared `tsProcedure?: string` at surfaces.ts:19.
//       When it is absent, checks/parity.ts:24-40 reports `[WEAK]` with an explicit
//       "no tsProcedure registered … NO cross-stack comparison ran" reason, and the RLS Mode-A
//       cross-tenant probe and the RBAC deny assertions still run — a did-not-run never renders as a
//       tick. So these procedures CAN be deleted by flip #64, provided each endpoint is converted to
//       C#-only by OMITTING `tsProcedure`. What must not happen is deleting the ENDPOINT or the
//       SURFACE: that is what removes the IDOR probe, and surfaces.ts:8-18 calls it a
//       security-coverage regression rather than a cleanup.
//
//       listSurveys also
//       still backs a live invalidate-only FE consumer
//       (engagement/climate/launch-survey-modal.tsx:58) and a static tripwire
//       (tests/tier1/s2-engagement-wiring.test.ts:33). Their removal is runbook §7b edits 1b + 4,
//       which belong to flip #64, not here.
//     getSurveyResults / getResultsByArea — the ONLY remaining TS callers of the golden-fixtured
//       min-5 kernels `summarizeSurveyResults` / `buildResultsByArea`, and the only surviving
//       relation reads into `survey_responses` (the nested `responses: { select: ... }` at :127 and
//       :171 below — they never show up in a `.surveyResponse.` grep). They are the TS side of a
//       CROSS-STACK golden-fixture contract; retiring them is runbook §7b edit 3, i.e. flip #64.
//
// Flip #68 (`action_plans`) is NOT unblocked by this alone: `packages/api/src/routers/
// monitoring.ts:150` still READS `db.actionPlan.findMany`, and `packages/api/src/access/
// scoped-probe.ts` / `entity-policies.ts` still register the Prisma delegate. Only the TS WRITER
// blocker is cleared here. (Line re-verified 2026-08-10 on rebase: the read is at :150, not the
// :158 this comment originally cited — monitoring.ts moved under #100/#140.)
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
  // routes to the C# service unconditionally for all 8. (UPDATE 2026-08-05, #56: of the 6
  // zero-wrapper reads that survived that pass, getWordCloud + getSentiment have since been
  // deleted too; the survivors are listSurveys above, getSurveyResults above, getResultsByArea
  // here, and getRotationRisk below — see the disposition block at the top of this file.)
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

  // ── Stubs (getWordCloud + getSentiment) — DELETED 2026-08-05 (#56) ─────────────────────────
  // Both returned a 200 with an empty payload while awaiting an NLP service that does not exist.
  // C# serves both routes with the identical stub behind the identical org-rollup gate
  // (EngagementReadEndpoints.cs:277, :297); the FE renders a static unavailable placeholder
  // (engagement/climate/climate-sidebar.tsx) and never called either. See the header block.

  // ── Alerts & Action Plans ──────────────────────────────────────────
  // getLowClimateAlerts + listActionPlans (the two reads) were deleted in the 2026-07-31
  // TS-deletion pass — see the note above getResultsByArea.
  //
  // createActionPlan + updateActionPlan — DELETED 2026-08-05 (#56). They were the LAST TS writers
  // of `action_plans`; C# is now the sole application writer (EngagementWriteEndpoints.cs:171,
  // :221 → EngagementWriteRepository.cs:175, :230-231, :291-293 for the H1 in-org `responsibleId`
  // backstop). The invariant is pinned by tests/access/scope-wiring-engagement-write.test.ts,
  // which now asserts ZERO TS writers rather than grepping this file for the guards.

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
