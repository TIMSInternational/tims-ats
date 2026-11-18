import type { Prisma } from '@tims/db';

// The interview list's status filter, in the terms the list SHOWS (apps/web …/interviews/interview-status.ts
// → displayInterviewStatus). The stored status only moves on schedule / reschedule / cancel / no-show and
// when a scorecard completes the interview, so a started interview is often still stored open:
//   - open + not started            → shown as stored ("Programada", "Reprogramada", …)
//   - open + started + scored       → shown "Completada"
//   - open + started + not scored   → shown "En curso" while it runs, then "Realizada · pendiente de evaluación"
//   - closed (completed / cancelled / no_show) → shown as stored
// Each value the list offers returns exactly the rows it badges that way (A-02 / B-30).

/** Not closed and not completed: the interview is still to happen, is being held, or awaits its card. */
export const OPEN_INTERVIEW_STATUSES: readonly string[] = ['scheduled', 'rescheduled', 'confirmed', 'in_progress'];

/** Filter value for the rows badged "En curso" or "Realizada · pendiente de evaluación". */
export const STARTED_UNSCORED_FILTER = 'awaiting_scorecard';

export function interviewStatusFilterWhere(status: string | undefined, now: Date): Prisma.InterviewWhereInput {
  if (!status) return {};
  const isOpen: Prisma.InterviewWhereInput = { status: { in: [...OPEN_INTERVIEW_STATUSES] } };
  const started: Prisma.InterviewWhereInput = { scheduledAt: { lte: now } };
  const submitted = { submittedAt: { not: null } };

  if (status === 'completed') {
    return { OR: [{ status: 'completed' }, { AND: [isOpen, started, { scorecards: { some: submitted } }] }] };
  }
  // The rows badged "En curso" or "Realizada · pendiente de evaluación": started, open, nobody scored — plus
  // a stored in_progress not yet started, which is badged as stored. Whether a started interview is still
  // RUNNING depends on its own duration, which a Prisma where cannot add to scheduledAt, so the legacy
  // 'in_progress' value (no longer offered by the list) answers with this same set.
  if (status === STARTED_UNSCORED_FILTER || status === 'in_progress') {
    return {
      OR: [
        { AND: [isOpen, started, { scorecards: { none: submitted } }] },
        { AND: [{ status: 'in_progress' }, { scheduledAt: { gt: now } }] },
      ],
    };
  }
  // "Programada" / "Reprogramada" / "Confirmada": only interviews that have not started yet.
  if (OPEN_INTERVIEW_STATUSES.includes(status)) return { AND: [{ status }, { scheduledAt: { gt: now } }] };
  return { status };
}
