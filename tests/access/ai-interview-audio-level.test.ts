// tests/access/ai-interview-audio-level.test.ts
import { describe, it, expect } from 'vitest';
import { computeRmsLevel } from '../../apps/web/app/(portal)/ai-interview/[token]/audio-level';

describe('computeRmsLevel', () => {
  it('returns 0 for silence (all samples at 128)', () => {
    expect(computeRmsLevel(new Uint8Array(64).fill(128))).toBe(0);
  });

  it('returns ~1 for full-scale alternating extremes', () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? 0 : 255;
    expect(computeRmsLevel(buf)).toBeGreaterThan(0.9);
  });

  it('is between 0 and 1 and monotonic with amplitude', () => {
    const quiet = new Uint8Array(64).fill(138); // small deviation
    const loud = new Uint8Array(64).fill(200); // large deviation
    const q = computeRmsLevel(quiet);
    const l = computeRmsLevel(loud);
    expect(q).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
    expect(l).toBeGreaterThan(q);
  });

  it('returns 0 for an empty buffer', () => {
    expect(computeRmsLevel(new Uint8Array(0))).toBe(0);
  });
});
