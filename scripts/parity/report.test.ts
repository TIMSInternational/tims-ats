import { describe, it, expect } from 'vitest';
import { renderReport } from './report';

describe('renderReport', () => {
  it('allGreen true when every result ok', () => {
    const r = renderReport([{ check: 'parity', endpoint: 'k', ok: true }]);
    expect(r.allGreen).toBe(true);
    expect(r.text).toContain('PASS');
  });

  it('allGreen false + shows the failing endpoint', () => {
    const r = renderReport([{ check: 'rls', endpoint: 'k', ok: false, detail: 'cross-tenant leak' }]);
    expect(r.allGreen).toBe(false);
    expect(r.text).toContain('cross-tenant leak');
  });

  it('empty results: allGreen true (vacuous pass), text still renders', () => {
    const r = renderReport([]);
    expect(r.allGreen).toBe(true);
    expect(typeof r.text).toBe('string');
  });

  it('includes role in the line for rbac results', () => {
    const r = renderReport([
      {
        check: 'rbac',
        endpoint: 'dashboard-kpis',
        role: 'hrbp',
        ok: false,
        detail: "rbac: role 'hrbp' expected 403 but got 200",
      },
    ]);
    expect(r.text).toContain('hrbp');
    expect(r.text).toContain('FAIL');
  });

  it('mixed results: allGreen false when any single result fails', () => {
    const r = renderReport([
      { check: 'parity', endpoint: 'a', ok: true },
      { check: 'rbac', endpoint: 'b', role: 'super_admin', ok: true },
      { check: 'rls', endpoint: 'c', ok: false, detail: 'boom' },
    ]);
    expect(r.allGreen).toBe(false);
    expect(r.text).toContain('PASS');
    expect(r.text).toContain('FAIL');
    expect(r.text).toContain('boom');
  });

  it('renders [WEAK] + detail for an inconclusive ok:true rls result, not [PASS]', () => {
    const r = renderReport([
      {
        check: 'rls',
        endpoint: 'dashboard-kpis',
        ok: true,
        inconclusive: true,
        detail:
          'inconclusive: both orgs returned empty payloads — structural pass only, no cross-tenant data was compared',
      },
    ]);
    expect(r.allGreen).toBe(true); // still ok:true, not a failure
    expect(r.text).toContain('[WEAK]');
    expect(r.text).not.toContain('[PASS]');
    expect(r.text).toContain('inconclusive: both orgs returned empty payloads');
  });

  it('renders [WEAK] for an inconclusive PARITY result — a C#-only endpoint has nothing to compare', () => {
    const r = renderReport([
      {
        check: 'parity',
        endpoint: 'axis-breakdown',
        ok: true,
        inconclusive: true,
        detail: 'no tsProcedure registered — the TypeScript side of this surface was deleted',
      },
    ]);
    expect(r.text).toContain('[WEAK]');
    expect(r.text).not.toContain('[PASS]');
    // The reason must reach the operator: a bare WEAK is only marginally better than a bare PASS.
    expect(r.text).toContain('no tsProcedure');
    // ...and it is still not a failure — nothing broke, it just was not compared.
    expect(r.allGreen).toBe(true);
  });

  it('still renders [PASS] (not [WEAK]) for a strong, non-inconclusive rls pass', () => {
    const r = renderReport([{ check: 'rls', endpoint: 'k', ok: true }]);
    expect(r.text).toContain('[PASS]');
    expect(r.text).not.toContain('[WEAK]');
  });
});
