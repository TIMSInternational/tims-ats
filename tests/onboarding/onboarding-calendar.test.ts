import { describe, expect, it } from 'vitest';
import {
  onboardingDayIn,
  phaseForDay,
  startDateRangeForPhase,
  startOfDayIn,
  START_PHASES,
} from '../../packages/api/src/services/onboarding-calendar';

// B-23 (Codex round 2): the phase tabs filter on a start-date range and every listed plan carries the
// phase badge — both must use the SAME calendar (the organization's zone), or a plan can be listed under
// one tab while its badge names another.

const CR = 'America/Costa_Rica';

function inRange(start: Date, range: { gte?: Date; lt?: Date }): boolean {
  return (!range.gte || start >= range.gte) && (!range.lt || start < range.lt);
}

describe('onboarding calendar (organization zone)', () => {
  it('counts calendar days in the zone, not in UTC', () => {
    // 2026-11-05T05:30Z is still 4 Nov, 23:30 in Costa Rica.
    const now = new Date('2026-11-05T05:30:00.000Z');
    expect(startOfDayIn(CR, now).toISOString()).toBe('2026-11-04T06:00:00.000Z');
    expect(onboardingDayIn(CR, new Date('2026-10-05T18:00:00.000Z'), now)).toBe(30);
    expect(onboardingDayIn('UTC', new Date('2026-10-05T18:00:00.000Z'), now)).toBe(31);
    expect(onboardingDayIn(CR, new Date('2026-11-20T18:00:00.000Z'), now)).toBe(0);
    expect(onboardingDayIn('Not/AZone', new Date('2026-10-05T18:00:00.000Z'), now)).toBe(31); // UTC fallback
  });

  it('lists a plan under exactly the tab its badge names — the cross-zone case Codex reproduced', () => {
    const now = new Date('2026-11-05T05:30:00.000Z');
    const start = new Date('2026-10-05T18:00:00.000Z');
    const today = startOfDayIn(CR, now);
    expect(phaseForDay(onboardingDayIn(CR, start, now))).toBe('day1_30');
    expect(inRange(start, startDateRangeForPhase('day1_30', today))).toBe(true);
    expect(inRange(start, startDateRangeForPhase('day31_60', today))).toBe(false);
  });

  it('agrees for every start time across 100 days, at several moments of the day', () => {
    for (const nowIso of ['2026-11-05T05:30:00.000Z', '2026-11-05T06:00:00.000Z', '2026-11-05T17:59:00.000Z']) {
      const now = new Date(nowIso);
      const today = startOfDayIn(CR, now);
      for (let hours = 0; hours < 100 * 24; hours += 5) {
        const start = new Date(now.getTime() - hours * 3_600_000);
        const phase = phaseForDay(onboardingDayIn(CR, start, now));
        const tabs = START_PHASES.filter((p) => inRange(start, startDateRangeForPhase(p, today)));
        expect(tabs, `${start.toISOString()} @ ${nowIso}`).toEqual([phase]);
      }
    }
  });
});
