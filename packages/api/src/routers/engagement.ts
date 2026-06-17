import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertScoped, assertSubjectInScope, requireOrgScope, suppressBelowMin5 } from '../access';

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

      const totalResponses = survey.responses.length;

      // min-5 (slice 6): a survey with 1..4 respondents cannot be shown per-question
      // without re-identifying individuals — suppress the WHOLE result. (0 respondents
      // passes through as an empty, non-suppressed result; it reveals no person.)
      const surveyLevel = suppressBelowMin5(totalResponses);
      if (surveyLevel.suppressed) {
        // Total-leak guard (slice 6): returning the raw totalResponses (e.g. 3) directly
        // exposes the small respondent count. Null it; `suppressed: true` already tells
        // the UI the survey is masked.
        return {
          surveyId: survey.id,
          title: survey.title,
          totalResponses: null as number | null,
          suppressed: true,
          questionSummaries: [] as Array<Record<string, unknown>>,
        };
      }

      // Per-question summaries are computed first WITH their own contributor + skip floor,
      // then a UNIFORM all-or-nothing pass masks EVERY question when ANY one is sub-floor.
      type QuestionSummary = { question: unknown; type: unknown; average?: number | null; count: number | null; suppressed: boolean };
      const rawSummaries: QuestionSummary[] = (survey.questions as Array<Record<string, unknown>>).map((q: Record<string, unknown>) => {
        const answers = survey.responses
          .map((r) => (r.answers as Record<string, unknown> | null)?.[q.text as string])
          .filter(Boolean);

        // Per-question contributor + skip floor: a question answered (contributor count)
        // by only 1..4 respondents leaks the individual answer (and its average IS an
        // individual value). The SKIPPED bucket (totalResponses − contributorCount) is a
        // complementary small group — an optional question answered by 5 of a 9-response
        // survey leaves a skipped bucket of 4 that totalResponses − count would recover.
        // Suppress when EITHER the contributor OR the skipped bucket is 1..4.
        if (q.type === 'scale') {
          const nums = answers.map(Number).filter((n: number) => !isNaN(n));
          const skipped = totalResponses - nums.length;
          const s = suppressBelowMin5(nums.length).suppressed || suppressBelowMin5(skipped).suppressed;
          if (s) {
            return { question: q.text, type: q.type, average: null, count: null, suppressed: true };
          }
          const avg = nums.length ? nums.reduce((a: number, b: number) => a + b, 0) / nums.length : 0;
          return { question: q.text, type: q.type, average: Math.round(avg * 100) / 100, count: nums.length, suppressed: false };
        }

        const skipped = totalResponses - answers.length;
        const s = suppressBelowMin5(answers.length).suppressed || suppressBelowMin5(skipped).suppressed;
        if (s) {
          return { question: q.text, type: q.type, count: null, suppressed: true };
        }
        return { question: q.text, type: q.type, count: answers.length, suppressed: false };
      });

      // Distinguishing-flag oracle (round 6, MEDIUM 7) + skip-bucket oracle (round 9):
      // once totalResponses>=5 the per-question flags were independent, so a 6-respondent
      // survey with ONE sparse question revealed exactly which question had a sub-floor
      // contributor (or skip) set. And returning the real per-question contributor count
      // alongside totalResponses lets `totalResponses − count` recover a 1..4 skip bucket
      // (9-response survey, optional question answered by 5 → skipped = 9 − 5 = 4).
      // Apply UNIFORM all-or-nothing: when ANY question's contributor OR skip bucket is
      // sub-floor, return an EMPTY questionSummaries array (no per-question keys) +
      // suppressed:true — consistent with the empty-when-suppressed rule the distributions
      // use, so neither the flag nor the count distinguishes/recovers a sparse question.
      const anyQuestionSuppressed = rawSummaries.some((q) => q.suppressed);
      if (anyQuestionSuppressed) {
        return {
          surveyId: survey.id,
          title: survey.title,
          totalResponses: totalResponses as number | null,
          suppressed: true,
          questionSummaries: [] as Array<Record<string, unknown>>,
        };
      }

      return { surveyId: survey.id, title: survey.title, totalResponses: totalResponses as number | null, suppressed: false, questionSummaries: rawSummaries };
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

      const scores = responses
        .map((r) => {
          const vals = Object.values(r.answers as Record<string, unknown>);
          return typeof vals[0] === 'number' ? (vals[0] as number) : parseInt(vals[0] as string, 10);
        })
        .filter((n: number) => !isNaN(n));

      // min-5 (slice 6): suppress the whole eNPS result when fewer than 5 valid
      // responses — the score, the promoter/passive/detractor head-counts, and the
      // respondent count itself are all small-group disclosures. (0 responses passes
      // through unsuppressed: it reveals no individual. The suppressed shape mirrors
      // getSurveyResults — counts nulled, suppressed: true.)
      //
      // Contributor + skip floor (round 9): `scores` is the VALID-SCORE contributor set;
      // the complementary skip bucket (fetched responses − valid scores) is responses that
      // gave no parseable eNPS score — its own small group. Fold the skip bucket into the
      // floor so a 6-response period where only 4 gave a valid score (skip = 2) — or 4 gave
      // valid + 1 invalid (skip = 1) — suppresses the whole result rather than averaging a
      // sub-floor contributor set.
      const enpsSkipped = responses.length - scores.length;
      const responseFloor = {
        suppressed: suppressBelowMin5(scores.length).suppressed || suppressBelowMin5(enpsSkipped).suppressed,
      };
      if (responseFloor.suppressed) {
        return {
          enps: null as number | null,
          promoters: null as number | null,
          passives: null as number | null,
          detractors: null as number | null,
          totalResponses: null as number | null,
          suppressed: true,
          period,
        };
      }

      const total = scores.length || 1;
      const promoters = scores.filter((s: number) => s >= 9).length;
      const detractors = scores.filter((s: number) => s <= 6).length;
      const passives = total - promoters - detractors;
      const enps = Math.round(((promoters - detractors) / total) * 100);

      // Per-split min-5 (slice 6 round 4): promoters/passives/detractors are a
      // 3-way PARTITION of the eNPS respondents. With total>=5 the response-floor
      // branch above passes through, but a single split of 1..4 still leaks that
      // exact head-count directly AND allows recovery via
      //   totalResponses − (visible split A) − (visible split B) = hidden split C
      // so when ANY non-zero split is below the floor, null the WHOLE eNPS result
      // the same way the response-floor does.
      // (suppressBelowMin5(0) returns {suppressed:false} — a zero bucket is fine.)
      // Guard on scores.length > 0: when there are 0 valid responses the `|| 1`
      // sentinel in `total` would make passives = 1, falsely triggering suppression
      // for an empty result that reveals no individual. The response-floor branch
      // above already handles the 0 case (suppressed:false, counts:0).
      const splitSuppressed =
        scores.length > 0 &&
        [promoters, passives, detractors].some((n) => suppressBelowMin5(n).suppressed);

      if (splitSuppressed) {
        return {
          enps: null as number | null,
          promoters: null as number | null,
          passives: null as number | null,
          detractors: null as number | null,
          totalResponses: null as number | null,
          suppressed: true,
          period,
        };
      }

      return {
        enps: enps as number | null,
        promoters: promoters as number | null,
        passives: passives as number | null,
        detractors: detractors as number | null,
        totalResponses: scores.length as number | null,
        suppressed: false,
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

      type HeatCell = { category: string; score: number | null };
      const survey = surveys[0];
      if (!survey) return { surveyId: null as string | null, title: '', suppressed: false, data: [] as HeatCell[] };

      // Survey-level min-5 floor: a climate survey with 1..4 respondents leaks
      // category averages derived from <5 people. Suppress all categories. (0
      // respondents passes through as an empty, non-suppressed result.)
      const surveyLevel = suppressBelowMin5(survey.responses.length);
      if (surveyLevel.suppressed) {
        return { surveyId: survey.id, title: survey.title, suppressed: true, data: [] as HeatCell[] };
      }

      const categories = [...new Set((survey.questions as Array<Record<string, unknown>>).map((q: Record<string, unknown>) => q.category as string).filter(Boolean))];

      // Per-category distinct-respondent floor (round 7, finding 5): the survey-level
      // floor only guards the TOTAL respondent count — a category answered by 1..4
      // people (e.g. one optional question only one person answered) still returns that
      // person's score. For each category count the DISTINCT respondents who contributed
      // a numeric answer; if ANY category has 1..4 contributors, UNIFORMLY suppress every
      // category (null all scores + suppressed:true), consistent with the all-or-nothing
      // rule (a per-category flag would distinguish which category is sparse). 0
      // contributors is not suppressed (an unanswered category reveals no individual).
      const perCategory = categories.map((cat: string) => {
        const catQuestions = (survey.questions as Array<Record<string, unknown>>).filter((q: Record<string, unknown>) => q.category === cat);
        let contributors = 0;
        const scores = survey.responses.flatMap((r) => {
          const rowScores = catQuestions
            .map((q: Record<string, unknown>) => Number((r.answers as Record<string, unknown> | null)?.[q.text as string]))
            .filter((n: number) => !isNaN(n));
          if (rowScores.length) contributors += 1;
          return rowScores;
        });
        return { cat, scores, contributors };
      });

      // Contributor + skip floor (round 9): a category's average is over its contributor
      // set, and the complementary skip bucket (survey respondents − category contributors)
      // is its own small group. Suppress uniformly when EITHER is 1..4 for ANY category —
      // consistent with the all-or-nothing contributor/skip policy.
      const anyCategorySuppressed = perCategory.some(
        (c) =>
          suppressBelowMin5(c.contributors).suppressed ||
          suppressBelowMin5(survey.responses.length - c.contributors).suppressed,
      );
      if (anyCategorySuppressed) {
        // Uniform: null every category score (no per-category cardinality), suppressed:true.
        const data: HeatCell[] = perCategory.map((c) => ({ category: c.cat, score: null }));
        return { surveyId: survey.id, title: survey.title, suppressed: true, data };
      }

      const data: HeatCell[] = perCategory.map(({ cat, scores }) => {
        const avg = scores.length ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;
        return { category: cat, score: Math.round(avg * 100) / 100 };
      });

      return { surveyId: survey.id, title: survey.title, suppressed: false, data };
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

      // Track both the answer-value pool (for the average) and the distinct respondent
      // count per area (the head-count that min-5 gates on). Responses whose user has
      // no company/business-unit (or whose user is null after deletion) form an IMPLICIT
      // "skipped/unassigned" bucket — it must obey the floor too (see below), so count it.
      const groups: Record<string, { scores: number[]; respondents: number; numericContributors: number }> = {};
      let skippedCount = 0;
      for (const r of survey.responses) {
        const key =
          input.groupBy === 'company'
            ? (r.user as Record<string, unknown> | null)?.companyId as string | undefined
            : (r.user as Record<string, unknown> | null)?.businessUnitId as string | undefined;
        if (!key) {
          skippedCount += 1;
          continue;
        }
        if (!groups[key]) groups[key] = { scores: [], respondents: 0, numericContributors: 0 };
        groups[key]!.respondents += 1;
        const vals = Object.values(r.answers as Record<string, unknown>)
          .map(Number)
          .filter((n: number) => !isNaN(n));
        // A response is a NUMERIC CONTRIBUTOR only if it actually supplied >=1 numeric
        // score. The average is computed from these contributors, so a respondent who
        // gave no numeric answer must not inflate the population the floor gates on.
        if (vals.length) groups[key]!.numericContributors += 1;
        groups[key]!.scores.push(...vals);
      }

      // min-5 (slice 6): an area with fewer than 5 respondents has its average AND
      // respondent count suppressed (null) so individual climate scores cannot leak.
      //
      // Cross-endpoint differencing guard (slice 6, reviewer finding): even with small
      // areas nulled, getSurveyResults.totalResponses (when >=5) minus the VISIBLE area
      // counts recovers a single suppressed area's size. So when ANY area is suppressed,
      // null `responses` AND `average` on EVERY area (visible ones included) — removing
      // both the subtraction inputs and any residual average+count recovery path.
      //
      // Skipped-bucket trigger (slice 6 round 2): the unassigned/null-key responses are
      // dropped BEFORE this check, so 3 unassigned + 20 assigned looks all-clear — yet
      // getSurveyResults.totalResponses (23) − visible (20) = 3 recovers the skipped
      // bucket. Fold skippedCount into the suppression trigger so a sub-floor implicit
      // bucket nulls every visible area count too. We do not emit the skipped bucket as
      // a visible area (keeping it hidden, not differenceable).
      // Present-key cardinality (round 7): each area is a respondent SEGMENT, so an area
      // key is a present-group marker. When the survey's TOTAL respondent count is 1..4,
      // OR ANY area, OR the implicit skipped/unassigned bucket is below the floor, emit
      // an EMPTY results array (no per-area keys) + top-level `suppressed: true`. This
      // EXTENDS the prior tiny-N-only empty branch to ANY suppressed area/bucket:
      // emitting area keys with nulled counts still leaks via cardinality (N present +
      // area-key set pins singletons) and via getSurveyResults.totalResponses − Σ visible.
      // No keys ⇒ nothing recoverable. 0 respondents passes through as [] (no individual).
      // Numeric-contributor population (round 9): the per-area `average` is computed from
      // the responses that supplied a numeric score — NOT the respondent head-count. An
      // area can clear the respondent floor (>=5) yet have only 1..4 numeric contributors
      // (5 respondents, 1 numeric answer → average IS that one person's value). So the
      // all-or-nothing trigger must fold in BOTH the numeric-contributor count AND its
      // complementary skip bucket (respondents − numericContributors) per area, alongside
      // the existing respondent + survey-total + skipped/unassigned triggers. When ANY
      // fires, emit an EMPTY results array (no per-area keys) + suppressed:true, so the
      // average is never computed/returned over a 1..4 numeric-contributor set and no
      // count is differenceable.
      type AreaOut = { groupId: string; average: number | null; responses: number | null; suppressed: boolean };
      const anyAreaSuppressed =
        Object.values(groups).some(
          (a) =>
            suppressBelowMin5(a.respondents).suppressed ||
            suppressBelowMin5(a.numericContributors).suppressed ||
            suppressBelowMin5(a.respondents - a.numericContributors).suppressed,
        ) ||
        suppressBelowMin5(skippedCount).suppressed;
      if (suppressBelowMin5(survey.responses.length).suppressed || anyAreaSuppressed) {
        return { surveyId: survey.id, groupBy: input.groupBy, results: [] as AreaOut[], suppressed: true };
      }

      // Every area (respondents + numeric contributors + their skip bucket) + the skipped
      // bucket cleared the floor → publish averages + counts.
      const results = Object.entries(groups).map(([id, { scores, respondents }]): AreaOut => ({
        groupId: id,
        average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0,
        responses: respondents as number | null,
        suppressed: false,
      }));

      return { surveyId: survey.id, groupBy: input.groupBy, results, suppressed: false };
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

    // min-5 floor (round 6, MEDIUM 8 + round 8 oracle fix): totalResponses is an org-wide
    // survey-respondent head-count. At 1..4 it is itself a sub-floor disclosure.
    //
    // Cross-endpoint differencing oracle (round 8): even when the org total is >=5, the
    // per-survey endpoints (getSurveyResults) suppress any survey with a 1..4 response
    // count. A caller can query the visible (>=5) surveys, sum their totals, and subtract
    // from this org-wide total to recover a single suppressed survey's 1..4 count. So
    // share the per-survey all-or-nothing trigger: if ANY individual survey has a
    // sub-floor (1..4) response count, null the org total too. A survey with 0 responses
    // reveals no individual (suppressBelowMin5(0) is not suppressed) and does not trigger.
    const anySurveySubFloor = perSurveyGroups.some((g) => suppressBelowMin5(g._count._all).suppressed);
    const responsesFloor = suppressBelowMin5(totalResponses);
    const totalResponsesSuppressed = responsesFloor.suppressed || anySurveySubFloor;

    return {
      activeSurveys,
      totalResponses: totalResponsesSuppressed ? null : totalResponses,
      totalResponsesSuppressed,
      actionPlansOpen,
      highRiskCount: 0,
    };
  }),
});
