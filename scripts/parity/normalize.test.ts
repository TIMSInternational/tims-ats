import { describe, it, expect } from 'vitest';
import { normalize, diff } from './normalize';

describe('diff', () => {
  it('returns [] for deep-equal objects regardless of key order', () => {
    expect(diff({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toEqual([]);
  });
  it('reports a path + both values on mismatch', () => {
    expect(diff({ a: 1 }, { a: 2 })).toEqual([{ path: 'a', a: 1, b: 2 }]);
  });
  it('nested + array index paths', () => {
    expect(diff({ x: [1, 2] }, { x: [1, 3] })).toEqual([{ path: 'x[1]', a: 2, b: 3 }]);
  });
  it('reports a diff for different Date values (regression: false-equal on Dates)', () => {
    const result = diff(new Date('2020-01-01'), new Date('2025-06-01'));
    expect(result.length).toBeGreaterThan(0);
  });
  it('returns [] for equal Date values', () => {
    expect(diff(new Date('2020-01-01'), new Date('2020-01-01'))).toEqual([]);
  });
  it('reports a diff for NaN vs null (regression: JSON.stringify collapse)', () => {
    const result = diff(NaN, null);
    expect(result.length).toBeGreaterThan(0);
  });
  it('returns [] for NaN vs NaN', () => {
    expect(diff(NaN, NaN)).toEqual([]);
  });
  it('reports a diff for 0 vs false (type mismatch, already worked — lock it)', () => {
    const result = diff(0 as unknown, false as unknown);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('normalize', () => {
  it('dropNullish removes null/undefined keys (tRPC omit vs C# null)', () => {
    expect(normalize({ a: 1, b: null }, { dropNullish: true })).toEqual({ a: 1 });
  });
  it('sortArraysBy makes unordered arrays comparable', () => {
    const a = normalize({ rows: [{ id: 'b' }, { id: 'a' }] }, { sortArraysBy: 'id' });
    expect(a).toEqual({ rows: [{ id: 'a' }, { id: 'b' }] });
  });
  it('normalizes native Date to ISO string (regression: Date treated as plain object)', () => {
    const result = normalize({ ts: new Date('2020-01-01T00:00:00.000Z') });
    expect(result).toEqual({ ts: '2020-01-01T00:00:00.000Z' });
  });
});
