import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import { computeAvgTenureYears, computeRoleDiversity } from '../../packages/api/src/routers/team-intel-metrics';

describe('team-intel metrics', () => {
  const NOW = new Date('2026-06-29T00:00:00Z').getTime();
  it('avg tenure in years (1 decimal), 0 when empty', () => {
    const twoYrs = new Date('2024-06-29T00:00:00Z');
    expect(computeAvgTenureYears([{ createdAt: twoYrs }], NOW)).toBe(2);
    expect(computeAvgTenureYears([], NOW)).toBe(0);
  });
  it('role diversity = unique non-empty titles / members (0-1)', () => {
    expect(computeRoleDiversity([{ jobTitle: 'Dev' }, { jobTitle: 'Dev' }, { jobTitle: 'PM' }])).toBe(0.67);
    expect(computeRoleDiversity([{ jobTitle: null }])).toBe(0);
    expect(computeRoleDiversity([])).toBe(0);
  });
});

const kpis = readFileSync(
  resolve(__dirname, '../../apps/web/app/(admin)/talent/team-intelligence/team-intel-kpis.tsx'),
  'utf8',
);
const alerts = readFileSync(
  resolve(__dirname, '../../apps/web/app/(admin)/talent/team-intelligence/balance-alerts.tsx'),
  'utf8',
);
const hires = readFileSync(
  resolve(__dirname, '../../apps/web/app/(admin)/talent/team-intelligence/recommended-hires.tsx'),
  'utf8',
);

describe('team-intel UI has no fabricated data', () => {
  it('kpis component has no fabricated literals and wires real data', () => {
    for (const lit of ["'2.8'", 'value: 68', "'0.72'", "'8.2'", '?? 12', 'vs Q1', 'vs anterior']) {
      expect(kpis, `kpis must not contain "${lit}"`).not.toContain(lit);
    }
    expect(kpis, 'kpis must wire avgTenureYears').toMatch(/data\?\.avgTenureYears/);
    expect(kpis, 'kpis must wire diversityIndex').toMatch(/data\?\.diversityIndex/);
  });
  it('balance-alerts has no DEMO_ALERTS and uses EmptyState', () => {
    expect(alerts, 'alerts must not contain DEMO_ALERTS').not.toContain('DEMO_ALERTS');
    expect(alerts, 'alerts must use EmptyState').toMatch(/EmptyState/);
  });
  it('recommended-hires has no DEMO_HIRES and uses EmptyState', () => {
    expect(hires, 'hires must not contain DEMO_HIRES').not.toContain('DEMO_HIRES');
    expect(hires, 'hires must use EmptyState').toMatch(/EmptyState/);
  });
});
