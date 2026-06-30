/**
 * s3-cache-wired.test.ts  (Task 3 — S3 tripwire)
 *
 * Static source checks: every target getDashboardKpis procedure references
 * cacheGet + cacheSet, and featureFlag references cacheInvalidatePrefix.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..', '..');

function readRouter(rel: string) {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

describe('s3-cache-wired tripwire', () => {
  it('platform/dashboard.ts getDashboardKpis references cacheGet', () => {
    const src = readRouter('packages/api/src/routers/platform/dashboard.ts');
    expect(src).toMatch(/cacheGet/);
  });

  it('platform/dashboard.ts getDashboardKpis references cacheSet', () => {
    const src = readRouter('packages/api/src/routers/platform/dashboard.ts');
    expect(src).toMatch(/cacheSet/);
  });

  it('performance/dashboard.ts getDashboardKpis references cacheGet', () => {
    const src = readRouter('packages/api/src/routers/performance/dashboard.ts');
    expect(src).toMatch(/cacheGet/);
  });

  it('performance/dashboard.ts getDashboardKpis references cacheSet', () => {
    const src = readRouter('packages/api/src/routers/performance/dashboard.ts');
    expect(src).toMatch(/cacheSet/);
  });

  it('vacancy/stats.ts getDashboardKpis references cacheGet', () => {
    const src = readRouter('packages/api/src/routers/vacancy/stats.ts');
    expect(src).toMatch(/cacheGet/);
  });

  it('vacancy/stats.ts getDashboardKpis references cacheSet', () => {
    const src = readRouter('packages/api/src/routers/vacancy/stats.ts');
    expect(src).toMatch(/cacheSet/);
  });

  it('learning.ts getDashboardKpis references cacheGet', () => {
    const src = readRouter('packages/api/src/routers/learning.ts');
    expect(src).toMatch(/cacheGet/);
  });

  it('learning.ts getDashboardKpis references cacheSet', () => {
    const src = readRouter('packages/api/src/routers/learning.ts');
    expect(src).toMatch(/cacheSet/);
  });

  it('teamIntel.ts getDashboardKpis references cacheGet', () => {
    const src = readRouter('packages/api/src/routers/teamIntel.ts');
    expect(src).toMatch(/cacheGet/);
  });

  it('teamIntel.ts getDashboardKpis references cacheSet', () => {
    const src = readRouter('packages/api/src/routers/teamIntel.ts');
    expect(src).toMatch(/cacheSet/);
  });

  it('teamIntel.ts uses orgId in cache key', () => {
    const src = readRouter('packages/api/src/routers/teamIntel.ts');
    expect(src).toMatch(/tims:kpis:teamintel:/);
  });

  it('featureFlag.ts references cacheInvalidatePrefix', () => {
    const src = readRouter('packages/api/src/routers/featureFlag.ts');
    expect(src).toMatch(/cacheInvalidatePrefix/);
  });

  it('vacancy/stats.ts uses a scope discriminator in the cache key', () => {
    // The key must embed the access scope to avoid cross-scope cache collisions.
    const src = readRouter('packages/api/src/routers/vacancy/stats.ts');
    // Either ctx.access.scope or a variable derived from it appears in the key template.
    expect(src).toMatch(/tims:kpis:vacancy.*scope/s);
  });

  it('platform/dashboard.ts uses global key (no orgId) for platform KPIs', () => {
    const src = readRouter('packages/api/src/routers/platform/dashboard.ts');
    expect(src).toMatch(/tims:kpis:platform:global/);
  });

  it('performance/dashboard.ts uses orgId in cache key', () => {
    const src = readRouter('packages/api/src/routers/performance/dashboard.ts');
    expect(src).toMatch(/tims:kpis:performance:/);
  });

  it('learning.ts uses orgId in cache key', () => {
    const src = readRouter('packages/api/src/routers/learning.ts');
    expect(src).toMatch(/tims:kpis:learning:/);
  });
});
