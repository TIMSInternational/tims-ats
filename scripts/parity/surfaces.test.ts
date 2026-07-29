import { describe, it, expect } from 'vitest';
import { SURFACES } from './surfaces';

describe('SURFACES', () => {
  it('the four read surfaces are registered with their flags + full endpoint sets (Tier-1 + Tier-2 by-id)', () => {
    expect(SURFACES['compensation'].flag).toBe('Platform__CompensationReadEnabled');
    expect(SURFACES['compensation'].endpoints.map((e) => e.name).sort()).toEqual([
      'benefits-utilization',
      'compa-ratio-distribution',
      'employee',
      'market-comparison',
      'my-compensation',
      'pending-adjustments',
      'salary-bands',
    ]);
    expect(SURFACES['ninebox'].flag).toBe('Platform__NineBoxReadEnabled');
    expect(SURFACES['ninebox'].endpoints).toHaveLength(4);
    expect(SURFACES['succession'].flag).toBe('Platform__SuccessionReadEnabled');
    expect(SURFACES['succession'].endpoints.map((e) => e.name)).toContain('critical-role');
    expect(SURFACES['succession'].endpoints).toHaveLength(1);
    for (const key of ['compensation', 'ninebox', 'succession']) {
      expect(SURFACES[key].probeRole).toBe('super_admin');
    }
  });

  it('every Tier-2 by-id endpoint sets idScopeKey and carries the {id} sentinel in path + input', () => {
    // The 9 by-id Mode-A IDOR endpoints and the resource key each threads.
    const expected: Record<string, string> = {
      'compensation/employee': 'employee',
      'ninebox/axis-breakdown': 'employee',
      'succession/critical-role': 'critical-role',
    };
    let byIdCount = 0;
    for (const [surfaceKey, surface] of Object.entries(SURFACES)) {
      for (const ep of surface.endpoints) {
        if (!ep.idScopeKey) continue;
        byIdCount++;
        const k = `${surfaceKey}/${ep.name}`;
        expect(expected[k], `unexpected by-id endpoint ${k}`).toBe(ep.idScopeKey);
        // the sentinel MUST appear in the path so the harness can substitute a concrete id.
        expect(ep.csharpPath, k).toContain('{id}');
        // ...and in exactly one input value, so the tRPC side resolves the same id.
        expect(JSON.stringify(ep.input), k).toContain('{id}');
      }
    }
    expect(byIdCount).toBe(3);
  });

  it('nine-box marks only the two pure kernels as globalScope', () => {
    const nb = SURFACES['ninebox'];
    expect(nb.endpoints.find((e) => e.name === 'simulate')?.globalScope).toBe(true);
    expect(nb.endpoints.find((e) => e.name === 'quadrant-plan')?.globalScope).toBe(true);
    expect(nb.endpoints.find((e) => e.name === 'movement-history')?.globalScope).toBeUndefined();
    // movement-history omits hrbp (scopeWhereFor fragile); axis-breakdown (subject-scoped) denies hrbp.
    expect(nb.endpoints.find((e) => e.name === 'movement-history')?.expectedByRole['hrbp']).toBeUndefined();
    expect(nb.endpoints.find((e) => e.name === 'axis-breakdown')?.expectedByRole['hrbp']).toBe(403);
  });

  // ── Coverage-audit additions (2026-07-27) ────────────────────────────────────────────────────
  it('engagement is registered with its flag + the 9 Tier-1 reads (5 by-id reads deferred)', () => {
    const s = SURFACES['engagement'];
    expect(s.flag).toBe('Platform__EngagementReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    expect(s.endpoints.map((e) => e.name).sort()).toEqual([
      'action-plans',
      'alerts',
      'climate-heatmap',
      'dashboard-kpis',
      'enps',
      'leader-commitments',
      'my-pending-surveys',
      'rotation-risk',
      'surveys',
    ]);
    // none of the Tier-1 engagement reads is by-id yet (see the surface-level deferral comment).
    for (const e of s.endpoints) expect(e.idScopeKey).toBeUndefined();
  });

  it('engagement: grant-only/self-service reads pass hrbp; org-rollup reads deny hrbp; scopeWhereFor reads omit hrbp', () => {
    const s = SURFACES['engagement'];
    for (const name of ['surveys', 'my-pending-surveys']) {
      expect(s.endpoints.find((e) => e.name === name)?.expectedByRole['hrbp'], name).toBe(200);
    }
    for (const name of ['enps', 'climate-heatmap', 'alerts', 'dashboard-kpis', 'rotation-risk']) {
      expect(s.endpoints.find((e) => e.name === name)?.expectedByRole['hrbp'], name).toBe(403);
    }
    for (const name of ['action-plans', 'leader-commitments']) {
      expect(s.endpoints.find((e) => e.name === name)?.expectedByRole['hrbp'], name).toBeUndefined();
    }
    // super_admin/hr_admin allow everywhere.
    for (const e of s.endpoints) {
      expect(e.expectedByRole['super_admin'], e.name).toBe(200);
      expect(e.expectedByRole['hr_admin'], e.name).toBe(200);
    }
  });

  it('dei is registered with its flag + the 10 reads, ALL grant-only (hrbp denied everywhere — no dei grant at all)', () => {
    const s = SURFACES['dei'];
    expect(s.flag).toBe('Platform__DeiReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    expect(s.endpoints.map((e) => e.name).sort()).toEqual([
      'age-distribution',
      'dashboard-kpis',
      'disability-distribution',
      'ethnicity-distribution',
      'gender-representation',
      'hiring-funnel',
      'inclusion-index',
      'leadership-diversity',
      'nationality-diversity',
      'promotion-equity',
    ]);
    // pay-equity is deliberately excluded (separate Platform__FxReadsEnabled flag).
    expect(s.endpoints.find((e) => e.name === 'pay-equity')).toBeUndefined();
    for (const e of s.endpoints) {
      expect(e.expectedByRole, e.name).toEqual({ super_admin: 200, hr_admin: 200, hrbp: 403 });
    }
  });

  it('billing-invoices reuses billing-usage RBAC verdicts under its own (BillingReadEnabled) flag', () => {
    const s = SURFACES['billing-invoices'];
    expect(s.flag).toBe('Platform__BillingReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    expect(s.endpoints.map((e) => e.name)).toEqual(['invoices']);
    const e = s.endpoints[0];
    expect(e.expectedByRole).toEqual({ super_admin: 200, hr_admin: 403, hrbp: 403 });
    expect(e.tsProcedure).toBe('billing.listInvoices');
    // getInvoice (by-id) is a documented Tier-2 follow-up, not registered here.
    expect(s.endpoints.find((x) => x.idScopeKey)).toBeUndefined();
  });
});
