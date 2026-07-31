'use client';

// Engagement FE data layer.
//
// C#-ONLY (8 of the 8 read hooks below, plus the 3 write mutations at the bottom). Their TS tRPC
// procedures were DELETED — the 3 writes (createSurvey/activateSurvey/submitSurveyResponse) on
// 2026-07-29 (NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP confirmed live in prod), and all 8 reads
// (myPendingSurveys/getSurveyForResponse/getEnps/getClimateHeatmap/getLowClimateAlerts/
// listActionPlans/listLeaderCommitments/getDashboardKpis) on 2026-07-31
// (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed live in prod — see docs/REMAINING-WORK.md).
// Every hook here now calls the C# service unconditionally and no longer reads either FE flag —
// both flags are DEAD (mirrors the succession/nine-box/compensation precedent once their reads
// went C#-only). Output types are hand-declared below, or re-sourced from the @tims/shared
// kernels the C# port is golden-fixtured against, because no tRPC procedure remains to infer
// them from.
//
// NOT WRAPPED AT ALL: listSurveys (only ever `.invalidate()`d by launch-survey-modal.tsx, never
// queried — its TS procedure is still the live path for that invalidate), getSurveyResults,
// getResultsByArea, getWordCloud, getSentiment (climate-sidebar.tsx explicitly renders a static
// "unavailable" placeholder instead of calling these two stubs), getRotationRisk — zero real FE
// call sites, so these get no hook here and their TS procedures stay live/untouched
// (packages/api/src/routers/engagement.ts).
//
// PARITY NOTES (verified per read against the pre-deletion engagement.ts +
// EngagementReadEndpoints.cs, retained for the mapping rationale):
//   - getSurveyForResponse — both stacks throw/404 on a missing, out-of-window, or cross-org
//     survey (tRPC: `throw new Error(...)`; C#: a clean 404). The wrapper does not special-case
//     this — a missing survey PROPAGATES as a thrown error, matching react-query's error state.
//   - getEnps/getClimateHeatmap/getLowClimateAlerts/listActionPlans/listLeaderCommitments all
//     accepted OPTIONAL TS-side filters (period/companyId/surveyId/threshold/status/leaderId) that
//     NO live FE call site ever passed (every consumer called with `{}` or no args) — matching the
//     ninebox precedent's "wrap only what's actually consumed" principle, these hooks take NO
//     arguments.

import { useMutation, useQuery } from '@tanstack/react-query';
import { platformGet, platformPost } from './client';

// The C#-only hooks' output types are hand-declared (there is no tRPC procedure left to infer
// from). Shapes mirror what the deleted procedures returned, so every call site is unchanged.
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface MyPendingSurveyRow {
  id: string;
  title: string;
  type: string;
  startsAt: Date | null;
  endsAt: Date | null;
}
type MyPendingSurveysOutput = MyPendingSurveyRow[];

// §21 minimal-select: getSurveyForResponse returned `select: { id, title, type, questions }`.
interface SurveyForResponseOutput {
  id: string;
  title: string;
  type: string;
  questions: JsonValue;
}

// computeEnps's return shape (packages/shared/src/engagement.ts) — the deleted getEnps procedure
// returned it verbatim. Hand-declared rather than imported so this file stays decoupled from the
// TS-only kernel now that no TS caller invokes it directly; the C# port is golden-fixtured
// against the same shape.
interface EnpsOutput {
  enps: number | null;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  totalResponses: number | null;
  suppressed: boolean;
  period: string;
}

interface ClimateHeatmapOutput {
  surveyId: string | null;
  title: string;
  suppressed: boolean;
  data: Array<{ category: string; score: number | null }>;
}

// Prisma `Alert` scalar row (packages/db/prisma/schema/monitoring.prisma:21-44). The deleted
// getLowClimateAlerts was a bare findMany with no `select`, so the tRPC output was the full
// 12-field row with superjson-rebuilt Dates.
interface LowClimateAlertRow {
  id: string;
  organizationId: string;
  ruleId: string | null;
  module: string;
  severity: string;
  title: string;
  message: string;
  metadata: JsonValue | null;
  status: string;
  dismissedById: string | null;
  dismissedAt: Date | null;
  createdAt: Date;
}
type LowClimateAlertsOutput = LowClimateAlertRow[];

// Prisma `ActionPlan` row (packages/db/prisma/schema/engagement.prisma:41-58) + the `responsible`
// relation the deleted listActionPlans `include`d.
interface ActionPlanRow {
  id: string;
  organizationId: string;
  title: string;
  responsibleId: string;
  area: string | null;
  status: string;
  dueDate: Date | null;
  actions: JsonValue | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  responsible: { id: string; firstName: string; lastName: string; avatar: string | null };
}
type ListActionPlansOutput = ActionPlanRow[];

// Prisma `LeaderCommitment` row (packages/db/prisma/schema/engagement.prisma:61-77) + the
// `leader` relation the deleted listLeaderCommitments `include`d.
interface LeaderCommitmentRow {
  id: string;
  organizationId: string;
  leaderId: string;
  description: string;
  status: string;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  leader: { id: string; firstName: string; lastName: string; avatar: string | null };
}
type ListLeaderCommitmentsOutput = LeaderCommitmentRow[];

// buildEngagementKpis's return shape (packages/shared/src/engagement.ts) — the deleted
// getDashboardKpis procedure returned it verbatim.
interface DashboardKpisOutput {
  activeSurveys: number;
  totalResponses: number | null;
  totalResponsesSuppressed: boolean;
  actionPlansOpen: number;
  highRiskCount: number;
}

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to the `number` the tRPC output declared. Nullable
// numeric fields need the null-preserving variant.
const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null): number | null => (v == null ? null : Number(v));

// DateTime fields serialize as canonical Node-ISO strings (…fffZ) via the shared Node-ISO
// converter. The tRPC output typed them as Prisma `Date` (superjson rebuilds real Date objects),
// so the C# path reconstructs Date objects to stay byte-identical to the pre-cutover shape. The
// contract types the raw values as `unknown`; parse to Date (or null for nullable date columns).
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

/**
 * SELF-scoped list: the caller's own not-yet-answered active surveys. C#-ONLY — the TS tRPC
 * procedure was deleted 2026-07-31. GET /engagement/my/pending-surveys (id/title/type scalars;
 * startsAt/endsAt Date|null).
 */
export function useEngagementMyPendingSurveys() {
  return useQuery<MyPendingSurveysOutput>({
    queryKey: ['platform-api', 'engagement', 'my-pending-surveys'],
    queryFn: async () => {
      const raw = await platformGet('/engagement/my/pending-surveys');
      return raw.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        startsAt: toDateOrNull(s.startsAt),
        endsAt: toDateOrNull(s.endsAt),
      }));
    },
  });
}

/**
 * SELF-scoped point-read: the renderable definition of one survey the caller may answer. C#-ONLY
 * — the TS tRPC procedure was deleted 2026-07-31. Disabled until a survey is opened (matching the
 * call site's `enabled: !!surveyId`). GET /engagement/surveys/{surveyId}/take (id/title/type/
 * questions; a missing, out-of-window, or cross-org survey 404s — PROPAGATES as a thrown error).
 */
export function useEngagementSurveyForResponse(surveyId: string | null) {
  const enabledId = !!surveyId;

  return useQuery<SurveyForResponseOutput>({
    queryKey: ['platform-api', 'engagement', 'survey-for-response', surveyId],
    enabled: enabledId,
    queryFn: async () => {
      const raw = await platformGet('/engagement/surveys/{surveyId}/take', undefined, { surveyId: surveyId! });
      return {
        id: raw.id,
        title: raw.title,
        type: raw.type,
        questions: raw.questions as SurveyForResponseOutput['questions'],
      };
    },
  });
}

/**
 * ORG-rollup: the single org-wide eNPS score (min-5 suppressed). C#-ONLY — the TS tRPC procedure
 * was deleted 2026-07-31. GET /engagement/enps (enps/promoters/passives/detractors/
 * totalResponses coerced, null-preserving; suppressed/period passed through).
 */
export function useEngagementEnps() {
  return useQuery<EnpsOutput>({
    queryKey: ['platform-api', 'engagement', 'enps'],
    queryFn: async () => {
      const raw = await platformGet('/engagement/enps');
      return {
        enps: numOrNull(raw.enps),
        promoters: numOrNull(raw.promoters),
        passives: numOrNull(raw.passives),
        detractors: numOrNull(raw.detractors),
        totalResponses: numOrNull(raw.totalResponses),
        suppressed: raw.suppressed,
        period: raw.period,
      };
    },
  });
}

/**
 * ORG-rollup: the latest climate survey's per-category heatmap (survey-level min-5 floor).
 * C#-ONLY — the TS tRPC procedure was deleted 2026-07-31. GET /engagement/climate-heatmap
 * (surveyId|null, title, suppressed passed through; data[].score coerced, null-preserving,
 * category order preserved).
 */
export function useEngagementClimateHeatmap() {
  return useQuery<ClimateHeatmapOutput>({
    queryKey: ['platform-api', 'engagement', 'climate-heatmap'],
    queryFn: async () => {
      const raw = await platformGet('/engagement/climate-heatmap');
      return {
        surveyId: raw.surveyId,
        title: raw.title,
        suppressed: raw.suppressed,
        data: raw.data.map((cell) => ({ category: cell.category, score: numOrNull(cell.score) })),
      } as ClimateHeatmapOutput;
    },
  });
}

/**
 * ORG-rollup list: active low-climate alerts (module='engagement'), newest first. C#-ONLY — the
 * TS tRPC procedure was deleted 2026-07-31. GET /engagement/alerts (scalars passed through;
 * dismissedAt/createdAt Date-reconstructed).
 */
export function useEngagementLowClimateAlerts() {
  return useQuery<LowClimateAlertsOutput>({
    queryKey: ['platform-api', 'engagement', 'low-climate-alerts'],
    queryFn: async () => {
      const raw = await platformGet('/engagement/alerts');
      return raw.map((a) => ({
        id: a.id,
        organizationId: a.organizationId,
        ruleId: a.ruleId,
        module: a.module,
        severity: a.severity,
        title: a.title,
        message: a.message,
        metadata: a.metadata as LowClimateAlertsOutput[number]['metadata'],
        status: a.status,
        dismissedById: a.dismissedById,
        dismissedAt: toDateOrNull(a.dismissedAt),
        createdAt: toDate(a.createdAt),
      }));
    },
  });
}

/**
 * ROW-scoped list: action plans within the caller's scope (own/team/unit/org), newest first.
 * C#-ONLY — the TS tRPC procedure was deleted 2026-07-31. GET /engagement/action-plans (scalars
 * passed through; dueDate/createdAt/updatedAt Date-reconstructed; nested `responsible` mapped).
 */
export function useEngagementListActionPlans() {
  return useQuery<ListActionPlansOutput>({
    queryKey: ['platform-api', 'engagement', 'action-plans'],
    queryFn: async () => {
      const raw = await platformGet('/engagement/action-plans');
      return raw.map((p) => ({
        id: p.id,
        organizationId: p.organizationId,
        title: p.title,
        responsibleId: p.responsibleId,
        area: p.area,
        status: p.status,
        dueDate: toDateOrNull(p.dueDate),
        actions: p.actions as ListActionPlansOutput[number]['actions'],
        notes: p.notes,
        createdAt: toDate(p.createdAt),
        updatedAt: toDate(p.updatedAt),
        responsible: {
          id: p.responsible.id,
          firstName: p.responsible.firstName,
          lastName: p.responsible.lastName,
          avatar: p.responsible.avatar,
        },
      }));
    },
  });
}

/**
 * ROW-scoped list: leader commitments within the caller's scope, ordered by due date ascending.
 * C#-ONLY — the TS tRPC procedure was deleted 2026-07-31. GET /engagement/leader-commitments
 * (scalars passed through; dueDate/completedAt/createdAt/updatedAt Date-reconstructed; nested
 * `leader` mapped).
 */
export function useEngagementListLeaderCommitments() {
  return useQuery<ListLeaderCommitmentsOutput>({
    queryKey: ['platform-api', 'engagement', 'leader-commitments'],
    queryFn: async () => {
      const raw = await platformGet('/engagement/leader-commitments');
      return raw.map((c) => ({
        id: c.id,
        organizationId: c.organizationId,
        leaderId: c.leaderId,
        description: c.description,
        status: c.status,
        dueDate: toDateOrNull(c.dueDate),
        completedAt: toDateOrNull(c.completedAt),
        createdAt: toDate(c.createdAt),
        updatedAt: toDate(c.updatedAt),
        leader: {
          id: c.leader.id,
          firstName: c.leader.firstName,
          lastName: c.leader.lastName,
          avatar: c.leader.avatar,
        },
      }));
    },
  });
}

/**
 * ORG-rollup: engagement dashboard KPIs (active surveys, total responses, open action plans, high
 * risk count) — min-5 + cross-endpoint differencing guard live in the shared kernel. C#-ONLY — the
 * TS tRPC procedure was deleted 2026-07-31. GET /engagement/dashboard-kpis (activeSurveys/
 * actionPlansOpen/highRiskCount coerced; totalResponses coerced, null-preserving;
 * totalResponsesSuppressed passed through).
 */
export function useEngagementDashboardKpis() {
  return useQuery<DashboardKpisOutput>({
    queryKey: ['platform-api', 'engagement', 'dashboard-kpis'],
    queryFn: async () => {
      const raw = await platformGet('/engagement/dashboard-kpis');
      return {
        activeSurveys: num(raw.activeSurveys),
        totalResponses: numOrNull(raw.totalResponses),
        totalResponsesSuppressed: raw.totalResponsesSuppressed,
        actionPlansOpen: num(raw.actionPlansOpen),
        highRiskCount: num(raw.highRiskCount),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Writes (Phase-5 Slice 16) — C#-ONLY. All three TS tRPC mutations
// (engagement.createSurvey / activateSurvey / submitSurveyResponse) were deleted on 2026-07-29;
// NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP was confirmed live in prod on 2026-07-28 (value re-read
// directly from Vercel production on 2026-07-29) and is no longer read here — the FE flag is
// retired. It was never listed in .env.example, so there is nothing to retire there. The BACKEND
// flag `Platform:EngagementWriteEnabled` is still real and still gates the C# routes.
//
// Of the 5 C# mutations, only these 3 have live FE consumers — createSurvey + activateSurvey
// (climate/launch-survey-modal.tsx) and submitSurveyResponse (dashboard/survey-take-modal.tsx). A
// full-repo grep still confirms createActionPlan/updateActionPlan have ZERO call sites anywhere
// (same situation as succession's addCriticalRole), so they are intentionally NOT wrapped here —
// and, for the same reason, their TS procedures were deliberately left undeleted.
//
// Each hook keeps trpc's useMutation option shape ({ onSuccess?, onError?, onSettled? }), so both
// call sites are unchanged. MutationOptions stays generic over TData (like ninebox's, unlike
// compensation's void-only) because launch-survey-modal.tsx chains
// `create.onSuccess: (survey) => activate.mutate({ id: survey.id })` off the created survey's id.
//
// The 8 reads above are now ALSO C#-only (2026-07-31 TS-deletion — see the file header), so both
// consumers' `.invalidate()` calls that used to target `utils.engagement.getDashboardKpis`/
// `myPendingSurveys` were repointed to `queryClient.invalidateQueries({ queryKey: ['platform-api',
// 'engagement', …] })` in launch-survey-modal.tsx / survey-take-modal.tsx respectively — the dead
// tRPC cache key would no longer invalidate anything real. `utils.engagement.listSurveys.
// invalidate()` in launch-survey-modal.tsx is UNCHANGED — listSurveys has zero FE query
// consumers and was never a cutover candidate, so its tRPC cache is still the one that matters.
//
// submitSurveyResponse's CONFLICT toast: survey-take-modal.tsx distinguishes the duplicate-response
// case by matching `err.message` against the exact backend text ('Ya respondiste esta encuesta' /
// DuplicateResponseMessage), rather than the tRPC-specific `err.data?.code === 'CONFLICT'` shape the
// C# path can't produce. `PlatformApiError` parses the response body's `message` field (client.ts),
// so this match works correctly — and it is now the ONLY path, which makes that note load-bearing.
// ---------------------------------------------------------------------------

interface MutationOptions<TData = void> {
  onSuccess?: (data: TData) => void;
  onError?: (err: { message: string }) => void;
  onSettled?: () => void;
}

function useCSharpMutation<TInput, TData>(
  mutationFn: (input: TInput) => Promise<TData>,
  options: MutationOptions<TData> | undefined,
) {
  return useMutation({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (err: unknown) => options?.onError?.(err instanceof Error ? err : { message: 'Unknown error' }),
    onSettled: options?.onSettled,
  });
}

// §21 minimal-select: activateSurvey returned `select: { id: true, status: true }`.
interface ActivateSurveyOutput {
  id: string;
  status: string;
}

// §21 minimal-select: submitSurveyResponse returned `select: { id: true, submittedAt: true }` — it
// deliberately never echoed the confidential `answers` JSON back to the respondent.
interface SubmitSurveyResponseOutput {
  id: string;
  submittedAt: Date;
}

// createSurvey called `db.survey.create({ data: … })` with NO select → the full 13-field Survey row.
interface CreateSurveyOutput {
  id: string;
  organizationId: string;
  title: string;
  type: string;
  status: string;
  questions: JsonValue;
  targetGroups: JsonValue | null;
  startsAt: Date | null;
  endsAt: Date | null;
  responseCount: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateSurveyQuestionShape {
  text: string;
  type: string;
  options?: string[];
  required?: boolean;
  category?: string;
}

interface CreateSurveyInputShape {
  title: string;
  type: string;
  questions: CreateSurveyQuestionShape[];
  targetGroups?: { companyIds?: string[]; businessUnitIds?: string[]; teamIds?: string[] };
  startsAt?: string;
  endsAt?: string;
}

/**
 * STAFF: create a survey (1 call site: climate/launch-survey-modal.tsx, which reads `survey.id`
 * from the resolved data to immediately chain into activateSurvey).
 */
export function useEngagementCreateSurvey(options?: MutationOptions<CreateSurveyOutput>) {
  return useCSharpMutation(async (input: CreateSurveyInputShape) => {
    const raw = await platformPost('/engagement/surveys', {
      title: input.title,
      type: input.type,
      questions: input.questions,
      targetGroups: input.targetGroups,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    return {
      id: raw.id,
      organizationId: raw.organizationId,
      title: raw.title,
      type: raw.type,
      status: raw.status,
      questions: raw.questions as CreateSurveyOutput['questions'],
      targetGroups: raw.targetGroups as CreateSurveyOutput['targetGroups'],
      startsAt: toDateOrNull(raw.startsAt),
      endsAt: toDateOrNull(raw.endsAt),
      responseCount: num(raw.responseCount),
      createdById: raw.createdById,
      createdAt: toDate(raw.createdAt),
      updatedAt: toDate(raw.updatedAt),
    } satisfies CreateSurveyOutput;
  }, options);
}

interface ActivateSurveyInputShape {
  id: string;
}

/** STAFF: activate a draft survey (1 call site: climate/launch-survey-modal.tsx). */
export function useEngagementActivateSurvey(options?: MutationOptions<ActivateSurveyOutput>) {
  return useCSharpMutation(async (input: ActivateSurveyInputShape) => {
    const raw = await platformPost('/engagement/surveys/{surveyId}/activate', undefined, {
      surveyId: input.id,
    });
    return { id: raw.id, status: raw.status } satisfies ActivateSurveyOutput;
  }, options);
}

interface SubmitSurveyResponseInputShape {
  surveyId: string;
  answers: Record<string, string | number>;
}

/** SELF-SERVICE: submit answers to a survey (1 call site: dashboard/survey-take-modal.tsx). */
export function useEngagementSubmitSurveyResponse(options?: MutationOptions<SubmitSurveyResponseOutput>) {
  return useCSharpMutation(async (input: SubmitSurveyResponseInputShape) => {
    const raw = await platformPost(
      '/engagement/surveys/{surveyId}/responses',
      // The generated contract types `answers` as `Record<string, never>` (an openapi-typescript
      // fallback artifact for the C# `IReadOnlyDictionary<string, object>` body) — cast through
      // `unknown`, matching the ninebox/dei precedent for widened wire-type casts.
      { answers: input.answers as unknown as Record<string, never> },
      { surveyId: input.surveyId },
    );
    return { id: raw.id, submittedAt: toDate(raw.submittedAt) } satisfies SubmitSurveyResponseOutput;
  }, options);
}
