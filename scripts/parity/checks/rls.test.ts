import { describe, it, expect, vi } from 'vitest';
import { assertIsolated, runRlsEndpoint } from './rls';
import type { EndpointDef } from '../surfaces';

describe('assertIsolated', () => {
  it('ok when cross-tenant fetch returns 404', () => {
    const r = assertIsolated({ status: 404, body: null });
    expect(r.ok).toBe(true);
  });

  it('ok when cross-tenant fetch returns 403', () => {
    const r = assertIsolated({ status: 403, body: null });
    expect(r.ok).toBe(true);
  });

  it('ok when body is empty', () => {
    const r = assertIsolated({ status: 200, body: null });
    expect(r.ok).toBe(true);
  });

  it('RED when cross-tenant fetch returns 200 with data', () => {
    const r = assertIsolated({ status: 200, body: { id: 'orgB-thing' } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('cross-tenant');
  });

  it('RED when status is 500 (cannot confirm isolation)', () => {
    const r = assertIsolated({ status: 500, body: null });
    expect(r.ok).toBe(false);
  });

  it('RED when body contains nested data at 200', () => {
    const r = assertIsolated({ status: 200, body: { data: [{ id: 'item' }] } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('cross-tenant');
  });
});

describe('runRlsEndpoint', () => {
  const idScopedEp: EndpointDef = {
    name: 'team-profile',
    csharpPath: '/team-intel/teams/{teamId}/profile',
    tsProcedure: 'teamIntel.getTeamProfile',
    input: {},
    idScopeKey: 'teamId',
    expectedByRole: { super_admin: 200 },
  };

  const orgScopedEp: EndpointDef = {
    name: 'dashboard-kpis',
    csharpPath: '/team-intel/dashboard-kpis',
    tsProcedure: 'teamIntel.getDashboardKpis',
    input: {},
    expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
  };

  describe('Mode A — by-id IDOR probe (idScopeKey set)', () => {
    it('ok:true when org-A token gets 404 for org-B resource id', async () => {
      const fake = vi.fn().mockResolvedValue({ status: 404, body: null });
      const result = await runRlsEndpoint(
        idScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBResourceId: 'org-b-team-id' },
        fake,
      );
      expect(result.ok).toBe(true);
      expect(result.check).toBe('rls');
      expect(result.endpoint).toBe('team-profile');
      expect(fake).toHaveBeenCalledWith(
        'http://csharp.local',
        '/team-intel/teams/org-b-team-id/profile',
        'org-a-token',
      );
    });

    it('ok:false with cross-tenant detail when org-A token gets 200+data for org-B resource id', async () => {
      const fake = vi.fn().mockResolvedValue({ status: 200, body: { id: 'org-b-team-id', name: 'Org B Team' } });
      const result = await runRlsEndpoint(
        idScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBResourceId: 'org-b-team-id' },
        fake,
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('cross-tenant');
      expect(result.check).toBe('rls');
    });

    it('ok:false fail-closed when orgBResourceId is missing', async () => {
      const fake = vi.fn();
      const result = await runRlsEndpoint(
        idScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token' },
        fake,
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toBe('rls: idScopeKey set but no orgBResourceId provided');
      expect(fake).not.toHaveBeenCalled();
    });
  });

  describe('Mode B — org-scoped endpoint (idScopeKey not set)', () => {
    it('ok:true when both orgs get 200 with DIFFERENT non-empty bodies', async () => {
      const fake = vi.fn(
        async (_base: string, _path: string, token: string) =>
          token === 'org-a-token'
            ? { status: 200, body: { openRoles: 3 } }
            : { status: 200, body: { openRoles: 7 } },
      );
      const result = await runRlsEndpoint(
        orgScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBToken: 'org-b-token' },
        fake,
      );
      expect(result.ok).toBe(true);
      expect(result.inconclusive).toBeFalsy();
      expect(fake).toHaveBeenCalledWith('http://csharp.local', '/team-intel/dashboard-kpis', 'org-a-token');
      expect(fake).toHaveBeenCalledWith('http://csharp.local', '/team-intel/dashboard-kpis', 'org-b-token');
    });

    it('ok:false when both orgs get 200 with IDENTICAL non-empty bodies (possible leak)', async () => {
      const fake = vi.fn().mockResolvedValue({ status: 200, body: { openRoles: 3 } });
      const result = await runRlsEndpoint(
        orgScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBToken: 'org-b-token' },
        fake,
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('cross-tenant');
      expect(result.detail).toContain('identical');
    });

    it('ok:true + inconclusive:true when both orgs get 200 with EMPTY bodies (structural pass only, freshly-seeded)', async () => {
      const fake = vi.fn().mockResolvedValue({ status: 200, body: {} });
      const result = await runRlsEndpoint(
        orgScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBToken: 'org-b-token' },
        fake,
      );
      expect(result.ok).toBe(true);
      expect(result.inconclusive).toBe(true);
      expect(result.detail).toContain('inconclusive');
      expect(result.detail).toContain('no cross-tenant data was compared');
    });

    it('ok:true + inconclusive:true when both orgs get 200 with null bodies (structural pass only, freshly-seeded)', async () => {
      const fake = vi.fn().mockResolvedValue({ status: 200, body: null });
      const result = await runRlsEndpoint(
        orgScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBToken: 'org-b-token' },
        fake,
      );
      expect(result.ok).toBe(true);
      expect(result.inconclusive).toBe(true);
      expect(result.detail).toContain('inconclusive');
    });

    it('ok:false fail-closed when either response is not 200', async () => {
      const fake = vi.fn(
        async (_base: string, _path: string, token: string) =>
          token === 'org-a-token' ? { status: 500, body: null } : { status: 200, body: { openRoles: 7 } },
      );
      const result = await runRlsEndpoint(
        orgScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBToken: 'org-b-token' },
        fake,
      );
      expect(result.ok).toBe(false);
    });

    it('ok:false fail-closed when orgBToken is missing', async () => {
      const fake = vi.fn();
      const result = await runRlsEndpoint(
        orgScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token' },
        fake,
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toBe('rls: org-scoped check needs orgBToken');
      expect(fake).not.toHaveBeenCalled();
    });
  });
});
