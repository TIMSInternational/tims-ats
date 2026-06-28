// tests/access/ai-interview-should-auto-end.test.ts
import { describe, it, expect } from 'vitest';
import { shouldAutoEnd } from '../../apps/web/app/(portal)/ai-interview/[token]/should-auto-end';

describe('shouldAutoEnd', () => {
  it('false before the cap', () => {
    expect(shouldAutoEnd(100, 900)).toBe(false);
  });
  it('true at or past the cap', () => {
    expect(shouldAutoEnd(900, 900)).toBe(true);
    expect(shouldAutoEnd(901, 900)).toBe(true);
  });
  it('never auto-ends when cap is null or non-positive (no cap)', () => {
    expect(shouldAutoEnd(99999, null)).toBe(false);
    expect(shouldAutoEnd(99999, 0)).toBe(false);
    expect(shouldAutoEnd(99999, -5)).toBe(false);
  });
});
