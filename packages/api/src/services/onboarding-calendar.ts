// ---------------------------------------------------------------------------
// Onboarding calendar in the ORGANIZATION's zone (pure)
// ---------------------------------------------------------------------------
// B-23: the phase a hire is in today comes from the start date (onboarding_plans.phase is written once
// and never advances). Days 0-30 / 31-60 / 61+ since the start DAY, both days taken in the organization's
// zone, so the phase tabs (a start-date filter applied before paging) and the badge the list returns
// for each plan always agree, whatever zone the viewer's browser is in. "Overdue" uses the same basis:
// a task due today is not late until tomorrow.

import { UTC_TIME_ZONE, isValidTimeZone, zonedDateString, zonedWallTimeToDate } from '@tims/shared';

const DAY_MS = 86_400_000;

export const START_PHASES = ['day1_30', 'day31_60', 'day61_90'] as const;
export type StartPhase = (typeof START_PHASES)[number];

function zoneOrUtc(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? timeZone : UTC_TIME_ZONE;
}

/** The instant the calendar day containing `at` starts in `timeZone`. */
export function startOfDayIn(timeZone: string | null | undefined, at: Date): Date {
  const zone = zoneOrUtc(timeZone);
  return zonedWallTimeToDate(zonedDateString(zone, 0, at), '00:00', zone) ?? at;
}

/** Whole calendar days from the start day to today (0 on the start day and before it). */
export function onboardingDayIn(timeZone: string | null | undefined, startDate: Date, now: Date = new Date()): number {
  const days = Math.round((startOfDayIn(timeZone, now).getTime() - startOfDayIn(timeZone, startDate).getTime()) / DAY_MS);
  return Math.max(0, days);
}

export function phaseForDay(day: number): StartPhase {
  if (day <= 30) return 'day1_30';
  if (day <= 60) return 'day31_60';
  return 'day61_90';
}

/**
 * The start-date range of a phase tab, from the start of today in the zone. Exactly the plans whose
 * phaseForDay(onboardingDayIn(...)) is `phase`: day <= N ⇔ start >= startOfToday - N days.
 */
export function startDateRangeForPhase(phase: StartPhase, startOfToday: Date): { gte?: Date; lt?: Date } {
  const daysAgo = (n: number) => new Date(startOfToday.getTime() - n * DAY_MS);
  if (phase === 'day1_30') return { gte: daysAgo(30) };
  if (phase === 'day31_60') return { gte: daysAgo(60), lt: daysAgo(30) };
  return { lt: daysAgo(60) };
}
