'use client';

// C#-only nine-box reads + the 3 wrapped writes. The TS ninebox tRPC procedures backing these
// hooks (getGrid, getEmployeeDetail, getBenchStrength, getDashboardKpis, listCalibrations,
// getCalibration, myCalibrations, createCalibration, addCalibrationMember,
// removeCalibrationMember) have been DELETED from packages/api/src/routers/ninebox.ts —
// NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP and NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP are both true in
// every environment and there is no TS fallback left to route to. Types below are hand-declared
// (previously derived from inferRouterOutputs<AppRouter>) since the deleted procedures no longer
// exist to infer from; quadrant/status stay `string` (the Prisma columns — NineBoxEvaluation.quadrant,
// CalibrationSession.status, CalibrationMember.status, CalibrationVote.quadrant — are plain String
// with no enum, unlike succession's criticality/readiness).
//
// UPDATE 2026-08-05 (#57): the router itself is now GONE too. Its 6 remaining zero-FE-consumer
// procedures (getAxisBreakdown, getMovementHistory, simulate, getQuadrantPlan,
// submitCalibrationVote, finalizeCalibration) were deleted, and packages/api/src/routers/ninebox.ts
// + ninebox.schemas.ts + ninebox.helpers.ts with them. None of those six ever had a wrapper here,
// so nothing in this file changed — this hook module was already C#-only.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformDelete, platformGet, platformPost, PlatformApiError } from './client';

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to a real `number`.
const num = (v: number | string): number => Number(v);

// DateTime fields serialize as canonical Node-ISO strings (…fffZ) via the shared Node-ISO converter;
// parse to Date (or null for the nullable scheduledAt/completedAt columns).
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

// A quadrant→count distribution ({[key]: number}); map values only, PRESERVING key insertion order
// (the kernel emits first-seen order; Object.entries preserves it).
const mapDistribution = (raw: { [key: string]: number | string }): Record<string, number> =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, num(v)]));

/**
 * True when an error is the nine-box FORBIDDEN case (a narrow-scope committee member reading
 * org-governance data). Only the C# {@link PlatformApiError} shape exists now (status 403) — the
 * tRPC `error.data.code === 'FORBIDDEN'` branch was removed alongside the TS procedures. Takes
 * `unknown` → safe on the union; callers don't need to change.
 */
export function isNineboxForbiddenError(err: unknown): boolean {
  return err instanceof PlatformApiError && err.status === 403;
}

interface NineBoxUserSummary {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  jobTitle: string | null;
}

interface NineBoxEvaluationView {
  id: string;
  organizationId: string;
  userId: string;
  period: string;
  potentialScore: number;
  performanceScore: number;
  quadrant: string;
  confidence: number;
  axisBreakdown: unknown;
  evaluatedAt: Date;
  createdAt: Date;
  user: NineBoxUserSummary;
}

interface GridOutput {
  period: string;
  grid: Record<string, NineBoxEvaluationView[]>;
  totalEvaluations: number;
}

interface EmployeeDetailHistoryRow {
  period: string;
  quadrant: string;
  potentialScore: number;
  performanceScore: number;
  evaluatedAt: Date;
}

interface EmployeeDetailEvaluationView extends Omit<NineBoxEvaluationView, 'user'> {
  user: NineBoxUserSummary & { email: string };
}

interface EmployeeDetailOutput {
  evaluation: EmployeeDetailEvaluationView | null;
  history: EmployeeDetailHistoryRow[];
}

interface BenchStrengthOutput {
  period: string;
  total: number;
  distribution: Record<string, number>;
  highPotentialRatio: number;
  benchStrength: number;
}

interface DashboardKpisOutput {
  period: string;
  totalEvaluations: number;
  calibrationSessions: number;
  activeCalibrations: number;
  distribution: Record<string, number>;
}

interface CalibrationSessionSummary {
  id: string;
  period: string;
  status: string;
  scheduledAt: Date | null;
  createdAt: Date;
  _count: { members: number };
}

type ListCalibrationsOutput = CalibrationSessionSummary[];

interface MyCalibrationSummary {
  id: string;
  period: string;
  status: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  _count: { members: number; votes: number };
}

type MyCalibrationsOutput = MyCalibrationSummary[];

interface CalibrationMemberOut {
  id: string;
  sessionId: string;
  userId: string;
  status: string;
  createdAt: Date;
  user: { id: string; firstName: string; lastName: string; avatar: string | null };
}

interface CalibrationVoteOut {
  id: string;
  sessionId: string;
  evaluatedUserId: string;
  voterId: string;
  quadrant: string;
  justification: string | null;
  createdAt: Date;
  evaluatedUser: { id: string; firstName: string; lastName: string };
  voter: { id: string; firstName: string; lastName: string };
}

interface CalibrationOutput {
  id: string;
  organizationId: string;
  period: string;
  status: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  creator: { id: string; firstName: string; lastName: string };
  members: CalibrationMemberOut[];
  votes: CalibrationVoteOut[];
}

interface CreateCalibrationMemberRow {
  id: string;
  sessionId: string;
  userId: string;
  status: string;
  createdAt: Date;
}

interface CreateCalibrationOutput {
  id: string;
  organizationId: string;
  period: string;
  status: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  members: CreateCalibrationMemberRow[];
}

interface AddCalibrationMemberOutput {
  id: string;
}

interface RemoveCalibrationMemberOutput {
  success: boolean;
}

// Full nine-box evaluation scalars shared by getGrid (grid cells). The user select carries
// jobTitle but NOT email (getEmployeeDetail's user select adds email).
const mapGridEvaluation = (e: {
  id: string;
  organizationId: string;
  userId: string;
  period: string;
  potentialScore: number | string;
  performanceScore: number | string;
  quadrant: string;
  confidence: number | string;
  axisBreakdown: unknown;
  evaluatedAt: unknown;
  createdAt: unknown;
  user: { id: string; firstName: string; lastName: string; avatar: string | null; jobTitle: string | null };
}): NineBoxEvaluationView => ({
  id: e.id,
  organizationId: e.organizationId,
  userId: e.userId,
  period: e.period,
  potentialScore: num(e.potentialScore),
  performanceScore: num(e.performanceScore),
  quadrant: e.quadrant,
  confidence: num(e.confidence),
  axisBreakdown: e.axisBreakdown,
  evaluatedAt: toDate(e.evaluatedAt),
  createdAt: toDate(e.createdAt),
  user: {
    id: e.user.id,
    firstName: e.user.firstName,
    lastName: e.user.lastName,
    avatar: e.user.avatar ?? null,
    jobTitle: e.user.jobTitle ?? null,
  },
});

/**
 * STAFF row-scoped: the nine-box grid (scope-filtered evaluations grouped by grid cell, evaluatedAt-
 * desc order preserved). GET /ninebox/grid?period= (per-cell arrays; scores/confidence coerced;
 * jsonb axis passthrough; evaluatedAt/createdAt Dates rebuilt; key + within-cell order preserved).
 */
export function useNineBoxGrid(period: string) {
  return useQuery<GridOutput>({
    queryKey: ['platform-api', 'ninebox', 'grid', period],
    queryFn: async () => {
      const raw = await platformGet('/ninebox/grid', { period });
      return {
        period: raw.period,
        grid: Object.fromEntries(Object.entries(raw.grid).map(([key, cell]) => [key, cell.map(mapGridEvaluation)])),
        totalEvaluations: num(raw.totalEvaluations),
      };
    },
  });
}

/**
 * STAFF subject-scoped point-read: one employee's current evaluation (nullable) + cross-period
 * history. Disabled until a person is selected (matching the call site's `enabled: !!selectedUserId`).
 * GET /ninebox/employee/{userId}?period= (200 with NULLABLE evaluation — findFirst parity;
 * evaluation user select carries email; history is evaluatedAt-asc).
 */
export function useNineBoxEmployeeDetail(userId: string | null, period: string) {
  return useQuery<EmployeeDetailOutput>({
    queryKey: ['platform-api', 'ninebox', 'employee', userId, period],
    enabled: !!userId,
    queryFn: async () => {
      const raw = await platformGet('/ninebox/employee/{userId}', { period }, { userId: userId! });
      const evaluation: EmployeeDetailEvaluationView | null = raw.evaluation
        ? {
            id: raw.evaluation.id,
            organizationId: raw.evaluation.organizationId,
            userId: raw.evaluation.userId,
            period: raw.evaluation.period,
            potentialScore: num(raw.evaluation.potentialScore),
            performanceScore: num(raw.evaluation.performanceScore),
            quadrant: raw.evaluation.quadrant,
            confidence: num(raw.evaluation.confidence),
            axisBreakdown: raw.evaluation.axisBreakdown,
            evaluatedAt: toDate(raw.evaluation.evaluatedAt),
            createdAt: toDate(raw.evaluation.createdAt),
            user: {
              id: raw.evaluation.user.id,
              firstName: raw.evaluation.user.firstName,
              lastName: raw.evaluation.user.lastName,
              avatar: raw.evaluation.user.avatar ?? null,
              jobTitle: raw.evaluation.user.jobTitle ?? null,
              email: raw.evaluation.user.email,
            },
          }
        : null;
      return {
        evaluation,
        history: raw.history.map(
          (h): EmployeeDetailHistoryRow => ({
            period: h.period,
            quadrant: h.quadrant,
            potentialScore: num(h.potentialScore),
            performanceScore: num(h.performanceScore),
            evaluatedAt: toDate(h.evaluatedAt),
          }),
        ),
      };
    },
  });
}

/**
 * STAFF org-rollup: bench-strength (quadrant distribution + high-potential ratio kernel).
 * GET /ninebox/bench-strength?period= (total/highPotentialRatio/benchStrength coerced;
 * distribution values coerced, key order preserved).
 */
export function useNineBoxBenchStrength(period: string) {
  return useQuery<BenchStrengthOutput>({
    queryKey: ['platform-api', 'ninebox', 'bench-strength', period],
    queryFn: async () => {
      const raw = await platformGet('/ninebox/bench-strength', { period });
      return {
        period: raw.period,
        total: num(raw.total),
        distribution: mapDistribution(raw.distribution),
        highPotentialRatio: num(raw.highPotentialRatio),
        benchStrength: num(raw.benchStrength),
      };
    },
  });
}

/**
 * STAFF org-rollup: nine-box dashboard KPIs (counts + quadrant distribution).
 * GET /ninebox/dashboard-kpis?period= (counts coerced; distribution values coerced, key order preserved).
 */
export function useNineBoxDashboardKpis(period: string) {
  return useQuery<DashboardKpisOutput>({
    queryKey: ['platform-api', 'ninebox', 'dashboard-kpis', period],
    queryFn: async () => {
      const raw = await platformGet('/ninebox/dashboard-kpis', { period });
      return {
        period: raw.period,
        totalEvaluations: num(raw.totalEvaluations),
        calibrationSessions: num(raw.calibrationSessions),
        activeCalibrations: num(raw.activeCalibrations),
        distribution: mapDistribution(raw.distribution),
      };
    },
  });
}

/**
 * ORG-GOVERNANCE list: all calibration sessions (bounded 100, createdAt desc; narrow scope → 403).
 * A 403 propagates as a react-query error; the call site treats it as "no sessions visible" via
 * {@link isNineboxForbiddenError}, so it is NOT retried here. GET /ninebox/calibrations
 * (scheduledAt Date|null; createdAt Date; _count.members coerced).
 */
export function useNineBoxListCalibrations() {
  return useQuery<ListCalibrationsOutput>({
    queryKey: ['platform-api', 'ninebox', 'calibrations'],
    retry: (failureCount, err) => (err instanceof PlatformApiError && err.status === 403 ? false : failureCount < 3),
    queryFn: async () => {
      const raw = await platformGet('/ninebox/calibrations');
      return raw.map((s) => ({
        id: s.id,
        period: s.period,
        status: s.status,
        scheduledAt: toDateOrNull(s.scheduledAt),
        createdAt: toDate(s.createdAt),
        _count: { members: num(s._count.members) },
      }));
    },
  });
}

/**
 * STAFF hand-rolled membership gate: one calibration session (creator + members + votes,
 * deterministically ordered). A missing session → clean 404 which PROPAGATES as a thrown error
 * (findFirstOrThrow parity). GET /ninebox/calibrations/{id}.
 */
export function useNineBoxCalibration(id: string) {
  return useQuery<CalibrationOutput>({
    queryKey: ['platform-api', 'ninebox', 'calibration', id],
    queryFn: async () => {
      const raw = await platformGet('/ninebox/calibrations/{id}', undefined, { id });
      return {
        id: raw.id,
        organizationId: raw.organizationId,
        period: raw.period,
        status: raw.status,
        scheduledAt: toDateOrNull(raw.scheduledAt),
        completedAt: toDateOrNull(raw.completedAt),
        createdById: raw.createdById,
        createdAt: toDate(raw.createdAt),
        updatedAt: toDate(raw.updatedAt),
        creator: {
          id: raw.creator.id,
          firstName: raw.creator.firstName,
          lastName: raw.creator.lastName,
        },
        members: raw.members.map(
          (m): CalibrationMemberOut => ({
            id: m.id,
            sessionId: m.sessionId,
            userId: m.userId,
            status: m.status,
            createdAt: toDate(m.createdAt),
            user: {
              id: m.user.id,
              firstName: m.user.firstName,
              lastName: m.user.lastName,
              avatar: m.user.avatar ?? null,
            },
          }),
        ),
        votes: raw.votes.map(
          (v): CalibrationVoteOut => ({
            id: v.id,
            sessionId: v.sessionId,
            evaluatedUserId: v.evaluatedUserId,
            voterId: v.voterId,
            quadrant: v.quadrant,
            justification: v.justification ?? null,
            createdAt: toDate(v.createdAt),
            evaluatedUser: {
              id: v.evaluatedUser.id,
              firstName: v.evaluatedUser.firstName,
              lastName: v.evaluatedUser.lastName,
            },
            voter: {
              id: v.voter.id,
              firstName: v.voter.firstName,
              lastName: v.voter.lastName,
            },
          }),
        ),
      };
    },
  });
}

/**
 * MEMBER-scoped self list: the caller's OWN calibration sessions (created or a member of).
 * GET /ninebox/my-calibrations (bounded 100, createdAt desc; scheduledAt/completedAt Date|null;
 * createdAt Date; _count.{members,votes} coerced).
 */
export function useNineBoxMyCalibrations() {
  return useQuery<MyCalibrationsOutput>({
    queryKey: ['platform-api', 'ninebox', 'my-calibrations'],
    queryFn: async () => {
      const raw = await platformGet('/ninebox/my-calibrations');
      return raw.map((s) => ({
        id: s.id,
        period: s.period,
        status: s.status,
        scheduledAt: toDateOrNull(s.scheduledAt),
        completedAt: toDateOrNull(s.completedAt),
        createdAt: toDate(s.createdAt),
        _count: { members: num(s._count.members), votes: num(s._count.votes) },
      }));
    },
  });
}

/**
 * Invalidate every C#-routed nine-box read (the `['platform-api','ninebox']` query-key prefix)
 * after a nine-box mutation. Call from a mutation onSuccess; pass the `useQueryClient()` instance.
 */
export function invalidateNineboxPlatformReads(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['platform-api', 'ninebox'] });
}

// ---------------------------------------------------------------------------
// Writes — createCalibration (talent/nine-box/page.tsx) and addCalibrationMember/
// removeCalibrationMember (committee-members-panel.tsx) are the 3 mutations with live FE
// consumers. submitCalibrationVote/finalizeCalibration have zero call sites here; their TS
// implementations were DELETED 2026-08-05 (#57), so C# is the only writer of the three
// calibration_* tables. If a UI for voting/finalizing is ever built, wrap the C# endpoints
// (POST /ninebox/calibrations/{sessionId}/votes, .../finalize) here — there is no TS fallback.
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

interface CreateCalibrationInputShape {
  period: string;
  scheduledAt?: string;
  memberIds?: string[];
}

/**
 * STAFF: start a new calibration session (1 call site: talent/nine-box/page.tsx, which reads
 * `session.id` from the resolved data to auto-open the new session's committee panel).
 * POST /ninebox/calibrations.
 */
export function useNineBoxCreateCalibration(options?: MutationOptions<CreateCalibrationOutput>) {
  return useCSharpMutation(async (input: CreateCalibrationInputShape) => {
    const raw = await platformPost('/ninebox/calibrations', {
      period: input.period,
      scheduledAt: input.scheduledAt,
      memberIds: input.memberIds,
    });
    return {
      id: raw.id,
      organizationId: raw.organizationId,
      period: raw.period,
      status: raw.status,
      scheduledAt: toDateOrNull(raw.scheduledAt),
      completedAt: toDateOrNull(raw.completedAt),
      createdById: raw.createdById,
      createdAt: toDate(raw.createdAt),
      updatedAt: toDate(raw.updatedAt),
      members: raw.members.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        userId: m.userId,
        status: m.status,
        createdAt: toDate(m.createdAt),
      })),
    } satisfies CreateCalibrationOutput;
  }, options);
}

interface AddCalibrationMemberInputShape {
  sessionId: string;
  userId: string;
}

/**
 * STAFF: add a committee member to a calibration session (1 call site: committee-members-panel.tsx).
 * POST /ninebox/calibrations/{sessionId}/members.
 */
export function useNineBoxAddCalibrationMember(options?: MutationOptions<AddCalibrationMemberOutput>) {
  return useCSharpMutation(async (input: AddCalibrationMemberInputShape) => {
    const raw = await platformPost(
      '/ninebox/calibrations/{sessionId}/members',
      { userId: input.userId },
      { sessionId: input.sessionId },
    );
    return { id: raw.id } satisfies AddCalibrationMemberOutput;
  }, options);
}

interface RemoveCalibrationMemberInputShape {
  sessionId: string;
  userId: string;
}

/**
 * STAFF: remove a committee member from a calibration session (1 call site: committee-members-panel.tsx).
 * DELETE /ninebox/calibrations/{sessionId}/members/{userId}.
 */
export function useNineBoxRemoveCalibrationMember(options?: MutationOptions<RemoveCalibrationMemberOutput>) {
  return useCSharpMutation(async (input: RemoveCalibrationMemberInputShape) => {
    const raw = await platformDelete('/ninebox/calibrations/{sessionId}/members/{userId}', {
      sessionId: input.sessionId,
      userId: input.userId,
    });
    return raw satisfies RemoveCalibrationMemberOutput;
  }, options);
}
