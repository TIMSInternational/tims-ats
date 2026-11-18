// Pure helpers for "Reprogramar" (Pilot UX re-audit recruiter-journeys-28): interview.reschedule existed with no
// web caller, so recruiters had to cancel and re-create. No React imports → node-testable.

/** Open statuses that can still move. A scored interview is refused by the server (CONFLICT). */
const RESCHEDULABLE_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'rescheduled', 'confirmed']);

export function canRescheduleInterview(iv: { status: string; _count?: { scorecards?: number } | null }): boolean {
  return RESCHEDULABLE_STATUSES.has(iv.status) && (iv._count?.scorecards ?? 0) === 0;
}

/** The wall clock of `at` in `tz` as the date and time inputs expect ("YYYY-MM-DD", "HH:mm"). */
export function wallTimeInZone(at: Date | string, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** The message for a failed reschedule: a scored interview gets the "schedule a new one" explanation. */
export function rescheduleErrorMessage(
  err: { data?: { code?: string } | null; message: string },
  copy: { rescheduleScoredConflict: string },
): string {
  return err.data?.code === 'CONFLICT' ? copy.rescheduleScoredConflict : err.message;
}
