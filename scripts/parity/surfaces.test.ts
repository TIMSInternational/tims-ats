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
});
