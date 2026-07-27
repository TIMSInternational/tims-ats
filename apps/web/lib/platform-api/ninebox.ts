'use client';

// Per-surface read gate for the SEVEN FE-consumed nine-box reads (getGrid /
// getEmployeeDetail / getBenchStrength / getDashboardKpis / listCalibrations / getCalibration /
// myCalibrations) — the seventh read surface staged to route to the C# Platform service. DARK by
// default: unless BOTH the platform-api base URL and NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP are set at
// deploy time, every hook returns the existing tRPC query unchanged (byte-identical to today).
// Merging changes nothing in prod until Federico flips the flag at cutover.
//
// Mirrors lib/platform-api/{reporting,billing,evaluation360,succession,compensation}.ts exactly:
// each hook calls BOTH the tRPC hook (enabled when NOT viaCSharp) and a C# useQuery (enabled when
// viaCSharp), then returns the active one. The C# useQuery is typed to the EXACT tRPC output type
// (inferRouterOutputs), so each mapper below is compile-time-locked to the live contract's shape —
// including the superjson Date semantics on the evaluation/calibration date fields, the jsonb
// `axisBreakdown` passthrough, and the number-as-string wire artifacts.
//
// SCOPE — the nine-box router exposes ELEVEN reads; only SEVEN are consumed by the FE (the three
// call sites: talent/nine-box/page.tsx, talent/nine-box/committee-members-panel.tsx,
// dashboard/committee-tasks-dashboard.tsx). The four NOT consumed by the FE — getMovementHistory,
// getAxisBreakdown, simulate, getQuadrantPlan — get NO wrapper here (they stay on tRPC; there is no
// call site to route). All eleven live behind the C# `Platform:NineBoxReadEnabled` backend flag
// (services/Tims.Platform/src/Tims.Api/NineBox/NineBoxReadEndpoints.cs), so the seven wrapped here
// share ONE FE flag mirroring it.
//
// MISSING-RECORD PARITY (verified per read against ninebox.ts + NineBoxReadEndpoints.cs):
//   - getEmployeeDetail — tRPC uses `findFirst` (returns null, NOT a throw); the C# route ALWAYS
//     returns 200 with a NULLABLE `evaluation` (EmployeeDetailView.Evaluation is `EmployeeDetail
//     Evaluation?`). No 404 is emitted for this read, so the wrapper just maps through, PRESERVING
//     `evaluation: null` (the empty state the page renders as "select an employee"). No throw.
//   - getCalibration — tRPC uses `findFirstOrThrow` (a missing session THROWS NOT_FOUND → the panel
//     renders its error branch); the C# route returns a clean 404 for the same case. Its tRPC output
//     type is NON-nullable, so returning null is impossible — the wrapper lets the 404 PROPAGATE as a
//     thrown PlatformApiError (react-query error state), matching tRPC's throw-on-missing exactly.
//   - getAxisBreakdown is the only OTHER 404-emitting read, and it is NOT FE-consumed (skipped).
//
// FORBIDDEN PARITY (listCalibrations): the tRPC read is org-governance — narrow-scope committee
// members reach the page but get FORBIDDEN. The page deliberately treats that as "no sessions
// visible" (empty state, never a crash). The C# route returns 403 for the same case. `isNineboxForbid
// denError` normalizes BOTH error shapes (tRPC `error.data.code === 'FORBIDDEN'` and PlatformApi
// Error status 403) so the call site's forbidden-as-empty rendering is identical on either path.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformDelete, platformGet, platformPost, PlatformApiError } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type GridOutput = RouterOutput['ninebox']['getGrid'];
type EmployeeDetailOutput = RouterOutput['ninebox']['getEmployeeDetail'];
type BenchStrengthOutput = RouterOutput['ninebox']['getBenchStrength'];
type DashboardKpisOutput = RouterOutput['ninebox']['getDashboardKpis'];
type ListCalibrationsOutput = RouterOutput['ninebox']['listCalibrations'];
type CalibrationOutput = RouterOutput['ninebox']['getCalibration'];
type MyCalibrationsOutput = RouterOutput['ninebox']['myCalibrations'];
type CreateCalibrationOutput = RouterOutput['ninebox']['createCalibration'];
type AddCalibrationMemberOutput = RouterOutput['ninebox']['addCalibrationMember'];
type RemoveCalibrationMemberOutput = RouterOutput['ninebox']['removeCalibrationMember'];

// Nested-shape aliases so each mapper is narrowed to the EXACT sub-object the tRPC output declares
// (no `any`; the jsonb `axisBreakdown` widened wire value is cast to the contract's JsonValue).
type GridEvalOut = GridOutput['grid'][string][number];
type EmployeeDetailEvalOut = NonNullable<EmployeeDetailOutput['evaluation']>;
type EmployeeHistoryOut = EmployeeDetailOutput['history'][number];
type CalibrationMemberOut = CalibrationOutput['members'][number];
type CalibrationVoteOut = CalibrationOutput['votes'][number];

// Second gate: even when the client is enabled, nine-box only routes to C# when its own flag is
// exactly 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const NINEBOX_VIA_CSHARP = process.env.NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP === 'true';

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to the `number` the tRPC output declares.
const num = (v: number | string): number => Number(v);

// DateTime fields serialize as canonical Node-ISO strings (…fffZ) via the shared Node-ISO converter.
// The tRPC output types them as Prisma `Date` (superjson rebuilds real Date objects), so the C# path
// reconstructs Date objects to be byte-identical at cutover. The contract types the raw values as
// `unknown`; parse to Date (or null for the nullable scheduledAt/completedAt columns).
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

// A quadrant→count distribution ({[key]: number}); map values only, PRESERVING key insertion order
// (the kernel emits first-seen order; Object.entries preserves it).
const mapDistribution = (raw: { [key: string]: number | string }): Record<string, number> =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, num(v)]));

/**
 * True when an error is the nine-box FORBIDDEN case, normalized across BOTH read paths: the tRPC
 * client error (`error.data.code === 'FORBIDDEN'`) and the C# {@link PlatformApiError} (status 403).
 * The nine-box page uses it so a narrow-scope committee member's listCalibrations 403 renders as an
 * empty session list (never an error card) on either path. Takes `unknown` → safe on the union.
 */
export function isNineboxForbiddenError(err: unknown): boolean {
  if (err instanceof PlatformApiError) return err.status === 403;
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { code?: string } | null }).data;
    return data?.code === 'FORBIDDEN';
  }
  return false;
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
}): GridEvalOut => ({
  id: e.id,
  organizationId: e.organizationId,
  userId: e.userId,
  period: e.period,
  potentialScore: num(e.potentialScore),
  performanceScore: num(e.performanceScore),
  quadrant: e.quadrant,
  confidence: num(e.confidence),
  // jsonb passthrough: the contract widens the column to `unknown`; narrow it back to the exact
  // Prisma JsonValue the tRPC output declares (no `null` injection — the column is a real value).
  axisBreakdown: e.axisBreakdown as GridEvalOut['axisBreakdown'],
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
 * desc order preserved). Gate: `isPlatformApiEnabled() && NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /ninebox/grid?period= (per-cell arrays; scores/confidence coerced; jsonb axis passthrough;
 *            evaluatedAt/createdAt Dates rebuilt; key + within-cell order preserved verbatim).
 *  - false → trpc.ninebox.getGrid.useQuery({ period }) (the DEFAULT).
 */
export function useNineBoxGrid(period: string) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.getGrid.useQuery({ period }, { enabled: !viaCSharp });

  const csharpQuery = useQuery<GridOutput>({
    queryKey: ['platform-api', 'ninebox', 'grid', period],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/ninebox/grid', { period });
      return {
        period: raw.period,
        grid: Object.fromEntries(Object.entries(raw.grid).map(([key, cell]) => [key, cell.map(mapGridEvaluation)])),
        totalEvaluations: num(raw.totalEvaluations),
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF subject-scoped point-read: one employee's current evaluation (nullable) + cross-period
 * history. Gate as above; disabled until a person is selected (matching the call site's
 * `enabled: !!selectedUserId`).
 *  - true  → GET /ninebox/employee/{userId}?period= (200 with NULLABLE evaluation — findFirst parity;
 *            evaluation user select carries email; history is evaluatedAt-asc).
 *  - false → trpc.ninebox.getEmployeeDetail.useQuery({ userId, period }) (the DEFAULT).
 */
export function useNineBoxEmployeeDetail(userId: string | null, period: string) {
  const enabledId = !!userId;
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.getEmployeeDetail.useQuery(
    { userId: userId!, period },
    { enabled: !viaCSharp && enabledId },
  );

  const csharpQuery = useQuery<EmployeeDetailOutput>({
    queryKey: ['platform-api', 'ninebox', 'employee', userId, period],
    enabled: viaCSharp && enabledId,
    queryFn: async () => {
      const raw = await platformGet('/ninebox/employee/{userId}', { period }, { userId: userId! });
      const evaluation: EmployeeDetailEvalOut | null = raw.evaluation
        ? {
            id: raw.evaluation.id,
            organizationId: raw.evaluation.organizationId,
            userId: raw.evaluation.userId,
            period: raw.evaluation.period,
            potentialScore: num(raw.evaluation.potentialScore),
            performanceScore: num(raw.evaluation.performanceScore),
            quadrant: raw.evaluation.quadrant,
            confidence: num(raw.evaluation.confidence),
            axisBreakdown: raw.evaluation.axisBreakdown as EmployeeDetailEvalOut['axisBreakdown'],
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
          (h): EmployeeHistoryOut => ({
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF org-rollup: bench-strength (quadrant distribution + high-potential ratio kernel). Gate as
 * above.
 *  - true  → GET /ninebox/bench-strength?period= (total/highPotentialRatio/benchStrength coerced;
 *            distribution values coerced, key order preserved).
 *  - false → trpc.ninebox.getBenchStrength.useQuery({ period }) (the DEFAULT).
 */
export function useNineBoxBenchStrength(period: string) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.getBenchStrength.useQuery({ period }, { enabled: !viaCSharp });

  const csharpQuery = useQuery<BenchStrengthOutput>({
    queryKey: ['platform-api', 'ninebox', 'bench-strength', period],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF org-rollup: nine-box dashboard KPIs (counts + quadrant distribution). Gate as above.
 *  - true  → GET /ninebox/dashboard-kpis?period= (counts coerced; distribution values coerced,
 *            key order preserved).
 *  - false → trpc.ninebox.getDashboardKpis.useQuery({ period }) (the DEFAULT).
 */
export function useNineBoxDashboardKpis(period: string) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.getDashboardKpis.useQuery({ period }, { enabled: !viaCSharp });

  const csharpQuery = useQuery<DashboardKpisOutput>({
    queryKey: ['platform-api', 'ninebox', 'dashboard-kpis', period],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * ORG-GOVERNANCE list: all calibration sessions (bounded 100, createdAt desc; narrow scope → 403).
 * Gate as above. A 403 propagates as a react-query error on BOTH paths; the call site treats it as
 * "no sessions visible" via {@link isNineboxForbiddenError}, so the 403 is NOT retried here.
 *  - true  → GET /ninebox/calibrations (scheduledAt Date|null; createdAt Date; _count.members coerced).
 *  - false → trpc.ninebox.listCalibrations.useQuery() (the DEFAULT), retry-disabled on FORBIDDEN.
 */
export function useNineBoxListCalibrations() {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.listCalibrations.useQuery(undefined, {
    enabled: !viaCSharp,
    retry: (failureCount, err) => (err.data?.code === 'FORBIDDEN' ? false : failureCount < 3),
  });

  const csharpQuery = useQuery<ListCalibrationsOutput>({
    queryKey: ['platform-api', 'ninebox', 'calibrations'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF hand-rolled membership gate: one calibration session (creator + members + votes,
 * deterministically ordered). Gate as above.
 *  - true  → GET /ninebox/calibrations/{id} (scalars + Dates; members/votes ordered by C#; a missing
 *            session → clean 404 which PROPAGATES as a thrown error — findFirstOrThrow parity).
 *  - false → trpc.ninebox.getCalibration.useQuery({ id }) (the DEFAULT).
 */
export function useNineBoxCalibration(id: string) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.getCalibration.useQuery({ id }, { enabled: !viaCSharp });

  const csharpQuery = useQuery<CalibrationOutput>({
    queryKey: ['platform-api', 'ninebox', 'calibration', id],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * MEMBER-scoped self list: the caller's OWN calibration sessions (created or a member of). Gate as
 * above.
 *  - true  → GET /ninebox/my-calibrations (bounded 100, createdAt desc; scheduledAt/completedAt
 *            Date|null; createdAt Date; _count.{members,votes} coerced).
 *  - false → trpc.ninebox.myCalibrations.useQuery() (the DEFAULT).
 */
export function useNineBoxMyCalibrations() {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_VIA_CSHARP;

  const trpcQuery = trpc.ninebox.myCalibrations.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<MyCalibrationsOutput>({
    queryKey: ['platform-api', 'ninebox', 'my-calibrations'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Invalidate every C#-routed nine-box read (the `['platform-api','ninebox']` query-key prefix) after
 * a nine-box mutation, so the C# path refreshes exactly like `utils.ninebox.*.invalidate()` refreshes
 * the tRPC path. No-op under tRPC (nothing is cached at that prefix). Call from a mutation onSuccess
 * alongside the existing tRPC invalidations; pass the `useQueryClient()` instance.
 */
export function invalidateNineboxPlatformReads(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['platform-api', 'ninebox'] });
}

// ---------------------------------------------------------------------------
// Writes (Phase-5 Slice 15) — a SEPARATE flag from the reads above, mirroring backend
// `Platform:NineBoxWriteEnabled` (independent of NineBoxReadEnabled). Of the 5 C# mutations
// (createCalibration/submitCalibrationVote/addCalibrationMember/removeCalibrationMember/
// finalizeCalibration), only createCalibration (talent/nine-box/page.tsx) and
// addCalibrationMember/removeCalibrationMember (committee-members-panel.tsx) have live FE
// consumers — a full-repo grep confirms submitCalibrationVote/finalizeCalibration have zero call
// sites anywhere (same situation as succession's addCriticalRole/removeSuccessor/
// updateSuccessorReadiness), so they are intentionally NOT wrapped here. Each hook mirrors trpc's
// useMutation shape ({ onSuccess?, onError? }) so existing call sites swap in with a one-line
// change; both consumers already invalidate via `invalidateNineboxPlatformReads` post-success —
// this file only supplies the mutation itself. Error messages are byte-identical between stacks
// (verified against NineBoxWriteEndpoints.cs's message constants and the TS router's inline
// messages), including the addCalibrationMember 409 duplicate-member conflict (unlike succession's
// addSuccessor, both stacks here already throw a friendly 409/CONFLICT with the same message).
// ---------------------------------------------------------------------------

const NINEBOX_WRITE_VIA_CSHARP = process.env.NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP === 'true';

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
 */
export function useNineBoxCreateCalibration(options?: MutationOptions<CreateCalibrationOutput>) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.ninebox.createCalibration.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: CreateCalibrationInputShape) => {
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
  return viaCSharp ? csharpMutation : trpcMutation;
}

interface AddCalibrationMemberInputShape {
  sessionId: string;
  userId: string;
}

/** STAFF: add a committee member to a calibration session (1 call site: committee-members-panel.tsx). */
export function useNineBoxAddCalibrationMember(options?: MutationOptions<AddCalibrationMemberOutput>) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.ninebox.addCalibrationMember.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: AddCalibrationMemberInputShape) => {
    const raw = await platformPost(
      '/ninebox/calibrations/{sessionId}/members',
      { userId: input.userId },
      { sessionId: input.sessionId },
    );
    return { id: raw.id } satisfies AddCalibrationMemberOutput;
  }, options);
  return viaCSharp ? csharpMutation : trpcMutation;
}

interface RemoveCalibrationMemberInputShape {
  sessionId: string;
  userId: string;
}

/** STAFF: remove a committee member from a calibration session (1 call site: committee-members-panel.tsx). */
export function useNineBoxRemoveCalibrationMember(options?: MutationOptions<RemoveCalibrationMemberOutput>) {
  const viaCSharp = isPlatformApiEnabled() && NINEBOX_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.ninebox.removeCalibrationMember.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: RemoveCalibrationMemberInputShape) => {
    const raw = await platformDelete('/ninebox/calibrations/{sessionId}/members/{userId}', {
      sessionId: input.sessionId,
      userId: input.userId,
    });
    return raw satisfies RemoveCalibrationMemberOutput;
  }, options);
  return viaCSharp ? csharpMutation : trpcMutation;
}
