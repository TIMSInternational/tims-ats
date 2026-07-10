import { describe, it, expect } from 'vitest';
import {
  getOkrProgressSeverity,
  getDaysOverdue,
  getCommitmentSeverity,
} from '../../apps/web/lib/low-progress-alerts-helpers';

describe('getOkrProgressSeverity', () => {
  it('is critical when progress is below half the threshold', () => {
    expect(getOkrProgressSeverity(10, 30)).toBe('critical');
    expect(getOkrProgressSeverity(14, 30)).toBe('critical');
  });

  it('is a warning when progress is at or above half the threshold but still below it', () => {
    expect(getOkrProgressSeverity(15, 30)).toBe('warning');
    expect(getOkrProgressSeverity(29, 30)).toBe('warning');
  });
});

describe('getDaysOverdue', () => {
  it('returns 0 when the due date has not yet passed', () => {
    const now = new Date('2026-07-10T12:00:00Z');
    expect(getDaysOverdue('2026-07-15T00:00:00Z', now)).toBe(0);
  });

  it('returns whole days elapsed since the due date', () => {
    const now = new Date('2026-07-10T12:00:00Z');
    expect(getDaysOverdue('2026-07-05T12:00:00Z', now)).toBe(5);
    expect(getDaysOverdue('2026-07-01T00:00:00Z', now)).toBe(9);
  });
});

describe('getCommitmentSeverity', () => {
  const now = new Date('2026-07-10T00:00:00Z');

  it('is a warning within the first week overdue', () => {
    expect(getCommitmentSeverity('2026-07-05T00:00:00Z', now)).toBe('warning');
    expect(getCommitmentSeverity('2026-07-03T00:00:00Z', now)).toBe('warning');
  });

  it('is critical past a week overdue', () => {
    expect(getCommitmentSeverity('2026-06-25T00:00:00Z', now)).toBe('critical');
  });
});
