import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../../packages/api/src/services/alert-evaluation.service';

describe('evaluateCondition — operator comparison', () => {
  it('gt: breaches when value strictly exceeds threshold', () => {
    expect(evaluateCondition(11, 'gt', 10)).toBe(true);
    expect(evaluateCondition(10, 'gt', 10)).toBe(false);
    expect(evaluateCondition(9, 'gt', 10)).toBe(false);
  });

  it('gte: breaches at or above threshold', () => {
    expect(evaluateCondition(10, 'gte', 10)).toBe(true);
    expect(evaluateCondition(9, 'gte', 10)).toBe(false);
  });

  it('lt: breaches when strictly below threshold', () => {
    expect(evaluateCondition(4, 'lt', 5)).toBe(true);
    expect(evaluateCondition(5, 'lt', 5)).toBe(false);
  });

  it('lte: breaches at or below threshold', () => {
    expect(evaluateCondition(5, 'lte', 5)).toBe(true);
    expect(evaluateCondition(6, 'lte', 5)).toBe(false);
  });

  it('eq: breaches only on exact equality', () => {
    expect(evaluateCondition(7, 'eq', 7)).toBe(true);
    expect(evaluateCondition(8, 'eq', 7)).toBe(false);
  });

  it('returns false for a null metric value (unknown/uncomputable ⇒ never fire)', () => {
    expect(evaluateCondition(null, 'gt', 0)).toBe(false);
    expect(evaluateCondition(null, 'lte', 100)).toBe(false);
  });

  it('returns false for an unknown operator (fail-safe, no accidental fire)', () => {
    // @ts-expect-error — exercising the defensive default branch
    expect(evaluateCondition(100, 'between', 5)).toBe(false);
  });
});
