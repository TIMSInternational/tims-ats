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

  it('by DEFAULT a 200 empty body FAILS (a 404 denial was expected, not a processed-then-empty 200)', () => {
    const r = assertIsolated({ status: 200, body: null });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('404 denial was expected');
  });

  it('with emptyOk, a 200 empty body is isolation-held (endpoint models not-found as a 200 null-shape)', () => {
    expect(assertIsolated({ status: 200, body: null }, { emptyOk: true }).ok).toBe(true);
    expect(assertIsolated({ status: 200, body: { evaluation: null, history: [] } }, { emptyOk: true }).ok).toBe(true);
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

  // A 200 not-found SHAPE (structurally non-empty, semantically no data) reads as isolated ONLY under
  // emptyOk — real routes model cross-tenant absence this way (ninebox `/employee/{id}` → this exact shape),
  // and a shallow keys-length check would false-flag it as a leak.
  it('with emptyOk, a deep-empty nested shape is isolated; a populated entity still leaks', () => {
    expect(assertIsolated({ status: 200, body: { a: null, b: [], c: {}, d: '' } }, { emptyOk: true }).ok).toBe(true);
    // a genuine leak (populated entity) FAILS even under emptyOk.
    const leak = assertIsolated(
      { status: 200, body: { evaluation: { id: 'orgB', potentialScore: 55 }, history: [] } },
      { emptyOk: true },
    );
    expect(leak.ok).toBe(false);
    expect(leak.detail).toContain('cross-tenant');
  });

  it('RED (leak) when a 200 body has a populated nested entity even alongside empties (default)', () => {
    const r = assertIsolated({ status: 200, body: { evaluation: { id: 'orgB', potentialScore: 55 }, history: [] } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('cross-tenant');
  });

  it('does NOT treat 0/false as empty (a real scalar payload still fails closed)', () => {
    // {count:0} is non-deep-empty → treated as a populated (leak) body, FAILs under default and emptyOk alike.
    expect(assertIsolated({ status: 200, body: { count: 0 } }).ok).toBe(false);
    expect(assertIsolated({ status: 200, body: { count: 0 } }, { emptyOk: true }).ok).toBe(false);
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
    // Distinguishes the two probe calls by token: org-A (isolation) vs org-B (positive control).
    const byToken = (aResp: { status: number; body: unknown }, bResp: { status: number; body: unknown }) =>
      vi.fn(async (_base: string, _path: string, token: string) => (token === 'org-a-token' ? aResp : bResp));

    it('STRONG ok:true when org-A is denied (404) AND org-B can itself reach the live resource (200+data)', async () => {
      const fake = byToken({ status: 404, body: null }, { status: 200, body: { id: 'org-b-team-id', name: 'B' } });
      const result = await runRlsEndpoint(
        idScopedEp,
        {
          base: 'http://csharp.local',
          orgAToken: 'org-a-token',
          orgBToken: 'org-b-token',
          orgBResourceId: 'org-b-team-id',
        },
        fake,
      );
      expect(result.ok).toBe(true);
      expect(result.inconclusive).toBeFalsy();
      expect(result.endpoint).toBe('team-profile');
      // isolation call (org-A) + positive control (org-B), same probe path.
      expect(fake).toHaveBeenCalledWith(
        'http://csharp.local',
        '/team-intel/teams/org-b-team-id/profile',
        'org-a-token',
      );
      expect(fake).toHaveBeenCalledWith(
        'http://csharp.local',
        '/team-intel/teams/org-b-team-id/profile',
        'org-b-token',
      );
    });

    it('ok:false with cross-tenant detail when org-A token gets 200+data for org-B resource id (leak)', async () => {
      const fake = byToken(
        { status: 200, body: { id: 'org-b-team-id', name: 'Org B Team' } },
        { status: 200, body: { id: 'x' } },
      );
      const result = await runRlsEndpoint(
        idScopedEp,
        {
          base: 'http://csharp.local',
          orgAToken: 'org-a-token',
          orgBToken: 'org-b-token',
          orgBResourceId: 'org-b-team-id',
        },
        fake,
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('cross-tenant');
      // A confirmed leak is FAIL regardless of the positive control — no need to probe org-B.
      expect(fake).toHaveBeenCalledWith(
        'http://csharp.local',
        '/team-intel/teams/org-b-team-id/profile',
        'org-a-token',
      );
      expect(fake).not.toHaveBeenCalledWith(
        'http://csharp.local',
        '/team-intel/teams/org-b-team-id/profile',
        'org-b-token',
      );
    });

    it('FAIL (not a silent pass) when isolation holds but org-B cannot itself reach the id (not live → trivial 404)', async () => {
      const fake = byToken({ status: 404, body: null }, { status: 404, body: null });
      const result = await runRlsEndpoint(
        idScopedEp,
        {
          base: 'http://csharp.local',
          orgAToken: 'org-a-token',
          orgBToken: 'org-b-token',
          orgBResourceId: 'org-b-team-id',
        },
        fake,
      );
      expect(result.ok).toBe(false);
      expect(result.inconclusive).toBeFalsy();
      expect(result.detail).toContain('positive control');
    });

    it('FAIL when isolation holds but org-B reaches the id EMPTY (cannot confirm live → strong test never ran)', async () => {
      const fake = byToken({ status: 404, body: null }, { status: 200, body: {} });
      const result = await runRlsEndpoint(
        idScopedEp,
        {
          base: 'http://csharp.local',
          orgAToken: 'org-a-token',
          orgBToken: 'org-b-token',
          orgBResourceId: 'org-b-team-id',
        },
        fake,
      );
      expect(result.ok).toBe(false);
    });

    it('FAIL when there is no orgBToken to run the positive control (a strong IDOR proof that cannot run is not a pass)', async () => {
      const fake = vi.fn().mockResolvedValue({ status: 404, body: null });
      const result = await runRlsEndpoint(
        idScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBResourceId: 'org-b-team-id' },
        fake,
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('orgBToken');
    });

    it('by DEFAULT a 200 EMPTY isolation response FAILS (a 404 denial was expected, not a processed-empty 200)', async () => {
      // org-A gets a 200 null-shape, org-B (positive control) gets live data. Without crossTenantEmptyOk
      // the 200-empty is an anomaly → FAIL (a possible missing-404 / existence oracle).
      const fake = byToken(
        { status: 200, body: { evaluation: null, history: [] } },
        { status: 200, body: { id: 'x', v: 1 } },
      );
      const result = await runRlsEndpoint(
        idScopedEp,
        {
          base: 'http://csharp.local',
          orgAToken: 'org-a-token',
          orgBToken: 'org-b-token',
          orgBResourceId: 'org-b-team-id',
        },
        fake,
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('404 denial was expected');
    });

    it('with crossTenantEmptyOk a 200 null-shape isolation response is isolated (ninebox /employee/{id} case)', async () => {
      const emptyOkEp: EndpointDef = { ...idScopedEp, crossTenantEmptyOk: true };
      const fake = byToken(
        { status: 200, body: { evaluation: null, history: [] } },
        { status: 200, body: { evaluation: { id: 'b', s: 55 } } },
      );
      const result = await runRlsEndpoint(
        emptyOkEp,
        {
          base: 'http://csharp.local',
          orgAToken: 'org-a-token',
          orgBToken: 'org-b-token',
          orgBResourceId: 'org-b-team-id',
        },
        fake,
      );
      expect(result.ok).toBe(true);
      expect(result.inconclusive).toBeFalsy();
    });

    it('ok:false fail-closed when orgBResourceId is missing', async () => {
      const fake = vi.fn();
      const result = await runRlsEndpoint(idScopedEp, { base: 'http://csharp.local', orgAToken: 'org-a-token' }, fake);
      expect(result.ok).toBe(false);
      expect(result.detail).toBe('rls: idScopeKey set but no orgBResourceId provided');
      expect(fake).not.toHaveBeenCalled();
    });
  });

  describe('Mode B — org-scoped endpoint (idScopeKey not set)', () => {
    it('ok:true when both orgs get 200 with DIFFERENT non-empty bodies', async () => {
      const fake = vi.fn(async (_base: string, _path: string, token: string) =>
        token === 'org-a-token' ? { status: 200, body: { openRoles: 3 } } : { status: 200, body: { openRoles: 7 } },
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

    it('ok:true + inconclusive:true when both orgs get an IDENTICAL k-anonymity-suppressed payload (not a leak)', async () => {
      const fake = vi.fn().mockResolvedValue({ status: 200, body: { groups: [], suppressed: true } });
      const result = await runRlsEndpoint(
        orgScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBToken: 'org-b-token' },
        fake,
      );
      expect(result.ok).toBe(true);
      expect(result.inconclusive).toBe(true);
      expect(result.detail).toContain('inconclusive');
      expect(result.detail).toContain('k-anonymity-suppressed');
    });

    it('ok:false when both orgs get an IDENTICAL non-empty payload that is NOT suppressed (still a real leak)', async () => {
      // Regression guard: a shape that merely HAS a `suppressed` key set to false (or any
      // non-true value) must still hit the normal identical-non-empty leak check — only
      // `suppressed === true` gets the k-anonymity carve-out.
      const fake = vi
        .fn()
        .mockResolvedValue({ status: 200, body: { groups: [{ key: 'female', count: 42 }], suppressed: false } });
      const result = await runRlsEndpoint(
        orgScopedEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBToken: 'org-b-token' },
        fake,
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('cross-tenant');
    });

    it('ok:false fail-closed when either response is not 200', async () => {
      const fake = vi.fn(async (_base: string, _path: string, token: string) =>
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
      const result = await runRlsEndpoint(orgScopedEp, { base: 'http://csharp.local', orgAToken: 'org-a-token' }, fake);
      expect(result.ok).toBe(false);
      expect(result.detail).toBe('rls: org-scoped check needs orgBToken');
      expect(fake).not.toHaveBeenCalled();
    });
  });

  describe('globalScope — non-tenant endpoint (e.g. /billing/config)', () => {
    const globalEp: EndpointDef = {
      name: 'config',
      csharpPath: '/billing/config',
      tsProcedure: 'billing.getBillingConfig',
      input: {},
      globalScope: true,
      expectedByRole: { super_admin: 200, hr_admin: 403, hrbp: 403 },
    };

    it('short-circuits to inconclusive N/A WITHOUT probing (identical cross-org payloads are correct, not a leak)', async () => {
      const fake = vi.fn();
      const result = await runRlsEndpoint(
        globalEp,
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBToken: 'org-b-token' },
        fake,
      );
      expect(result.ok).toBe(true);
      expect(result.inconclusive).toBe(true);
      expect(result.detail).toContain('globalScope');
      // The whole point: a global endpoint returning the SAME body to both orgs must
      // never reach Mode B's identical-non-empty "leak" branch — so no call is made.
      expect(fake).not.toHaveBeenCalled();
    });

    it('globalScope takes precedence over idScopeKey (Mode A also skipped)', async () => {
      const fake = vi.fn();
      const result = await runRlsEndpoint(
        { ...globalEp, idScopeKey: 'irrelevant' },
        { base: 'http://csharp.local', orgAToken: 'org-a-token', orgBResourceId: 'org-b-id' },
        fake,
      );
      expect(result.ok).toBe(true);
      expect(result.inconclusive).toBe(true);
      expect(fake).not.toHaveBeenCalled();
    });
  });
});
