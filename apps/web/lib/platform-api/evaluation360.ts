'use client';

// Per-surface read gate for the FIVE evaluation360 reads (listCycles / getCycleProgress /
// myRaterTasks / myReport / myReportCycles) — the fourth read surface staged to route to the
// C# Platform service. DARK by default: unless BOTH env vars are set at deploy time, every hook
// returns the existing tRPC query unchanged (byte-identical to today). Merging changes nothing in
// prod until Federico flips the flag at cutover.
//
// Mirrors lib/platform-api/billing.ts exactly: each hook calls BOTH the tRPC hook (enabled when
// NOT viaCSharp) and a C# useQuery (enabled when viaCSharp), then returns the active one. The C#
// useQuery is typed to the EXACT tRPC output type (inferRouterOutputs), so each mapper below is
// compile-time-locked to the live contract's shape — including the superjson Date semantics on the
// cycle date fields and the fixed EVAL360_COMPETENCIES tuple on rater tasks.
//
// All five live behind the C# `Platform:Evaluation360ReadEnabled` backend flag (verified in
// services/Tims.Platform/src/Tims.Api/Evaluation360/Evaluation360ReadEndpoints.cs — the five GETs
// are mapped by MapEvaluation360ReadEndpoints, gated on Evaluation360ReadEnabled), so they share
// ONE FE flag mirroring that backend flag. The two self-service /my/* endpoints need only a valid
// principal — the client already attaches the Supabase Bearer JWT, so no special handling here.

import { useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { EVAL360_COMPETENCIES } from '@tims/shared';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet, platformPost } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type ListCyclesOutput = RouterOutput['evaluation360']['listCycles'];
type CycleProgressOutput = RouterOutput['evaluation360']['getCycleProgress'];
type MyRaterTasksOutput = RouterOutput['evaluation360']['myRaterTasks'];
type MyReportOutput = RouterOutput['evaluation360']['myReport'];
type MyReportCyclesOutput = RouterOutput['evaluation360']['myReportCycles'];

// Precise nested-shape aliases used to narrow the number-as-string / string DB-enum wire artifacts
// back to the exact unions the tRPC output declares (no `any`; cast a widened wire value to the
// contract type). The C# service only ever emits valid DB enum / competency-key strings.
type CycleStatus = ListCyclesOutput[number]['status'];
type ProgressRelationship = CycleProgressOutput['progress'][number]['relationship'];
type RaterTaskRelationship = MyRaterTasksOutput[number]['relationship'];
type ReportBucket = MyReportOutput['buckets'][number];
type BucketRelationship = ReportBucket['relationship'];
type CompetencyKey = ReportBucket['competencies'][number]['competencyKey'];

// Second gate: even when the client is enabled, evaluation360 only routes to C# when its own flag
// is exactly 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const EVALUATION360_VIA_CSHARP = process.env.NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP === 'true';

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to the `number` the tRPC output declares.
const num = (v: number | string): number => Number(v);

// DateTime fields serialize as canonical Node-ISO strings (…fffZ) via the Node-ISO converter, with
// nullable dates as JSON null. The tRPC output types these as Prisma `Date` (superjson rebuilds
// real Date objects), so the C# path reconstructs Date objects to be byte-identical at cutover.
// The contract types the raw values as `unknown`; narrow null, else parse.
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

/**
 * STAFF: the org's review cycles, newest first. Gate:
 * `isPlatformApiEnabled() && NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /evaluation360/cycles (ISO date strings rebuilt into Date objects, status DB-enum
 *            string narrowed to the Prisma ReviewCycleStatus union).
 *  - false → the existing trpc.evaluation360.listCycles.useQuery() (the DEFAULT).
 */
export function useEvaluation360ListCycles() {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_VIA_CSHARP;

  const trpcQuery = trpc.evaluation360.listCycles.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<ListCyclesOutput>({
    queryKey: ['platform-api', 'evaluation360', 'cycles'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/cycles');
      return raw.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status as CycleStatus,
        opensAt: toDateOrNull(c.opensAt),
        closesAt: toDateOrNull(c.closesAt),
        publishedAt: toDateOrNull(c.publishedAt),
        createdAt: toDate(c.createdAt),
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF: per-relationship submitted/total assignment counts for a cycle (fixed relationship order,
 * every relationship present). Gate as above. An unknown cycle → 404 (isError), mirroring the tRPC
 * NOT_FOUND throw.
 *  - true  → GET /evaluation360/cycles/{cycleId}/progress (integer counts coerced to number).
 *  - false → trpc.evaluation360.getCycleProgress.useQuery({ cycleId }) (the DEFAULT).
 */
export function useEvaluation360CycleProgress(cycleId: string) {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_VIA_CSHARP;

  const trpcQuery = trpc.evaluation360.getCycleProgress.useQuery({ cycleId }, { enabled: !viaCSharp });

  const csharpQuery = useQuery<CycleProgressOutput>({
    queryKey: ['platform-api', 'evaluation360', 'cycle-progress', cycleId],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/cycles/{cycleId}/progress', undefined, { cycleId });
      return {
        cycleId: raw.cycleId,
        progress: raw.progress.map((row) => ({
          relationship: row.relationship as ProgressRelationship,
          total: num(row.total),
          submitted: num(row.submitted),
        })),
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * SELF-SERVICE: the caller's pending rater assignments in open cycles, each with the subject's
 * display name and the fixed 360 competency set. Gate as above.
 *  - true  → GET /evaluation360/my/rater-tasks. `competencies` returns the shared
 *            EVAL360_COMPETENCIES tuple (identical fixed/ordered set the tRPC service attaches),
 *            preserving the exact readonly-tuple output type; relationship DB-enum string narrowed.
 *  - false → trpc.evaluation360.myRaterTasks.useQuery() (the DEFAULT).
 */
export function useEvaluation360MyRaterTasks() {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_VIA_CSHARP;

  const trpcQuery = trpc.evaluation360.myRaterTasks.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<MyRaterTasksOutput>({
    queryKey: ['platform-api', 'evaluation360', 'my-rater-tasks'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/my/rater-tasks');
      return raw.map((task) => ({
        assignmentId: task.assignmentId,
        cycleId: task.cycleId,
        cycleName: task.cycleName,
        relationship: task.relationship as RaterTaskRelationship,
        subject: { firstName: task.subject.firstName, lastName: task.subject.lastName },
        // Fixed, ordered set — identical to the tRPC service's `competencies: EVAL360_COMPETENCIES`.
        // Returning the shared const preserves the exact readonly-tuple output type.
        competencies: EVAL360_COMPETENCIES,
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * SELF-SERVICE: the caller's anonymized 360 report for one PUBLISHED cycle (buckets are the output
 * of the shared min-3 anonymity kernel; only shown buckets are ever present). Gate as above. A
 * not-published / not-a-subject cycle → 404 (isError), mirroring the tRPC NOT_FOUND throw.
 *  - true  → GET /evaluation360/my/reports/{cycleId}. raterCount + per-competency averages coerced
 *            to number; comments (null for peer/direct_report, string[] for self/manager) and
 *            relationship / competencyKey DB-enum strings preserved/narrowed; bucket order kept.
 *  - false → trpc.evaluation360.myReport.useQuery({ cycleId }) (the DEFAULT).
 */
export function useEvaluation360MyReport(cycleId: string) {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_VIA_CSHARP;

  const trpcQuery = trpc.evaluation360.myReport.useQuery({ cycleId }, { enabled: !viaCSharp });

  const csharpQuery = useQuery<MyReportOutput>({
    queryKey: ['platform-api', 'evaluation360', 'my-report', cycleId],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/my/reports/{cycleId}', undefined, { cycleId });
      return {
        cycleId: raw.cycleId,
        cycleName: raw.cycleName,
        buckets: raw.buckets.map((bucket) => ({
          relationship: bucket.relationship as BucketRelationship,
          raterCount: num(bucket.raterCount),
          competencies: bucket.competencies.map((c) => ({
            competencyKey: c.competencyKey as CompetencyKey,
            average: num(c.average),
          })),
          // Preserve the null-vs-array distinction exactly (null ⇒ peer/direct_report; the anonymity
          // rule that comments are never surfaced for those relationships lives server-side).
          comments: bucket.comments,
        })),
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * SELF-SERVICE: the PUBLISHED cycles the caller is a subject of (drives the "My Reports" list).
 * Gate as above.
 *  - true  → GET /evaluation360/my/report-cycles (publishedAt ISO string rebuilt into a Date,
 *            preserving null — matching the tRPC Prisma Date output type).
 *  - false → trpc.evaluation360.myReportCycles.useQuery() (the DEFAULT).
 */
export function useEvaluation360MyReportCycles() {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_VIA_CSHARP;

  const trpcQuery = trpc.evaluation360.myReportCycles.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<MyReportCyclesOutput>({
    queryKey: ['platform-api', 'evaluation360', 'my-report-cycles'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/my/report-cycles');
      return raw.map((c) => ({
        cycleId: c.cycleId,
        cycleName: c.cycleName,
        publishedAt: toDateOrNull(c.publishedAt),
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

// ---------------------------------------------------------------------------
// Writes (Phase-5 Slice 13) — a SEPARATE flag from the reads above, mirroring backend
// `Platform:Evaluation360WriteEnabled` (independent of Evaluation360ReadEnabled). Each hook
// mirrors trpc's useMutation shape ({ onSuccess?, onError? }) so existing call sites swap in
// with a one-line change; consumers already invalidate the `['platform-api','evaluation360',...]`
// query keys themselves post-success (see create-cycle-form.tsx) — this file only supplies the
// mutation itself. Error messages are byte-identical between stacks (verified against
// Evaluation360WriteEndpoints.cs's message constants), so a shared `err.message` toast works on
// either path unchanged.
// ---------------------------------------------------------------------------

const EVALUATION360_WRITE_VIA_CSHARP = process.env.NEXT_PUBLIC_EVALUATION360_WRITE_VIA_CSHARP === 'true';

interface MutationOptions {
  onSuccess?: () => void;
  onError?: (err: { message: string }) => void;
  onSettled?: () => void;
}

function useCSharpMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
  options: MutationOptions | undefined,
) {
  return useMutation({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (err: unknown) => options?.onError?.(err instanceof Error ? err : { message: 'Unknown error' }),
    onSettled: options?.onSettled,
  });
}

/** STAFF: create a cycle (1 call site: create-cycle-form.tsx). */
export function useEvaluation360CreateCycle(options?: MutationOptions) {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.evaluation360.createCycle.useMutation(options);
  const csharpMutation = useCSharpMutation(
    (input: { name: string }) => platformPost('/evaluation360/cycles', { name: input.name }),
    options,
  );
  return viaCSharp ? csharpMutation : trpcMutation;
}

/** STAFF: open a cycle (1 call site: cycle-row.tsx). */
export function useEvaluation360OpenCycle(options?: MutationOptions) {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.evaluation360.openCycle.useMutation(options);
  const csharpMutation = useCSharpMutation(
    (input: { cycleId: string }) => platformPost('/evaluation360/cycles/{id}/open', undefined, { id: input.cycleId }),
    options,
  );
  return viaCSharp ? csharpMutation : trpcMutation;
}

/** STAFF: close a cycle (1 call site: cycle-row.tsx). */
export function useEvaluation360CloseCycle(options?: MutationOptions) {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.evaluation360.closeCycle.useMutation(options);
  const csharpMutation = useCSharpMutation(
    (input: { cycleId: string }) => platformPost('/evaluation360/cycles/{id}/close', undefined, { id: input.cycleId }),
    options,
  );
  return viaCSharp ? csharpMutation : trpcMutation;
}

/** STAFF: publish a cycle (1 call site: cycle-row.tsx). */
export function useEvaluation360PublishCycle(options?: MutationOptions) {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.evaluation360.publishCycle.useMutation(options);
  const csharpMutation = useCSharpMutation(
    (input: { cycleId: string }) =>
      platformPost('/evaluation360/cycles/{id}/publish', undefined, { id: input.cycleId }),
    options,
  );
  return viaCSharp ? csharpMutation : trpcMutation;
}

interface RaterAssignmentInputShape {
  subjectUserId: string;
  raterUserId: string;
  relationship: string;
}

/** STAFF: assign raters to a cycle (1 call site: assign-raters-form.tsx). */
export function useEvaluation360AssignRaters(options?: MutationOptions) {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.evaluation360.assignRaters.useMutation(options);
  const csharpMutation = useCSharpMutation(
    (input: { cycleId: string; assignments: RaterAssignmentInputShape[] }) =>
      platformPost('/evaluation360/cycles/{id}/raters', { assignments: input.assignments }, { id: input.cycleId }),
    options,
  );
  return viaCSharp ? csharpMutation : trpcMutation;
}

interface RatingInputShape {
  competencyKey: string;
  rating: number;
  comment?: string;
}

/** SELF-SERVICE: submit ratings for a rater assignment (1 call site: rater-task-card.tsx). */
export function useEvaluation360SubmitRatings(options?: MutationOptions) {
  const viaCSharp = isPlatformApiEnabled() && EVALUATION360_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.evaluation360.submitRatings.useMutation(options);
  const csharpMutation = useCSharpMutation(
    (input: { assignmentId: string; ratings: RatingInputShape[] }) =>
      platformPost('/evaluation360/assignments/{id}/ratings', { ratings: input.ratings }, { id: input.assignmentId }),
    options,
  );
  return viaCSharp ? csharpMutation : trpcMutation;
}
