import { describe, it, expect } from 'vitest';
import { SURFACES } from './surfaces';

describe('SURFACES', () => {
  // 2026-08-03 (#58): was "the three read surfaces" — succession dropped out when its last
  // TS-backed endpoint (getCriticalRole) was deleted. See the dedicated assertion at the bottom.
  it('compensation + ninebox are registered with their flags + current endpoint sets (Tier-1 + Tier-2 by-id)', () => {
    expect(SURFACES['compensation'].flag).toBe('Platform__CompensationReadEnabled');
    // 2026-07-29: shrunk from 7 to 2 — the other 5 TS procedures were deleted (C#-only now).
    expect(SURFACES['compensation'].endpoints.map((e) => e.name).sort()).toEqual(['employee', 'market-comparison']);
    expect(SURFACES['ninebox'].flag).toBe('Platform__NineBoxReadEnabled');
    expect(SURFACES['ninebox'].endpoints).toHaveLength(4);
    for (const key of ['compensation', 'ninebox']) {
      expect(SURFACES[key].probeRole).toBe('super_admin');
    }
  });

  // 2026-08-05 (#59): compensation's last 2 TS procedures (getMarketComparison / getEmployeeComp) were
  // deleted with the whole router, so both endpoints lose `tsProcedure` — parity cannot run for them.
  // The surface is KEPT so `rls` + `rbac` (C#-only checks) keep covering the two live C# routes,
  // including the Mode-A cross-tenant IDOR probe on /compensation/employee/{id}. Removing it — the
  // billing-invoices / succession-read precedent — would have thrown that coverage away silently.
  it('compensation has NO TS side left (parity cannot run) but keeps its RLS + RBAC coverage', () => {
    const s = SURFACES['compensation'];
    for (const e of s.endpoints) expect(e.tsProcedure, e.name).toBeUndefined();
    // the by-id IDOR probe survives...
    expect(s.endpoints.find((e) => e.name === 'employee')?.idScopeKey).toBe('employee');
    // ...as does every RBAC expectation, so `verify compensation` is not a no-op.
    for (const e of s.endpoints) expect(Object.keys(e.expectedByRole).length, e.name).toBeGreaterThan(0);
  });

  // Every OTHER registered endpoint must still carry a tsProcedure — `tsProcedure` being optional is
  // an escape hatch for a deleted TS side, not a licence to register a C#-only endpoint and call the
  // resulting one-sided run "parity".
  it('no surface other than compensation has a tsProcedure-less endpoint', () => {
    const missing: string[] = [];
    for (const [key, surface] of Object.entries(SURFACES)) {
      if (key === 'compensation') continue;
      for (const ep of surface.endpoints) if (!ep.tsProcedure) missing.push(`${key}/${ep.name}`);
    }
    expect(missing).toEqual([]);
  });

  it('every Tier-2 by-id endpoint sets idScopeKey and carries the {id} sentinel in path + input', () => {
    // The 2 by-id Mode-A IDOR endpoints and the resource key each threads.
    // 2026-08-03 (#58): 'succession/critical-role' → 'critical-role' removed with the surface.
    const expected: Record<string, string> = {
      'compensation/employee': 'employee',
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
});
