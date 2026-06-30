/**
 * s5-route-config.test.ts  (Task 5 — S5 tripwire)
 *
 * Static source checks:
 *  1. apps/web/app/api/trpc/[trpc]/route.ts exports `maxDuration` as a number (= 30)
 *     AND exports `preferredRegion` as an array containing 'pdx1'.
 *  2. vercel.json parses as valid JSON, its `regions` array contains 'pdx1',
 *     and the existing `crons` + `buildCommand` keys are still present
 *     (guards against clobbering the file).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..', '..');

function readSrc(rel: string) {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

const routeSrc = readSrc('apps/web/app/api/trpc/[trpc]/route.ts');
const vercelJson = readSrc('apps/web/vercel.json');

describe('s5-route-config tripwire', () => {
  // ── 1. tRPC route segment config ──────────────────────────────────────────

  it('route.ts exports maxDuration = 30', () => {
    // Matches: export const maxDuration = 30;
    expect(routeSrc).toMatch(/export\s+const\s+maxDuration\s*=\s*30\s*;/);
  });

  it('route.ts exports preferredRegion containing pdx1', () => {
    // Matches: export const preferredRegion = ['pdx1'];
    expect(routeSrc).toMatch(/export\s+const\s+preferredRegion\s*=\s*\[/);
    expect(routeSrc).toMatch(/['"]pdx1['"]/);
  });

  it('route.ts preferredRegion is an array (not a bare string)', () => {
    // The value must open with [ — not a bare string assignment
    expect(routeSrc).toMatch(/preferredRegion\s*=\s*\[/);
  });

  // ── 2. vercel.json region co-location ─────────────────────────────────────

  it('vercel.json is valid JSON', () => {
    expect(() => JSON.parse(vercelJson)).not.toThrow();
  });

  it('vercel.json has regions key containing pdx1', () => {
    const parsed = JSON.parse(vercelJson) as Record<string, unknown>;
    expect(Array.isArray(parsed.regions)).toBe(true);
    expect((parsed.regions as string[])).toContain('pdx1');
  });

  it('vercel.json still has crons key with the exact evaluate-alerts cron (not clobbered)', () => {
    const parsed = JSON.parse(vercelJson) as Record<string, unknown>;
    expect(Array.isArray(parsed.crons)).toBe(true);
    const crons = parsed.crons as Array<{ path: string; schedule: string }>;
    // Assert the actual cron survived — path AND schedule, not just "an array exists".
    expect(crons).toContainEqual({ path: '/api/cron/evaluate-alerts', schedule: '0 6 * * *' });
  });

  it('vercel.json still has buildCommand key (not clobbered)', () => {
    const parsed = JSON.parse(vercelJson) as Record<string, unknown>;
    expect(typeof parsed.buildCommand).toBe('string');
    expect((parsed.buildCommand as string).length).toBeGreaterThan(0);
  });
});
