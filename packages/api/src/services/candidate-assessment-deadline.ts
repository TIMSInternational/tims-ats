// A browser countdown fires at (or just after) the deadline. Accepting an
// already-started attempt briefly after that instant lets auto-submit survive
// scheduling and network latency without granting an unbounded late attempt.
export const ASSESSMENT_SUBMISSION_GRACE_MS = 2 * 60_000;

export function isSubmissionWindowClosed(
  expiresAt: Date | null,
  startedAt: Date | null,
  durationMinutes: number | null,
  nowMs = Date.now(),
): boolean {
  const assignmentDeadline = expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const durationDeadline = startedAt !== null && durationMinutes !== null
    ? startedAt.getTime() + durationMinutes * 60_000
    : Number.POSITIVE_INFINITY;
  const deadline = Math.min(assignmentDeadline, durationDeadline);
  return Number.isFinite(deadline) && nowMs > deadline + ASSESSMENT_SUBMISSION_GRACE_MS;
}
