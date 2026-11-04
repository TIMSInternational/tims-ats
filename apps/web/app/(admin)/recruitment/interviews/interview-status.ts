// Pure helpers for what the interviews list SAYS about an interview (no React imports → node-testable).
//
// The stored status only changes on schedule / reschedule / cancel and when a scorecard is submitted
// (which marks a started interview `completed`, except a video one whose candidate join link is still
// valid). Until then a past interview is still stored as `scheduled`, so the list derives what is honest
// to show: it is under way, it was scored, or it took place and waits for its scorecard — never
// "Programada" with a live "Cancelar" for an interview that already happened.

/** Statuses of an interview that has not been closed (cancelled / no_show) nor scored. */
const OPEN_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'rescheduled', 'confirmed', 'in_progress']);

export type InterviewTiming = {
  status: string;
  scheduledAt: Date | string;
  duration?: number | null;
  /** interview.list: how many evaluators SUBMITTED a scorecard (a count only). */
  _count?: { scorecards?: number } | null;
};

function startMs(iv: InterviewTiming): number {
  return new Date(iv.scheduledAt).getTime();
}

/** True once the scheduled start has passed. */
export function hasInterviewStarted(iv: InterviewTiming, now: Date = new Date()): boolean {
  return startMs(iv) <= now.getTime();
}

/** The status key the list shows: `in_progress` while it runs, `awaiting_scorecard` once it is over. */
export function displayInterviewStatus(iv: InterviewTiming, now: Date = new Date()): string {
  if (!OPEN_STATUSES.has(iv.status) || !hasInterviewStarted(iv, now)) return iv.status;
  const endMs = startMs(iv) + Math.max(0, iv.duration ?? 0) * 60_000;
  if (now.getTime() < endMs) return 'in_progress';
  return (iv._count?.scorecards ?? 0) > 0 ? 'completed' : 'awaiting_scorecard';
}

/** Cancel is offered only for a scheduled interview that has not started: one that already took place
 *  cannot be cancelled. */
export function canCancelInterview(iv: InterviewTiming, now: Date = new Date()): boolean {
  return iv.status === 'scheduled' && !hasInterviewStarted(iv, now);
}

/** "10 nov 2026, 10:00" in the viewer's language; '' when the value is not a date. */
export function formatInterviewWhen(value: Date | string | null | undefined, locale: 'ES' | 'EN'): string {
  if (value === null || value === undefined) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'EN' ? 'en-US' : 'es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
