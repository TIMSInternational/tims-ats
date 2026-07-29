'use client';

// Per-surface read gate for the EIGHT FE-consumed engagement reads (myPendingSurveys /
// getSurveyForResponse / getEnps / getClimateHeatmap / getLowClimateAlerts / listActionPlans /
// listLeaderCommitments / getDashboardKpis) — staged to route to the C# Platform service. DARK by
// default: unless BOTH the platform-api base URL and NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP are set
// at deploy time, every hook returns the existing tRPC query unchanged (byte-identical to today).
// Merging changes nothing in prod until Federico flips the flag at cutover.
//
// Mirrors lib/platform-api/{access-review,audit-log,billing,dei}.ts — and compensation.ts's 3
// FX-gated hooks only (its other 7 went C#-only on 2026-07-29) — exactly: each hook calls BOTH
// the tRPC hook (enabled when NOT viaCSharp) and a C# useQuery
// (enabled when viaCSharp), then returns the active one. The C# useQuery is typed to the EXACT
// tRPC output type (inferRouterOutputs), so each mapper below is compile-time-locked to the live
// contract's shape.
//
// SCOPE — the engagement router exposes FOURTEEN reads; only EIGHT are consumed by the FE. The six
// NOT consumed — listSurveys (only ever `.invalidate()`d, never queried), getSurveyResults,
// getResultsByArea, getWordCloud, getSentiment (climate-sidebar.tsx explicitly renders a static
// "unavailable" placeholder instead of calling these two stubs), getRotationRisk — get NO wrapper
// here (they stay on tRPC; there is no call site to route). All fourteen live behind the C#
// `Platform:EngagementReadEnabled` backend flag
// (services/Tims.Platform/src/Tims.Api/Engagement/EngagementReadEndpoints.cs), so the eight
// wrapped here share ONE FE flag mirroring it.
//
// PARITY NOTES (verified per read against engagement.ts + EngagementReadEndpoints.cs):
//   - getSurveyForResponse — both stacks throw/404 on a missing, out-of-window, or cross-org
//     survey (tRPC: `throw new Error(...)`; C#: a clean 404). The wrapper does not special-case
//     this — a missing survey PROPAGATES as a thrown error on either path, matching react-query's
//     error state on both.
//   - getEnps/getClimateHeatmap/getLowClimateAlerts/listActionPlans/listLeaderCommitments all
//     accept OPTIONAL TS-side filters (period/companyId/surveyId/threshold/status/leaderId) that
//     NO live FE call site ever passes (every consumer calls with `{}` or no args) — the C# routes
//     mirror this (their query params are `?never` in the OpenAPI contract for the alerts/dashboard/
//     survey-response paths, or optional-and-unused for enps/heatmap/action-plans/commitments).
//     Matching the ninebox precedent's "wrap only what's actually consumed" principle, these hooks
//     take NO arguments — do not add unused filter params.

import { useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet, platformPost } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type MyPendingSurveysOutput = RouterOutput['engagement']['myPendingSurveys'];
type SurveyForResponseOutput = RouterOutput['engagement']['getSurveyForResponse'];
type EnpsOutput = RouterOutput['engagement']['getEnps'];
type ClimateHeatmapOutput = RouterOutput['engagement']['getClimateHeatmap'];
type LowClimateAlertsOutput = RouterOutput['engagement']['getLowClimateAlerts'];
type ListActionPlansOutput = RouterOutput['engagement']['listActionPlans'];
type ListLeaderCommitmentsOutput = RouterOutput['engagement']['listLeaderCommitments'];
type DashboardKpisOutput = RouterOutput['engagement']['getDashboardKpis'];
type CreateSurveyOutput = RouterOutput['engagement']['createSurvey'];
type ActivateSurveyOutput = RouterOutput['engagement']['activateSurvey'];
type SubmitSurveyResponseOutput = RouterOutput['engagement']['submitSurveyResponse'];

// Second gate: even when the client is enabled, engagement only routes to C# when its own flag is
// exactly 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const ENGAGEMENT_VIA_CSHARP = process.env.NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP === 'true';

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to the `number` the tRPC output declares. Nullable
// numeric fields need the null-preserving variant.
const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null): number | null => (v == null ? null : Number(v));

// DateTime fields serialize as canonical Node-ISO strings (…fffZ) via the shared Node-ISO
// converter. The tRPC output types them as Prisma `Date` (superjson rebuilds real Date objects), so
// the C# path reconstructs Date objects to be byte-identical at cutover. The contract types the raw
// values as `unknown`; parse to Date (or null for nullable date columns).
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

/**
 * SELF-scoped list: the caller's own not-yet-answered active surveys. Gate:
 * `isPlatformApiEnabled() && NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /engagement/my/pending-surveys (id/title/type scalars; startsAt/endsAt Date|null).
 *  - false → trpc.engagement.myPendingSurveys.useQuery() (the DEFAULT).
 */
export function useEngagementMyPendingSurveys() {
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_VIA_CSHARP;

  const trpcQuery = trpc.engagement.myPendingSurveys.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<MyPendingSurveysOutput>({
    queryKey: ['platform-api', 'engagement', 'my-pending-surveys'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * SELF-scoped point-read: the renderable definition of one survey the caller may answer. Gate as
 * above; disabled until a survey is opened (matching the call site's `enabled: !!surveyId`).
 *  - true  → GET /engagement/surveys/{surveyId}/take (id/title/type/questions; a missing,
 *            out-of-window, or cross-org survey 404s — PROPAGATES as a thrown error, matching
 *            tRPC's `throw new Error(...)` on the same case).
 *  - false → trpc.engagement.getSurveyForResponse.useQuery({ surveyId }) (the DEFAULT).
 */
export function useEngagementSurveyForResponse(surveyId: string | null) {
  const enabledId = !!surveyId;
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_VIA_CSHARP;

  const trpcQuery = trpc.engagement.getSurveyForResponse.useQuery(
    { surveyId: surveyId! },
    { enabled: !viaCSharp && enabledId },
  );

  const csharpQuery = useQuery<SurveyForResponseOutput>({
    queryKey: ['platform-api', 'engagement', 'survey-for-response', surveyId],
    enabled: viaCSharp && enabledId,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * ORG-rollup: the single org-wide eNPS score (min-5 suppressed). Gate as above.
 *  - true  → GET /engagement/enps (enps/promoters/passives/detractors/totalResponses coerced,
 *            null-preserving; suppressed/period passed through).
 *  - false → trpc.engagement.getEnps.useQuery({}) (the DEFAULT).
 */
export function useEngagementEnps() {
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_VIA_CSHARP;

  const trpcQuery = trpc.engagement.getEnps.useQuery({}, { enabled: !viaCSharp });

  const csharpQuery = useQuery<EnpsOutput>({
    queryKey: ['platform-api', 'engagement', 'enps'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * ORG-rollup: the latest climate survey's per-category heatmap (survey-level min-5 floor). Gate as
 * above.
 *  - true  → GET /engagement/climate-heatmap (surveyId|null, title, suppressed passed through;
 *            data[].score coerced, null-preserving, category order preserved).
 *  - false → trpc.engagement.getClimateHeatmap.useQuery({}) (the DEFAULT).
 */
export function useEngagementClimateHeatmap() {
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_VIA_CSHARP;

  const trpcQuery = trpc.engagement.getClimateHeatmap.useQuery({}, { enabled: !viaCSharp });

  const csharpQuery = useQuery<ClimateHeatmapOutput>({
    queryKey: ['platform-api', 'engagement', 'climate-heatmap'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * ORG-rollup list: active low-climate alerts (module='engagement'), newest first. Gate as above.
 *  - true  → GET /engagement/alerts (scalars passed through; dismissedAt/createdAt Date-reconstructed).
 *  - false → trpc.engagement.getLowClimateAlerts.useQuery({}) (the DEFAULT).
 */
export function useEngagementLowClimateAlerts() {
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_VIA_CSHARP;

  const trpcQuery = trpc.engagement.getLowClimateAlerts.useQuery({}, { enabled: !viaCSharp });

  const csharpQuery = useQuery<LowClimateAlertsOutput>({
    queryKey: ['platform-api', 'engagement', 'low-climate-alerts'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * ROW-scoped list: action plans within the caller's scope (own/team/unit/org), newest first. Gate
 * as above.
 *  - true  → GET /engagement/action-plans (scalars passed through; dueDate/createdAt/updatedAt
 *            Date-reconstructed; nested `responsible` mapped).
 *  - false → trpc.engagement.listActionPlans.useQuery({}) (the DEFAULT).
 */
export function useEngagementListActionPlans() {
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_VIA_CSHARP;

  const trpcQuery = trpc.engagement.listActionPlans.useQuery({}, { enabled: !viaCSharp });

  const csharpQuery = useQuery<ListActionPlansOutput>({
    queryKey: ['platform-api', 'engagement', 'action-plans'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * ROW-scoped list: leader commitments within the caller's scope, ordered by due date ascending.
 * Gate as above.
 *  - true  → GET /engagement/leader-commitments (scalars passed through; dueDate/completedAt/
 *            createdAt/updatedAt Date-reconstructed; nested `leader` mapped).
 *  - false → trpc.engagement.listLeaderCommitments.useQuery({}) (the DEFAULT).
 */
export function useEngagementListLeaderCommitments() {
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_VIA_CSHARP;

  const trpcQuery = trpc.engagement.listLeaderCommitments.useQuery({}, { enabled: !viaCSharp });

  const csharpQuery = useQuery<ListLeaderCommitmentsOutput>({
    queryKey: ['platform-api', 'engagement', 'leader-commitments'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * ORG-rollup: engagement dashboard KPIs (active surveys, total responses, open action plans, high
 * risk count) — min-5 + cross-endpoint differencing guard live in the shared kernel. Gate as above.
 *  - true  → GET /engagement/dashboard-kpis (activeSurveys/actionPlansOpen/highRiskCount coerced;
 *            totalResponses coerced, null-preserving; totalResponsesSuppressed passed through).
 *  - false → trpc.engagement.getDashboardKpis.useQuery() (the DEFAULT).
 */
export function useEngagementDashboardKpis() {
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_VIA_CSHARP;

  const trpcQuery = trpc.engagement.getDashboardKpis.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<DashboardKpisOutput>({
    queryKey: ['platform-api', 'engagement', 'dashboard-kpis'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

// ---------------------------------------------------------------------------
// Writes (Phase-5 Slice 16) — a SEPARATE flag from the reads above, mirroring backend
// `Platform:EngagementWriteEnabled` (independent of EngagementReadEnabled). Of the 5 C# mutations
// (createSurvey/activateSurvey/submitSurveyResponse/createActionPlan/updateActionPlan), only
// createSurvey + activateSurvey (climate/launch-survey-modal.tsx) and submitSurveyResponse
// (dashboard/survey-take-modal.tsx) have live FE consumers — a full-repo grep confirms
// createActionPlan/updateActionPlan have zero call sites anywhere (same situation as succession's
// addCriticalRole/removeSuccessor/updateSuccessorReadiness), so they are intentionally NOT wrapped
// here. Each hook mirrors trpc's useMutation shape ({ onSuccess?, onError? }); MutationOptions is
// generic over TData (like ninebox's, unlike compensation's void-only) because launch-survey-modal.tsx
// chains `create.onSuccess: (survey) => activate.mutate({ id: survey.id })` off the created survey's id.
//
// submitSurveyResponse's CONFLICT toast: survey-take-modal.tsx distinguishes the duplicate-response
// case by matching `err.message` against the exact backend text ('Ya respondiste esta encuesta' /
// DuplicateResponseMessage — byte-identical on both stacks), rather than the tRPC-specific
// `err.data?.code === 'CONFLICT'` shape the C# path can't produce. `PlatformApiError` now parses the
// response body's `message` field (client.ts), so this match works correctly on either path, not
// just the tRPC default.
// ---------------------------------------------------------------------------

const ENGAGEMENT_WRITE_VIA_CSHARP = process.env.NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP === 'true';

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
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.engagement.createSurvey.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: CreateSurveyInputShape) => {
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
  return viaCSharp ? csharpMutation : trpcMutation;
}

interface ActivateSurveyInputShape {
  id: string;
}

/** STAFF: activate a draft survey (1 call site: climate/launch-survey-modal.tsx). */
export function useEngagementActivateSurvey(options?: MutationOptions<ActivateSurveyOutput>) {
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.engagement.activateSurvey.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: ActivateSurveyInputShape) => {
    const raw = await platformPost('/engagement/surveys/{surveyId}/activate', undefined, {
      surveyId: input.id,
    });
    return { id: raw.id, status: raw.status } satisfies ActivateSurveyOutput;
  }, options);
  return viaCSharp ? csharpMutation : trpcMutation;
}

interface SubmitSurveyResponseInputShape {
  surveyId: string;
  answers: Record<string, string | number>;
}

/** SELF-SERVICE: submit answers to a survey (1 call site: dashboard/survey-take-modal.tsx). */
export function useEngagementSubmitSurveyResponse(options?: MutationOptions<SubmitSurveyResponseOutput>) {
  const viaCSharp = isPlatformApiEnabled() && ENGAGEMENT_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.engagement.submitSurveyResponse.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: SubmitSurveyResponseInputShape) => {
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
  return viaCSharp ? csharpMutation : trpcMutation;
}
