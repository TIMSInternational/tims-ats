import { describe, expect, it } from 'vitest';
import { scheduledOnboardingCheckIns } from '../../packages/api/src/services/onboarding-defaults';

describe('default onboarding check-ins', () => {
  it('schedules day 1, 30, and 60 for the same tenant, including across month boundaries', () => {
    const checkIns = scheduledOnboardingCheckIns(new Date('2026-09-22T17:00:00.000Z'), 'org-1');
    expect(checkIns.map((item) => item.type)).toEqual(['day1', 'day30', 'day60']);
    expect(checkIns.map((item) => item.scheduledDate.toISOString())).toEqual([
      '2026-09-22T17:00:00.000Z',
      '2026-10-22T17:00:00.000Z',
      '2026-11-21T17:00:00.000Z',
    ]);
    expect(checkIns.every((item) => item.organizationId === 'org-1')).toBe(true);
  });
});
