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
});
