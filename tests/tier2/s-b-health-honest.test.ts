import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const h = readFileSync(
  resolve(__dirname, '../../packages/api/src/routers/platform/system.helpers.ts'),
  'utf8',
);
const page = readFileSync(
  resolve(__dirname, '../../apps/web/app/(admin)/platform/health/page.tsx'),
  'utf8',
);

describe('Tier-2 Slice B — no fabricated health literals', () => {
  it('removes fabricated literals from system.helpers.ts', () => {
    for (const lit of [
      '99.99%',
      '12.4 GB',
      'dbLatency * 3',
      'Math.max(dbLatency',
      'orgCount + 2',
      '0% usado',
      '$0.00',
      '24.8',
      "'N/A'",
    ]) {
      expect(h, `helper must not contain "${lit}"`).not.toContain(lit);
    }
  });

  it('removes hardcoded 99.97% uptime from page banner', () => {
    expect(page, 'page must not contain "99.97%"').not.toContain('99.97%');
  });

  it('marks unsourced metrics as unmeasured (null), which the UI renders as health.notAvailable', () => {
    // #323 moved the "N/D" literal out of the API (it was Spanish-only) — an unmeasured metric is value: null.
    expect(h, 'helper must build unmeasured metrics with value: null').toContain('({ id, value: null })');
    expect(page, 'page must render a null metric as t.health.notAvailable').toContain('metric.value ?? t.health.notAvailable');
  });

  it('keeps real DB latency without the ×3 fudge', () => {
    expect(h, 'helper must use ${dbLatency}ms').toContain('`${dbLatency}ms`');
    expect(h, 'helper must NOT use dbLatency * 3').not.toContain('dbLatency * 3');
  });
});
