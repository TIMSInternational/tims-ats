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
    // 2026-08-05 (#57): 'ninebox/axis-breakdown' removed with the surface.
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
    // Documented state: nine-box's simulate + quadrant-plan are the only globalScope endpoints, and
    // both are pure kernels. The loop above is the invariant; this pins the count so a NEW
    // globalScope endpoint has to be looked at deliberately — and so that the loop going empty
    // (which would make the invariant unenforced while still reading as enforced) fails here.
    expect(seen).toBe(2);
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

  it('dei is registered with its flag + the 2 zero-FE-consumer reads, ALL grant-only (hrbp denied everywhere — no dei grant at all)', () => {
    const s = SURFACES['dei'];
    expect(s.flag).toBe('Platform__DeiReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    // 2026-07-31: shrunk from 10 to 2 — the other 8 TS procedures were deleted (C#-only now),
    // leaving only the two zero-FE-consumer procedures that were deliberately retained.
    expect(s.endpoints.map((e) => e.name).sort()).toEqual(['disability-distribution', 'ethnicity-distribution']);
    // pay-equity is deliberately excluded (separate Platform__FxReadsEnabled flag).
    expect(s.endpoints.find((e) => e.name === 'pay-equity')).toBeUndefined();
    for (const e of s.endpoints) {
      expect(e.expectedByRole, e.name).toEqual({ super_admin: 200, hr_admin: 200, hrbp: 403 });
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
  // deny assertions, against 11 C# endpoints that are still deployed. The C# integration tests do
  // not cover the cross-org dimension.
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
