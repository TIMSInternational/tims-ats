// Onboarding dates for the HR page, "Mi Onboarding" and the employee home card (B-23 / B-24 / B-25).
//
// - The PHASE shown is derived from the start date at render time. `onboarding_plans.phase` is written
//   once at creation and nothing advances it, so a hire on day 45 used to sit under "Día 1-30".
// - "Overdue" is a calendar notion: due dates are stored at local noon (start date + N days), so a task is
//   overdue from the day AFTER its due day, in the viewer's own calendar.
// Pure functions (no React), so they are unit-tested directly.

export type OnboardingPhase = 'day1_30' | 'day31_60' | 'day61_90';

const DAY_MS = 86_400_000;

function toDate(value: Date | string): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days since the start date (0 on the start day and before it). */
export function onboardingDay(startDate: Date | string, now: Date = new Date()): number {
  const start = toDate(startDate);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.round((startOfLocalDay(now) - startOfLocalDay(start)) / DAY_MS));
}

/** The phase a plan is in today: days 0–30, 31–60, then 61 onwards (same bands as the default checklist). */
export function derivedOnboardingPhase(startDate: Date | string, now: Date = new Date()): OnboardingPhase {
  const day = onboardingDay(startDate, now);
  if (day <= 30) return 'day1_30';
  if (day <= 60) return 'day31_60';
  return 'day61_90';
}

/** True when the due day is before today (never for a missing or invalid date). */
export function isPastDue(dueDate: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  const due = toDate(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return startOfLocalDay(due) < startOfLocalDay(now);
}

/** True for an incomplete task whose due day has passed. */
export function isTaskOverdue(
  task: { completed: boolean; dueDate?: Date | string | null },
  now: Date = new Date(),
): boolean {
  return !task.completed && isPastDue(task.dueDate, now);
}

/** Earliest due date first; tasks without a due date last; stable for equal dates. */
export function sortByDueDate<T extends { dueDate?: Date | string | null }>(tasks: readonly T[]): T[] {
  const time = (task: T): number => {
    if (!task.dueDate) return Number.POSITIVE_INFINITY;
    const t = toDate(task.dueDate).getTime();
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => time(a.task) - time(b.task) || a.index - b.index)
    .map(({ task }) => task);
}

/** The next `count` open tasks, earliest due first. */
export function nextOpenTasks<T extends { completed: boolean; dueDate?: Date | string | null }>(
  tasks: readonly T[],
  count: number,
): T[] {
  return sortByDueDate(tasks.filter((task) => !task.completed)).slice(0, count);
}

/** "05 nov" / "Nov 05" — short calendar date for task due chips. */
export function formatDueDate(value: Date | string, locale: 'ES' | 'EN' | string): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es-CR', { day: '2-digit', month: 'short' }).format(date);
}
