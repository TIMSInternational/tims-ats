import { describe, it, expect } from 'vitest';
import { SURFACES } from './surfaces';

describe('SURFACES', () => {
  // 2026-08-03 (#58): was "the three read surfaces" — succession dropped out when its last
  // TS-backed endpoint (getCriticalRole) was deleted. 2026-08-05 (#57): ninebox dropped out the same
  // way (its last 4 TS-backed endpoints deleted with the whole router). See the dedicated assertions
  // at the bottom. compensation is now the only talent read surface with a TS side left.
  it('the one read surface that still has a TS side is registered with its flag + current endpoint set (Tier-1 + Tier-2 by-id)', () => {
    expect(SURFACES['compensation'].flag).toBe('Platform__CompensationReadEnabled');
    // 2026-07-29: shrunk from 7 to 2 — the other 5 TS procedures were deleted (C#-only now).
    expect(SURFACES['compensation'].endpoints.map((e) => e.name).sort()).toEqual(['employee', 'market-comparison']);
    expect(SURFACES['compensation'].probeRole).toBe('super_admin');
  });

  it('every Tier-2 by-id endpoint sets idScopeKey and carries the {id} sentinel in path + input', () => {
    // The by-id Mode-A IDOR endpoints and the resource key each threads.
    // 2026-08-03 (#58): 'succession/critical-role' removed with the surface.
    // 2026-08-05 (#57): 'ninebox/axis-breakdown' RETAINED — its TS side went, the endpoint did not.
    const expected: Record<string, string> = {
      'compensation/employee': 'employee',
      // C#-only after #57 (no tsProcedure), but STILL by-id and still the surface's cross-tenant
      // IDOR probe — which is exactly why the nine-box surface was kept rather than deleted.
      'ninebox/axis-breakdown': 'employee',
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
    expect(byIdCount).toBe(2);
  });

  // Kept surface-agnostic (rather than nine-box-specific) so it keeps applying as surfaces come and
  // go. NOTE: for a few hours on 2026-08-05 the nine-box surface was deleted and this loop iterated
  // ZERO times while still reading as a live guard — an assertion that cannot run is not a guard.
  // The count pin at the bottom is what makes that visible.
  it('every globalScope endpoint is a pure kernel — no by-id endpoint may claim org-independence', () => {
    let seen = 0;
    for (const [key, surface] of Object.entries(SURFACES)) {
      for (const ep of surface.endpoints) {
        if (!ep.globalScope) continue;
        seen++;
        // globalScope INVERTS the RLS Mode-B heuristic, so it must never be set on an endpoint that
        // reads per-org rows by id — that would silently disable the leak check for it.
        expect(ep.idScopeKey, `${key}/${ep.name} is globalScope AND by-id`).toBeUndefined();
      }
    }
    // Documented state, 4 endpoints across 2 surfaces. The loop above is the invariant; this pins the
    // count so a NEW globalScope endpoint has to be looked at deliberately — and so that the loop
    // going empty (which would make the invariant unenforced while still reading as enforced) fails
    // here.
    //
    //   nine-box simulate + quadrant-plan — PURE KERNELS. Org-independent computation; the original
    //     and still the paradigm case for this flag.
    //   organization kpis + list — PLATFORM-OWNER CROSS-ORG READS (#195, added 2026-08-10). A
    //     different justification for the same flag, and worth stating so it is not read as
    //     precedent for the kernel case: these DO read org data, but the surface is
    //     platformProcedure/PlatformOwnerGate over the unscoped `db`, so there is no per-caller
    //     tenant boundary and Mode B's identical-payload heuristic would fire on the correct
    //     behaviour. `list` enumerates every tenant by definition. RBAC (org_admin 403 on both) is
    //     what proves the boundary here, not RLS.
    //
    // Neither of the two new ones is by-id, so the invariant above still bites for them unchanged —
    // `getOrganization` was left unregistered rather than weaken it (see surfaces.ts).
    expect(seen).toBe(4);
  });

  // ── #195 AC1: the monitoring read surface (2026-08-10) ───────────────────────────────────────
  it('monitoring registers all 6 deployed routes', () => {
    const s = SURFACES['monitoring'];
    expect(s.flag).toBe('Platform__MonitoringReadEnabled');
    // Counted from MonitoringReadEndpoints.cs, not taken from #195's text. If a 7th route ships, this
    // is where the omission surfaces.
    expect(s.endpoints.map((e) => e.name)).toEqual([
      'executive-kpis',
      'module-health',
      'alerts',
      'action-plan-alerts',
      'cross-module-trend',
      'alert-rules',
    ]);
    // probeRole must be a role with a REAL org-wide grant, not super_admin — super_admin bypasses the
    // permission kernel, so probing with it would never exercise a grant.
    expect(s.probeRole).toBe('hr_admin');
    expect(s.roles).toContain(s.probeRole);
  });

  it('monitoring keeps a DENIED role, or its RBAC check proves nothing', () => {
    // All three normally-granted roles expect 200 here (MonitoringStaffGate deliberately does not
    // force the org gate, so hrbp@unit is 200 too). Without org_admin — which is absent from MATRIX
    // and holds no grants — every RBAC assertion on this surface would be "200 means allowed", with
    // nothing proving the permission check can say no.
    const s = SURFACES['monitoring'];
    for (const ep of s.endpoints) {
      const denied = Object.entries(ep.expectedByRole).filter(([, v]) => v === 403);
      expect(denied.map(([r]) => r), `${ep.name} has no denied role`).toEqual(['org_admin']);
    }
  });

  it('monitoring runs REAL RLS — nothing globalScope, nothing by-id', () => {
    // These are org-scoped aggregates, so Mode B is the meaningful check. globalScope or idScopeKey
    // here would silently downgrade it to N/A or to an IDOR probe that does not apply.
    for (const ep of SURFACES['monitoring'].endpoints) {
      expect(ep.globalScope, ep.name).toBeUndefined();
      expect(ep.idScopeKey, ep.name).toBeUndefined();
    }
  });

  // ── #195: the platform-organizations read surface (2026-08-10) ───────────────────────────────
  it('organization is registered with its flag + the 3 reads, minus the by-id detail', () => {
    const s = SURFACES['organization'];
    expect(s.flag).toBe('Platform__PlatformOrganizationsReadEnabled');
    expect(s.roles).toEqual(['platform_owner', 'org_admin']);
    // org-scoped probe role: a platform owner is org-less and has no org-B counterpart to probe with.
    expect(s.probeRole).toBe('org_admin');

    expect(s.endpoints.map((e) => e.name)).toEqual(['kpis', 'list']);

    for (const ep of s.endpoints) {
      // Both flags still dark, TS still the live path — so every endpoint MUST keep a tsProcedure and
      // produce a real byte diff. A [WEAK] here would mean the pre-flip readiness check proves nothing.
      expect(ep.tsProcedure, ep.name).toBeTruthy();
      // RBAC is the boundary proof on a platform-owner surface, since RLS is N/A.
      expect(ep.expectedByRole, ep.name).toEqual({ platform_owner: 200, org_admin: 403 });
      expect(ep.globalScope, ep.name).toBe(true);
    }
  });

  it('getOrganization stays UNregistered until a by-id platform-owner endpoint can be expressed', () => {
    // Pins a DELIBERATE omission so it reads as a decision, not an oversight. Registering it needs a
    // real org id in `{id}` AND no Mode-A IDOR probe; the only way to express the second today is
    // `globalScope`, which the invariant above forbids combining with `idScopeKey` — correctly, since
    // that flag means "pure kernel", not "no tenant boundary for this caller". Overloading it would
    // silently disable a genuine IDOR probe on some future surface.
    const names = SURFACES['organization'].endpoints.map((e) => e.name);
    expect(names).not.toContain('detail');
    expect(SURFACES['organization'].endpoints.some((e) => e.idScopeKey)).toBe(false);
  });

  // ── Coverage-audit additions (2026-07-27) ────────────────────────────────────────────────────
  it('engagement is registered with its flag + the 2 reads that still have a TS side', () => {
    const s = SURFACES['engagement'];
    expect(s.flag).toBe('Platform__EngagementReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    // UPDATE 2026-07-31: shrunk from 9 to 2 — the other 7 TS procedures were deleted (C#-only now,
    // NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed live in prod).
    expect(s.endpoints.map((e) => e.name).sort()).toEqual(['rotation-risk', 'surveys']);
    // neither surviving engagement read is by-id.
    for (const e of s.endpoints) expect(e.idScopeKey).toBeUndefined();
  });

  it('engagement: listSurveys (grant-only) passes hrbp; getRotationRisk (org-rollup) denies hrbp', () => {
    const s = SURFACES['engagement'];
    expect(s.endpoints.find((e) => e.name === 'surveys')?.expectedByRole['hrbp']).toBe(200);
    expect(s.endpoints.find((e) => e.name === 'rotation-risk')?.expectedByRole['hrbp']).toBe(403);
    // super_admin/hr_admin allow everywhere.
    for (const e of s.endpoints) {
      expect(e.expectedByRole['super_admin'], e.name).toBe(200);
      expect(e.expectedByRole['hr_admin'], e.name).toBe(200);
    }
  });

  // dei's READ surface was registered 2026-07-27 and shrunk 10 → 2 on 2026-07-31. On 2026-08-06
  // (#60) its last two TS procedures (dei.getEthnicityDistribution / dei.getDisabilityDistribution)
  // were deleted from packages/api/src/routers/dei.ts. This is the INVERSION of the previous
  // 'dei is registered with its flag + the 2 zero-FE-consumer reads' test — the endpoint set and
  // RBAC expectations are still pinned BY NAME (a deletion must not be a green change), but the
  // TS-side assertion flips from "registered" to "must be absent".
  //
  // The surface is deliberately NOT removed: per EndpointDef.tsProcedure's contract, omitting the
  // field keeps the endpoint C#-only so parity reports [WEAK] rather than silently passing, while
  // the RBAC (hrbp 403) and RLS cross-org checks keep running against the live C# demographic
  // reads. This test is what stops a future cleanup from deleting the surface and taking that
  // coverage with it.
  it('dei stays registered as C#-only after the #60 TS deletion — endpoints pinned, tsProcedure gone', () => {
    const s = SURFACES['dei'];
    expect(s, 'the dei surface must NOT be deleted — removing it retires the C# RBAC + RLS checks').toBeDefined();
    expect(s.flag).toBe('Platform__DeiReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    // Pinned by name, not auto-discovered: dropping an endpoint must turn this red.
    expect(s.endpoints.map((e) => e.name).sort()).toEqual(['disability-distribution', 'ethnicity-distribution']);
    // pay-equity is deliberately excluded (separate Platform__FxReadsEnabled flag).
    expect(s.endpoints.find((e) => e.name === 'pay-equity')).toBeUndefined();
    for (const e of s.endpoints) {
      expect(e.expectedByRole, e.name).toEqual({ super_admin: 200, hr_admin: 200, hrbp: 403 });
      // #60: no TS side left to diff against — a re-added tsProcedure would mean a second live
      // implementation of a k-anonymity-sensitive aggregate.
      expect(e.tsProcedure, `${e.name} must have no tsProcedure after the #60 TS deletion`).toBeUndefined();
    }
  });

  // No OTHER surface may smuggle a dei TS read back in under a different key.
  it('no surface anywhere registers a dei tsProcedure (#60)', () => {
    for (const [key, surface] of Object.entries(SURFACES)) {
      for (const ep of surface.endpoints) {
        expect(ep.tsProcedure?.startsWith('dei.') ?? false, `${key}/${ep.name} re-registers a TS dei read`).toBe(false);
      }
    }
  });

  // billing-invoices' SURFACES entry was removed 2026-07-31 (TS listInvoices/getInvoice deleted,
  // NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP confirmed live) — no TS side left to diff against, so
  // there is nothing left for this suite to assert about it.
  it('billing-invoices is no longer registered (TS side deleted)', () => {
    expect(SURFACES['billing-invoices']).toBeUndefined();
  });

  // succession's READ surface was removed 2026-08-03 (#58): its last TS-backed endpoint
  // (getCriticalRole) was deleted along with the whole succession router, so there is no TS side
  // left to diff against. `verify succession` is now a no-op — the WRITE surface is unaffected
  // (write-surfaces.ts hits C# directly and never used a tsProcedure).
  // The WRITE surface is unaffected and keeps its own assertion in write-surfaces.test.ts
  // ('registers the 5 succession writes under the single write flag') — not duplicated here.
  it('succession read is no longer registered (TS side deleted)', () => {
    expect(SURFACES['succession']).toBeUndefined();
  });

  // nine-box's TS side was deleted 2026-08-05 (#57) — but unlike succession above, the SURFACE is
  // retained, C#-only. Only checks/parity.ts reads `tsProcedure`; checks/rls.ts and checks/rbac.ts
  // take `callCsharp` alone. So deleting the surface would not have retired a stale TS comparison,
  // it would have retired the RLS Mode-A cross-tenant IDOR probe on `axis-breakdown` and the RBAC
  // deny assertions. Those cover the 4 endpoints registered below, not all 11 deployed C# reads —
  // see the scope note in surfaces.ts. `axis-breakdown` has no cross-org C# integration test
  // (NineBoxReadTests.cs:240 covers getGrid, which is not registered here).
  //
  // This asserts the RETENTION, deliberately: the endpoints must stay registered AND must carry no
  // tsProcedure. A future cleanup that deletes the surface "because the TS is gone" fails here with
  // the reason attached.
  it('nine-box read stays registered as a C#-only surface (RLS/RBAC coverage survives TS deletion)', () => {
    const s = SURFACES['ninebox'];
    expect(s, 'nine-box read surface was deleted — that removes the cross-tenant IDOR probe').toBeDefined();
    expect(s!.endpoints.map((e) => e.name).sort()).toEqual([
      'axis-breakdown',
      'movement-history',
      'quadrant-plan',
      'simulate',
    ]);
    for (const ep of s!.endpoints) {
      expect(ep.tsProcedure, `${ep.name} must be C#-only — the TS router is deleted`).toBeUndefined();
    }
    // The IDOR probe specifically.
    const byId = s!.endpoints.find((e) => e.name === 'axis-breakdown')!;
    expect(byId.idScopeKey).toBe('employee');
    expect(byId.expectedByRole.hrbp).toBe(403);
  });
});
