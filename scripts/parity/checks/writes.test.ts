import { describe, it, expect, vi } from 'vitest';
import { runWriteParity, runWriteIdor, runWriteRbac, type Readback, type CallWrite } from './writes';
import type { WriteEndpointDef, WriteResolved } from '../write-surfaces';

const res: WriteResolved = {
  base: 'http://csharp.local',
  userIdByRole: { super_admin: 'super-a', hr_admin: 'hr-a', hrbp: 'hrbp-a' },
  subjectA: 'subj-a',
  subjectB: 'subj-b',
  resourceA: 'res-a',
  resourceB: 'res-b',
};

// Minimal endpoint whose goldens are trivially controllable for the runner tests.
const baseEp: WriteEndpointDef = {
  name: 'ep',
  method: 'POST',
  buildParity: (r) => ({ path: `/x/${r.resourceA}`, body: { u: r.subjectA } }),
  buildIdor: (r) => ({ path: `/x/${r.resourceB}`, body: { u: r.subjectB } }),
  expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
  expectResponse: (b) => ((b as any)?.status === 'ok' ? null : 'bad status'),
  readbackMutated: () => ({ sql: 'SELECT 1', params: [], expect: (rows) => (rows.length === 1 ? null : 'not mutated') }),
  readbackNoMutation: () => ({ sql: 'SELECT n', params: [], expect: (rows) => ((rows[0] as any)?.n === 0 ? null : 'MUTATED') }),
};

describe('runWriteParity', () => {
  it('PASS on 200 + matching response + matching read-back', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 200, body: { status: 'ok', id: 'new-1' } }));
    const rb: Readback = vi.fn(async () => [{ any: 1 }]);
    const r = await runWriteParity(baseEp, res, 'probe-tok', call, rb);
    expect(r).toEqual({ check: 'write-parity', endpoint: 'ep', ok: true });
    expect(call).toHaveBeenCalledWith('http://csharp.local', 'POST', '/x/res-a', 'probe-tok', { u: 'subj-a' });
  });

  it('FAIL when status is not 200', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 403, body: 'no' }));
    const r = await runWriteParity(baseEp, res, 't', call, vi.fn());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('expected 200');
  });

  it('FAIL when the response shape is wrong', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 200, body: { status: 'nope' } }));
    const r = await runWriteParity(baseEp, res, 't', call, vi.fn(async () => [{}]));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('response mismatch');
  });

  it('FAIL when the DB read-back does not match the golden', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 200, body: { status: 'ok', id: 'x' } }));
    const rb: Readback = vi.fn(async () => []); // readbackMutated expects 1 row
    const r = await runWriteParity(baseEp, res, 't', call, rb);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('db read-back mismatch');
  });
});

describe('runWriteIdor', () => {
  const unchanged: Readback = async () => [{ n: 0 }];

  it('PASS when org-A → org-B write is 403 and org-B unchanged', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 403, body: null }));
    const r = await runWriteIdor(baseEp, res, 'orgA-probe', call, unchanged);
    expect(r).toEqual({ check: 'write-idor', endpoint: 'ep', ok: true });
    expect(call).toHaveBeenCalledWith('http://csharp.local', 'POST', '/x/res-b', 'orgA-probe', { u: 'subj-b' });
  });

  it('PASS when denied via 404 and org-B unchanged', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 404, body: null }));
    const r = await runWriteIdor(baseEp, res, 't', call, unchanged);
    expect(r.ok).toBe(true);
  });

  it('FAIL (write leak) when the cross-org write returns 200', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 200, body: { status: 'ok' } }));
    const r = await runWriteIdor(baseEp, res, 't', call, unchanged);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('WRITE LEAK');
  });

  it('FAIL closed on an unexpected status (e.g. 500)', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 500, body: null }));
    const r = await runWriteIdor(baseEp, res, 't', call, unchanged);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('cannot confirm isolation');
  });

  it('FAIL when denied (403) BUT a read-back shows the org-B row WAS mutated', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 403, body: null }));
    const mutated: Readback = async () => [{ n: 1 }];
    const r = await runWriteIdor(baseEp, res, 't', call, mutated);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('BUT');
    expect(r.detail).toContain('MUTATED');
  });
});

describe('runWriteRbac', () => {
  const unchanged: Readback = async () => [{ n: 0 }];

  it('by default runs only the DENY roles (403) — allow roles skipped when not allowRolesLiveTestable', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 403, body: null }));
    const results = await runWriteRbac(baseEp, res, { super_admin: 's', hr_admin: 'h', hrbp: 'hb' }, 'super_admin', call, unchanged);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ check: 'write-rbac', endpoint: 'ep', role: 'hrbp', ok: true });
    // exactly one write attempted (hrbp); the probe + a non-live-testable allow role are skipped.
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('http://csharp.local', 'POST', '/x/res-a', 'hb', { u: 'subj-a' });
  });

  it('FAIL when a deny role is NOT denied (got 200 instead of 403)', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 200, body: { status: 'ok' } }));
    const results = await runWriteRbac(baseEp, res, { hrbp: 'hb' }, 'super_admin', call, unchanged);
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain('expected 403');
  });

  it('FAIL when denied (403) BUT the org-A row was mutated', async () => {
    const call: CallWrite = vi.fn(async () => ({ status: 403, body: null }));
    const mutated: Readback = async () => [{ n: 1 }];
    const results = await runWriteRbac(baseEp, res, { hrbp: 'hb' }, 'super_admin', call, mutated);
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain('MUTATED');
  });

  it('FAIL closed when a deny role has no token', async () => {
    const call: CallWrite = vi.fn();
    const results = await runWriteRbac(baseEp, res, {}, 'super_admin', call, unchanged);
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain('no token');
    expect(call).not.toHaveBeenCalled();
  });

  describe('allowRolesLiveTestable (e.g. create) — the non-probe allow grant is exercised', () => {
    const allowEp: WriteEndpointDef = {
      ...baseEp,
      allowRolesLiveTestable: true,
      readbackAllow: (_r, role) => ({ sql: 'SELECT id', params: [role], expect: (rows) => ((rows[0] as any)?.made ? null : `role ${role} did not write`) }),
    };

    it('live-tests a non-probe allow role (hr_admin 200) but NOT the probe (covered by light-parity)', async () => {
      const call: CallWrite = vi.fn(async (_b, _m, _p, token) => (token === 'hb' ? { status: 403, body: null } : { status: 200, body: { status: 'ok' } }));
      // deny no-mutation reads 'SELECT n' (expects {n:0}); allow reads 'SELECT id' (expects {made:true}).
      const rb: Readback = async (sql) => (sql === 'SELECT id' ? [{ made: true }] : [{ n: 0 }]);
      const results = await runWriteRbac(allowEp, res, { super_admin: 's', hr_admin: 'h', hrbp: 'hb' }, 'super_admin', call, rb);
      const roles = results.map((r) => r.role).sort();
      expect(roles).toEqual(['hr_admin', 'hrbp']); // probe (super_admin) skipped
      expect(results.every((r) => r.ok)).toBe(true);
    });

    it('FAIL when a non-probe allow role is wrongly DENIED (403 instead of 200)', async () => {
      const call: CallWrite = vi.fn(async (_b, _m, _p, token) => (token === 'h' ? { status: 403, body: null } : { status: 403, body: null }));
      const results = await runWriteRbac(allowEp, res, { hr_admin: 'h' }, 'super_admin', call, unchanged);
      expect(results[0].ok).toBe(false);
      expect(results[0].detail).toContain('allow role expected 200');
    });

    it('FAIL when the allow role got 200 but the read-back shows it did not actually write', async () => {
      const call: CallWrite = vi.fn(async () => ({ status: 200, body: { status: 'ok' } }));
      const rb: Readback = async () => [{ made: false }];
      const results = await runWriteRbac(allowEp, res, { hr_admin: 'h' }, 'super_admin', call, rb);
      expect(results[0].ok).toBe(false);
      expect(results[0].detail).toContain('did not write');
    });
  });
});
