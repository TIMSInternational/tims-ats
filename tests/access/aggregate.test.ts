import { describe, it, expect } from 'vitest';
import {
  MIN_AGGREGATE_SIZE,
  suppressBelowMin5,
  aggregateGroups,
} from '../../packages/api/src/access/aggregate';

describe('suppressBelowMin5', () => {
  it('threshold is 5', () => {
    expect(MIN_AGGREGATE_SIZE).toBe(5);
  });
  it('count >= 5 passes through', () => {
    expect(suppressBelowMin5(5)).toEqual({ suppressed: false, count: 5 });
    expect(suppressBelowMin5(42)).toEqual({ suppressed: false, count: 42 });
  });
  it('1..4 is suppressed (count hidden)', () => {
    expect(suppressBelowMin5(4)).toEqual({ suppressed: true, count: null });
    expect(suppressBelowMin5(1)).toEqual({ suppressed: true, count: null });
  });
  it('covers the full 1..4 boundary (2 and 3 too)', () => {
    expect(suppressBelowMin5(2)).toEqual({ suppressed: true, count: null });
    expect(suppressBelowMin5(3)).toEqual({ suppressed: true, count: null });
  });
  it('0 is NOT suppressed — an empty bucket leaks no individual', () => {
    expect(suppressBelowMin5(0)).toEqual({ suppressed: false, count: 0 });
  });
});

describe('aggregateGroups — groups rows by key, suppresses small groups', () => {
  it('groups < 5 are suppressed, >= 5 pass', () => {
    const rows = [
      ...Array(6).fill({ g: 'a' }),
      ...Array(3).fill({ g: 'b' }),
    ];
    const out = aggregateGroups(rows, (r) => r.g);
    expect(out).toEqual([
      { key: 'a', count: 6, suppressed: false },
      { key: 'b', count: null, suppressed: true },
    ]);
  });
  it('total respondent count below 5 suppresses EVERY group (re-identification guard)', () => {
    const rows = [{ g: 'a' }, { g: 'a' }, { g: 'b' }, { g: 'b' }];
    const out = aggregateGroups(rows, (r) => r.g);
    expect(out.every((o) => o.suppressed)).toBe(true);
  });
  it('empty input → empty result', () => {
    expect(aggregateGroups([], (r: { g: string }) => r.g)).toEqual([]);
  });
});
