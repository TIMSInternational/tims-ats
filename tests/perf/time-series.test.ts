import { describe, it, expect } from 'vitest';
import { buildMonthSeries } from '../../packages/api/src/routers/platform/time-series';

describe('buildMonthSeries', () => {
  it('fills 6 oldest-first buckets, gaps=0', () => {
    const end = new Date('2026-06-15T00:00:00Z');
    const rows = [{ month: '2026-06', count: 5 }, { month: '2026-04', count: 2 }];
    const out = buildMonthSeries(rows, 6, end);
    expect(out.length).toBe(6);
    expect(out[5]).toEqual({ month: '2026-06', count: 5 });
    expect(out[4]).toEqual({ month: '2026-05', count: 0 });
    expect(out[3]).toEqual({ month: '2026-04', count: 2 });
    expect(out[0].month).toBe('2026-01');
  });
});
