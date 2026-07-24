import { describe, it, expect } from 'vitest';
import { SURFACES } from './surfaces';

describe('SURFACES', () => {
  it('team-intel has the dashboard-kpis endpoint + flag', () => {
    const s = SURFACES['team-intel'];
    expect(s.flag).toBe('Platform__TeamIntelReadEnabled');
    const kpi = s.endpoints.find((e) => e.name === 'dashboard-kpis');
    expect(kpi?.csharpPath).toBe('/team-intel/dashboard-kpis');
    expect(kpi?.expectedByRole['super_admin']).toBe(200);
  });

  it('team-intel declares an explicit probeRole (not implicit roles[] position)', () => {
    const s = SURFACES['team-intel'];
    expect(s.probeRole).toBe('super_admin');
    expect(s.roles).toContain(s.probeRole);
  });

  it('billing-usage has the three billing reads under one flag + super_admin-only allow', () => {
    const s = SURFACES['billing-usage'];
    expect(s.flag).toBe('Platform__BillingUsageEnabled');
    expect(s.probeRole).toBe('super_admin');
    expect(s.endpoints.map((e) => e.name).sort()).toEqual(['config', 'plan', 'usage']);
    for (const e of s.endpoints) {
      // billing is super-admin-only: exactly one allow, the rest denied.
      expect(e.expectedByRole['super_admin']).toBe(200);
      expect(e.expectedByRole['hr_admin']).toBe(403);
      expect(e.expectedByRole['hrbp']).toBe(403);
    }
  });

  it('billing-usage marks only /billing/config as globalScope (env-driven, non-tenant)', () => {
    const s = SURFACES['billing-usage'];
    const config = s.endpoints.find((e) => e.name === 'config');
    const usage = s.endpoints.find((e) => e.name === 'usage');
    const plan = s.endpoints.find((e) => e.name === 'plan');
    expect(config?.globalScope).toBe(true);
    // the two org-scoped reads must NOT be globalScope — they carry the real RLS proof.
    expect(usage?.globalScope).toBeUndefined();
    expect(plan?.globalScope).toBeUndefined();
  });

  it('reporting has the six recruitment-analytics reads under one flag + org-scope RBAC (super_admin/hr_admin 200, hrbp 403)', () => {
    const s = SURFACES['reporting'];
    expect(s.flag).toBe('Platform__ReportingReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    expect(s.endpoints.map((e) => e.name).sort()).toEqual(
      ['funnel', 'kpis', 'kpis-90d', 'lost-by-delay', 'recruiter-sla', 'source-breakdown', 'trend'],
    );
    for (const e of s.endpoints) {
      // vacancy:read is org-scoped: super_admin (bypass) + hr_admin (org grant) allow,
      // hrbp (unit grant) fails requireOrgScope.
      expect(e.expectedByRole['super_admin']).toBe(200);
      expect(e.expectedByRole['hr_admin']).toBe(200);
      expect(e.expectedByRole['hrbp']).toBe(403);
      // none of the reporting reads is a non-tenant global — they're all org-scoped Mode B.
      expect(e.globalScope).toBeUndefined();
    }
  });

  it('reporting bakes ?period=30D into csharpPath AND tsProcedure input for the three period endpoints', () => {
    const s = SURFACES['reporting'];
    const periodEndpoints = ['kpis', 'source-breakdown', 'lost-by-delay'];
    for (const name of periodEndpoints) {
      const e = s.endpoints.find((x) => x.name === name)!;
      // callCsharp uses csharpPath verbatim (no query-building) → period must live in the path.
      expect(e.csharpPath).toContain('?period=30D');
      // ...and match the tRPC input so both stacks resolve the SAME window (no default drift).
      expect(e.input).toEqual({ period: '30D' });
    }
    // the no-input endpoints carry no query + empty input.
    for (const name of ['funnel', 'trend', 'recruiter-sla']) {
      const e = s.endpoints.find((x) => x.name === name)!;
      expect(e.csharpPath).not.toContain('?');
      expect(e.input).toEqual({});
    }
    // the second kpis probe pins a NON-default window so a "period ignored" C# regression is caught.
    const kpis90 = s.endpoints.find((x) => x.name === 'kpis-90d')!;
    expect(kpis90.csharpPath).toContain('?period=90D');
    expect(kpis90.input).toEqual({ period: '90D' });
    expect(kpis90.tsProcedure).toBe('recruitmentAnalytics.getKpis');
  });

  it('the four Tier-1 read surfaces are registered with their flags + endpoint sets', () => {
    expect(SURFACES['compensation'].flag).toBe('Platform__CompensationReadEnabled');
    expect(SURFACES['compensation'].endpoints.map((e) => e.name).sort()).toEqual(
      ['benefits-utilization', 'compa-ratio-distribution', 'market-comparison', 'my-compensation', 'pending-adjustments', 'salary-bands'],
    );
    expect(SURFACES['evaluation360'].flag).toBe('Platform__Evaluation360ReadEnabled');
    expect(SURFACES['evaluation360'].endpoints.map((e) => e.name).sort()).toEqual(
      ['cycles', 'my-rater-tasks', 'my-report-cycles'],
    );
    expect(SURFACES['ninebox'].flag).toBe('Platform__NineBoxReadEnabled');
    expect(SURFACES['ninebox'].endpoints).toHaveLength(8);
    expect(SURFACES['succession'].flag).toBe('Platform__SuccessionReadEnabled');
    expect(SURFACES['succession'].endpoints.map((e) => e.name)).toContain('comp-gap-alerts');
    expect(SURFACES['succession'].endpoints).toHaveLength(6);
    for (const key of ['compensation', 'evaluation360', 'ninebox', 'succession']) {
      expect(SURFACES[key].probeRole).toBe('super_admin');
    }
  });

  it('nine-box marks only the two pure kernels as globalScope', () => {
    const nb = SURFACES['ninebox'];
    expect(nb.endpoints.find((e) => e.name === 'simulate')?.globalScope).toBe(true);
    expect(nb.endpoints.find((e) => e.name === 'quadrant-plan')?.globalScope).toBe(true);
    expect(nb.endpoints.find((e) => e.name === 'grid')?.globalScope).toBeUndefined();
    // grid + movement-history omit hrbp (scopeWhereFor fragile); the org-rollup reads deny hrbp.
    expect(nb.endpoints.find((e) => e.name === 'grid')?.expectedByRole['hrbp']).toBeUndefined();
    expect(nb.endpoints.find((e) => e.name === 'dashboard-kpis')?.expectedByRole['hrbp']).toBe(403);
  });
});
