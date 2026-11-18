import { describe, expect, it } from 'vitest';
import {
  derivedOnboardingPhase,
  isPastDue,
  isTaskOverdue,
  nextOpenTasks,
  onboardingDay,
  sortByDueDate,
} from '../../apps/web/lib/onboarding-schedule';

// B-23 / B-24 / B-25: the phase shown comes from the start date (the stored phase never advances) and a
// task is overdue from the day AFTER its due day. Dates are built in local time like the browser does.
const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

describe('onboarding schedule helpers', () => {
  it('counts calendar days from the start date, never negative', () => {
    expect(onboardingDay(day(2026, 11, 3), day(2026, 11, 3, 23))).toBe(0);
    expect(onboardingDay(day(2026, 11, 3), day(2026, 11, 4, 1))).toBe(1);
    expect(onboardingDay(day(2026, 11, 10), day(2026, 11, 3))).toBe(0);
    expect(onboardingDay('not a date', day(2026, 11, 3))).toBe(0);
  });

  it('derives the phase a hire is in today, whatever was stored at creation', () => {
    const start = day(2026, 9, 1);
    expect(derivedOnboardingPhase(start, day(2026, 9, 20))).toBe('day1_30');
    expect(derivedOnboardingPhase(start, day(2026, 10, 1))).toBe('day1_30'); // day 30
    expect(derivedOnboardingPhase(start, day(2026, 10, 16))).toBe('day31_60'); // day 45
    expect(derivedOnboardingPhase(start, day(2026, 11, 20))).toBe('day61_90');
  });

  it('is overdue only after the due day, and never for a done task or a missing date', () => {
    const due = day(2026, 11, 5);
    expect(isPastDue(due, day(2026, 11, 5, 23))).toBe(false);
    expect(isPastDue(due, day(2026, 11, 6, 0))).toBe(true);
    expect(isPastDue(null, day(2026, 11, 6))).toBe(false);
    expect(isTaskOverdue({ completed: true, dueDate: due }, day(2026, 12, 1))).toBe(false);
    expect(isTaskOverdue({ completed: false, dueDate: due }, day(2026, 12, 1))).toBe(true);
  });

  it('sorts by due date (undated last, stable) and previews the next open tasks', () => {
    const tasks = [
      { id: 'c', completed: false, dueDate: null },
      { id: 'b', completed: false, dueDate: day(2026, 11, 8).toISOString() },
      { id: 'a', completed: true, dueDate: day(2026, 11, 1) },
      { id: 'd', completed: false, dueDate: day(2026, 11, 2) },
      { id: 'e', completed: false, dueDate: day(2026, 11, 8).toISOString() },
    ];
    expect(sortByDueDate(tasks).map((t) => t.id)).toEqual(['a', 'd', 'b', 'e', 'c']);
    expect(nextOpenTasks(tasks, 3).map((t) => t.id)).toEqual(['d', 'b', 'e']);
  });
});
