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

  // 2026-08-05 (#59): this used to assert `allGreen === true` and called it a "vacuous pass" in its
  // own name. `allGreen` IS the process exit code (cli.ts cmdCheck/cmdVerifyWrite), so a surface that
  // produced no checks exited 0 with a clean summary — "nothing ran" was indistinguishable from
  // "everything passed". Zero results is now a FAILURE that says so.
  it('empty results: allGreen FALSE and the text says no checks ran', () => {
    const r = renderReport([]);
    expect(r.allGreen).toBe(false);
    expect(r.text).toContain('NO CHECKS RAN');
    expect(r.text).toContain('NOT a pass');
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

  it('still renders [PASS] (not [WEAK]) for a strong, non-inconclusive rls pass', () => {
    const r = renderReport([{ check: 'rls', endpoint: 'k', ok: true }]);
    expect(r.text).toContain('[PASS]');
    expect(r.text).not.toContain('[WEAK]');
  });
});
