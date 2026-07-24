import { describe, it, expect, vi } from 'vitest';
import { verdictForRole, runRbacEndpoint } from './rbac';
import type { EndpointDef } from '../surfaces';

describe('verdictForRole', () => {
  it('ok when actual status matches expected (both 200)', () => {
    const r = verdictForRole('hr_admin', 200, 200);
    expect(r.ok).toBe(true);
  });

  it('ok when actual status matches expected (both 403)', () => {
    const r = verdictForRole('recruiter', 403, 403);
    expect(r.ok).toBe(true);
  });

  it('RED when a denied role gets 200 (privilege escalation)', () => {
    const r = verdictForRole('recruiter', 403, 200);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('recruiter');
    expect(r.detail).toContain('403');
    expect(r.detail).toContain('200');
  });

  it('RED when an allowed role gets 403 (privilege loss)', () => {
    const r = verdictForRole('hr_admin', 200, 403);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('hr_admin');
    expect(r.detail).toContain('200');
    expect(r.detail).toContain('403');
  });
});

describe('runRbacEndpoint', () => {
  const testEp: EndpointDef = {
    name: 'dashboard-kpis',
    csharpPath: '/team-intel/dashboard-kpis',
    tsProcedure: 'teamIntel.getDashboardKpis',
    input: {},
    expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
  };

  it('returns one CheckResult per role, all ok when all verdicts pass', async () => {
    const fake = vi.fn(async (_base: string, _path: string, token: string) => {
      if (token === 'hrbp-token') {
        return { status: 403, body: null };
      }
      return { status: 200, body: { kpis: [] } };
    });
    const result = await runRbacEndpoint(
      testEp,
      {
        base: 'http://csharp.local',
        tokensByRole: {
          super_admin: 'super-admin-token',
          hr_admin: 'hr-admin-token',
          hrbp: 'hrbp-token',
        },
      },
      fake,
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ check: 'rbac', endpoint: 'dashboard-kpis', ok: true, role: 'super_admin' });
    expect(result[1]).toMatchObject({ check: 'rbac', endpoint: 'dashboard-kpis', ok: true, role: 'hr_admin' });
    expect(result[2]).toMatchObject({ check: 'rbac', endpoint: 'dashboard-kpis', ok: true, role: 'hrbp' });

    expect(fake).toHaveBeenCalledWith('http://csharp.local', '/team-intel/dashboard-kpis', 'super-admin-token');
    expect(fake).toHaveBeenCalledWith('http://csharp.local', '/team-intel/dashboard-kpis', 'hr-admin-token');
    expect(fake).toHaveBeenCalledWith('http://csharp.local', '/team-intel/dashboard-kpis', 'hrbp-token');
  });

  it('RED when a role gets an unexpected status (privilege escalation)', async () => {
    const fake = vi.fn(async (_base: string, _path: string, token: string) => {
      if (token === 'hrbp-token') {
        return { status: 200, body: { kpis: [] } }; // WRONG: hrbp should be 403
      }
      return { status: 200, body: { kpis: [] } };
    });

    const result = await runRbacEndpoint(
      testEp,
      {
        base: 'http://csharp.local',
        tokensByRole: {
          super_admin: 'super-admin-token',
          hr_admin: 'hr-admin-token',
          hrbp: 'hrbp-token',
        },
      },
      fake,
    );

    expect(result).toHaveLength(3);
    const hrbpResult = result.find(r => r.role === 'hrbp');
    expect(hrbpResult?.ok).toBe(false);
    expect(hrbpResult?.detail).toContain('hrbp');
    expect(hrbpResult?.detail).toContain('403');
    expect(hrbpResult?.detail).toContain('200');
  });

  it('ok:false fail-closed when a role has no token', async () => {
    const fake = vi.fn();
    const result = await runRbacEndpoint(
      testEp,
      {
        base: 'http://csharp.local',
        tokensByRole: {
          super_admin: 'super-admin-token',
          hr_admin: 'hr-admin-token',
          // hrbp is missing!
        },
      },
      fake,
    );

    expect(result).toHaveLength(3);
    const hrbpResult = result.find(r => r.role === 'hrbp');
    expect(hrbpResult?.ok).toBe(false);
    expect(hrbpResult?.detail).toContain('hrbp');
    expect(hrbpResult?.detail).toContain('no token');
    expect(fake).toHaveBeenCalledTimes(2); // only super_admin and hr_admin called
  });

  it('RED when call returns non-200/403 status (unexpected error)', async () => {
    const fake = vi.fn().mockResolvedValue({ status: 500, body: null });
    const result = await runRbacEndpoint(
      testEp,
      {
        base: 'http://csharp.local',
        tokensByRole: {
          super_admin: 'super-admin-token',
          hr_admin: 'hr-admin-token',
          hrbp: 'hrbp-token',
        },
      },
      fake,
    );

    // All should be RED because the call itself failed
    expect(result.every(r => !r.ok)).toBe(true);
    expect(result[0].detail).toContain('500');
  });
});
