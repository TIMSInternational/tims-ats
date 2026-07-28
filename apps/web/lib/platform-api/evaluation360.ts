'use client';

// C#-only evaluation360 hooks. The TS tRPC router (packages/api/src/routers/evaluation360.ts)
// has been deleted — NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP and
// NEXT_PUBLIC_EVALUATION360_WRITE_VIA_CSHARP are both true in every environment and there is no
// TS fallback left to route to. Types below are hand-declared (previously derived from
// inferRouterOutputs<AppRouter>) since the router no longer exists to infer from.

import { useMutation, useQuery } from '@tanstack/react-query';
import { EVAL360_COMPETENCIES, type Eval360Competency, type RaterRelationshipValue } from '@tims/shared';
import { platformGet, platformPost } from './client';

// Mirrors the Prisma `ReviewCycleStatus` enum (packages/db/prisma/schema/evaluation360.prisma).
type CycleStatus = 'draft' | 'open' | 'closed' | 'published';

export interface EvaluationCycle {
  id: string;
  name: string;
  status: CycleStatus;
  opensAt: Date | null;
  closesAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface CycleProgressRow {
  relationship: RaterRelationshipValue;
  total: number;
  submitted: number;
}

export interface CycleProgress {
  cycleId: string;
  progress: CycleProgressRow[];
}

export interface RaterTask {
  assignmentId: string;
  cycleId: string;
  cycleName: string;
  relationship: RaterRelationshipValue;
  subject: { firstName: string; lastName: string };
  competencies: readonly Eval360Competency[];
}

export interface ReportBucket {
  relationship: RaterRelationshipValue;
  raterCount: number;
  competencies: Array<{ competencyKey: Eval360Competency; average: number }>;
  comments: string[] | null;
}

export interface MyReport {
  cycleId: string;
  cycleName: string;
  buckets: ReportBucket[];
}

export interface MyReportCycle {
  cycleId: string;
  cycleName: string;
  publishedAt: Date | null;
}

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to the `number` the FE expects.
const num = (v: number | string): number => Number(v);

// DateTime fields serialize as canonical Node-ISO strings, nullable dates as JSON null.
// Reconstruct real Date objects to match the FE's existing Date-object expectations.
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

/**
 * STAFF: the org's review cycles, newest first.
 * GET /evaluation360/cycles (ISO date strings rebuilt into Date objects, status DB-enum string
 * narrowed to CycleStatus).
 */
export function useEvaluation360ListCycles() {
  return useQuery<EvaluationCycle[]>({
    queryKey: ['platform-api', 'evaluation360', 'cycles'],
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
}

/**
 * STAFF: per-relationship submitted/total assignment counts for a cycle (fixed relationship order,
 * every relationship present). An unknown cycle → 404 (isError).
 * GET /evaluation360/cycles/{cycleId}/progress (integer counts coerced to number).
 */
export function useEvaluation360CycleProgress(cycleId: string) {
  return useQuery<CycleProgress>({
    queryKey: ['platform-api', 'evaluation360', 'cycle-progress', cycleId],
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/cycles/{cycleId}/progress', undefined, { cycleId });
      return {
        cycleId: raw.cycleId,
        progress: raw.progress.map((row) => ({
          relationship: row.relationship as RaterRelationshipValue,
          total: num(row.total),
          submitted: num(row.submitted),
        })),
      };
    },
  });
}

/**
 * SELF-SERVICE: the caller's pending rater assignments in open cycles, each with the subject's
 * display name and the fixed 360 competency set.
 * GET /evaluation360/my/rater-tasks. `competencies` returns the shared EVAL360_COMPETENCIES tuple.
 */
export function useEvaluation360MyRaterTasks() {
  return useQuery<RaterTask[]>({
    queryKey: ['platform-api', 'evaluation360', 'my-rater-tasks'],
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/my/rater-tasks');
      return raw.map((task) => ({
        assignmentId: task.assignmentId,
        cycleId: task.cycleId,
        cycleName: task.cycleName,
        relationship: task.relationship as RaterRelationshipValue,
        subject: { firstName: task.subject.firstName, lastName: task.subject.lastName },
        // Fixed, ordered set — returning the shared const preserves the exact readonly-tuple shape.
        competencies: EVAL360_COMPETENCIES,
      }));
    },
  });
}

/**
 * SELF-SERVICE: the caller's anonymized 360 report for one PUBLISHED cycle (buckets are the output
 * of the shared min-3 anonymity kernel; only shown buckets are ever present). A not-published /
 * not-a-subject cycle → 404 (isError).
 * GET /evaluation360/my/reports/{cycleId}. raterCount + per-competency averages coerced to number;
 * comments (null for peer/direct_report, string[] for self/manager) preserved; bucket order kept.
 */
export function useEvaluation360MyReport(cycleId: string) {
  return useQuery<MyReport>({
    queryKey: ['platform-api', 'evaluation360', 'my-report', cycleId],
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/my/reports/{cycleId}', undefined, { cycleId });
      return {
        cycleId: raw.cycleId,
        cycleName: raw.cycleName,
        buckets: raw.buckets.map((bucket) => ({
          relationship: bucket.relationship as RaterRelationshipValue,
          raterCount: num(bucket.raterCount),
          competencies: bucket.competencies.map((c) => ({
            competencyKey: c.competencyKey as Eval360Competency,
            average: num(c.average),
          })),
          comments: bucket.comments,
        })),
      };
    },
  });
}

/**
 * SELF-SERVICE: the PUBLISHED cycles the caller is a subject of (drives the "My Reports" list).
 * GET /evaluation360/my/report-cycles (publishedAt ISO string rebuilt into a Date, preserving null).
 */
export function useEvaluation360MyReportCycles() {
  return useQuery<MyReportCycle[]>({
    queryKey: ['platform-api', 'evaluation360', 'my-report-cycles'],
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/my/report-cycles');
      return raw.map((c) => ({
        cycleId: c.cycleId,
        cycleName: c.cycleName,
        publishedAt: toDateOrNull(c.publishedAt),
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Writes — the TS evaluation360 router (and its trpc mutations) no longer exist; every hook below
// calls the C# service directly. Error messages are byte-identical between stacks (verified
// against Evaluation360WriteEndpoints.cs's message constants), so a shared `err.message` toast
// works unchanged. Consumers already invalidate the `['platform-api','evaluation360',...]` query
// keys themselves post-success (see create-cycle-form.tsx) — this file only supplies the mutation.
// ---------------------------------------------------------------------------

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
  return useCSharpMutation(
    (input: { name: string }) => platformPost('/evaluation360/cycles', { name: input.name }),
    options,
  );
}

/** STAFF: open a cycle (1 call site: cycle-row.tsx). */
export function useEvaluation360OpenCycle(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { cycleId: string }) => platformPost('/evaluation360/cycles/{id}/open', undefined, { id: input.cycleId }),
    options,
  );
}

/** STAFF: close a cycle (1 call site: cycle-row.tsx). */
export function useEvaluation360CloseCycle(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { cycleId: string }) => platformPost('/evaluation360/cycles/{id}/close', undefined, { id: input.cycleId }),
    options,
  );
}

/** STAFF: publish a cycle (1 call site: cycle-row.tsx). */
export function useEvaluation360PublishCycle(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { cycleId: string }) =>
      platformPost('/evaluation360/cycles/{id}/publish', undefined, { id: input.cycleId }),
    options,
  );
}

interface RaterAssignmentInputShape {
  subjectUserId: string;
  raterUserId: string;
  relationship: string;
}

/** STAFF: assign raters to a cycle (1 call site: assign-raters-form.tsx). */
export function useEvaluation360AssignRaters(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { cycleId: string; assignments: RaterAssignmentInputShape[] }) =>
      platformPost('/evaluation360/cycles/{id}/raters', { assignments: input.assignments }, { id: input.cycleId }),
    options,
  );
}

interface RatingInputShape {
  competencyKey: string;
  rating: number;
  comment?: string;
}

/** SELF-SERVICE: submit ratings for a rater assignment (1 call site: rater-task-card.tsx). */
export function useEvaluation360SubmitRatings(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { assignmentId: string; ratings: RatingInputShape[] }) =>
      platformPost('/evaluation360/assignments/{id}/ratings', { ratings: input.ratings }, { id: input.assignmentId }),
    options,
  );
}
