/**
 * Offline tests for scripts/security/rls-probe.ts and scripts/security/db-tls.ts (#292 tier-3 findings).
 *
 * The probe loop is driven against a RECORDING fake, so the order of GUC changes, role switches and
 * counts is pinned without a database: the positive control must count with the probe org selected,
 * the GUC must be cleared BEFORE the role switch, and a non-zero count as the probe role is FAILS-OPEN.
 */
import { describe, expect, it } from 'vitest';
import { checkVerifyFull, pgClientConfig } from '../../scripts/security/db-tls';
import {
  DEFAULT_MIN_PROBED,
  DEFAULT_PROBE_ROLE,
  probeOrgIdProblem,
  resolveMinProbed,
  resolveProbeRole,
  runEmpiricalProbe,
  type Queryable,
} from '../../scripts/security/rls-probe';

const ORG = '22222222-2222-4222-8222-222222222222';

/** Fake: `counts[table] = [asConnectingRole, asProbeRole]`. Records every statement with its params. */
function fakeDb(counts: Record<string, [number, number]>) {
  const log: string[] = [];
  let role: 'connect' | 'probe' = 'connect';
  let guc = '';
  const db: Queryable = {
    async query<R>(text: string, values?: unknown[]) {
      log.push(values ? `${text} ${JSON.stringify(values)}` : text);
      if (text.startsWith('SET LOCAL ROLE')) role = 'probe';
      else if (text === 'RESET ROLE') role = 'connect';
      else if (text.includes('set_config')) guc = values ? String(values[0]) : '';
      const m = /FROM "((?:[^"]|"")+)"/.exec(text);
      if (m) {
        const table = m[1].replace(/""/g, '"');
        if (role === 'probe' && guc !== '') throw new Error('probe ran with the org GUC still set');
        const n = counts[table][role === 'probe' ? 1 : 0];
        return { rows: [{ n: String(n) }] as R[] };
      }
      return { rows: [] as R[] };
    },
  };
  return { db, log };
}

describe('runEmpiricalProbe', () => {
  it('uses the probe org as the positive control, then clears it before assuming the probe role', async () => {
    const { db, log } = fakeDb({ a: [3, 0], b: [0, 0] });
    const r = await runEmpiricalProbe(db, ['a', 'b'], { probeOrgId: ORG, probeRole: DEFAULT_PROBE_ROLE });
    expect(r).toEqual({ probed: 1, findings: [] });
    const a = log.findIndex((l) => l.includes('FROM "a"'));
    expect(log[a - 1]).toContain(JSON.stringify([ORG])); // org selected for the positive count
    expect(log[a + 1]).toBe(`SELECT set_config('app.current_org_id', '', true)`); // cleared before the role switch
    expect(log[a + 2]).toBe('SET LOCAL ROLE "ci_rls_probe"');
    expect(log.some((l) => l.includes('app_tenant'))).toBe(false);
  });

  it('skips tables empty for the probe tenant without assuming the role', async () => {
    const { db, log } = fakeDb({ empty: [0, 0] });
    const r = await runEmpiricalProbe(db, ['empty'], { probeOrgId: ORG, probeRole: 'ci_rls_probe' });
    expect(r.probed).toBe(0);
    expect(log.some((l) => l.startsWith('SET LOCAL ROLE'))).toBe(false);
  });

  it('reports FAILS-OPEN when the probe role sees rows with no org selected', async () => {
    const { db } = fakeDb({ leaky: [5, 5] });
    const r = await runEmpiricalProbe(db, ['leaky'], { probeOrgId: ORG, probeRole: 'ci_rls_probe' });
    expect(r.findings).toEqual([expect.objectContaining({ check: 'FAILS-OPEN' })]);
    expect(r.findings[0].detail).toMatch(/ci_rls_probe with NO org GUC sees 5 of 5/);
  });

  it('without a probe org, never sets a non-empty GUC (BYPASSRLS local runs)', async () => {
    const { db, log } = fakeDb({ a: [2, 0] });
    await runEmpiricalProbe(db, ['a'], { probeRole: 'app_tenant' });
    expect(log.filter((l) => l.includes('set_config')).every((l) => l.includes("''"))).toBe(true);
  });

  it('quotes table names containing a double quote', async () => {
    const { db, log } = fakeDb({ 'we"ird': [0, 0] });
    await runEmpiricalProbe(db, ['we"ird'], { probeRole: 'ci_rls_probe' });
    expect(log.some((l) => l.includes('FROM "we""ird"'))).toBe(true);
  });

  it('propagates a SET ROLE failure instead of swallowing it (caller maps it to exit 2)', async () => {
    const db: Queryable = {
      async query<R>(text: string) {
        if (text.startsWith('SET LOCAL ROLE')) throw new Error('permission denied to set role "ci_rls_probe"');
        return { rows: (text.includes('count(*)') ? [{ n: '1' }] : []) as R[] };
      },
    };
    await expect(runEmpiricalProbe(db, ['a'], { probeRole: 'ci_rls_probe' })).rejects.toThrow(/permission denied/);
  });
});

describe('env resolution', () => {
  it('RLS_PROBE_ORG_ID: absent ok, UUID ok, anything else refused', () => {
    expect(probeOrgIdProblem(undefined)).toBeNull();
    expect(probeOrgIdProblem(ORG)).toBeNull();
    expect(probeOrgIdProblem('abc')).toMatch(/valid organization UUID/);
    expect(probeOrgIdProblem(`${ORG}' OR 1=1`)).toMatch(/valid organization UUID/);
  });
  it('RLS_MIN_PROBED defaults to 30 and rejects non-integers', () => {
    expect(resolveMinProbed(undefined)).toEqual({ min: DEFAULT_MIN_PROBED });
    expect(DEFAULT_MIN_PROBED).toBe(30);
    expect(resolveMinProbed('36')).toEqual({ min: 36 });
    for (const bad of ['-1', '3.5', 'abc', '99999']) expect(resolveMinProbed(bad)).toHaveProperty('problem');
  });
  it('RLS_PROBE_ROLE defaults to ci_rls_probe and rejects anything but a plain identifier', () => {
    expect(resolveProbeRole(undefined)).toEqual({ role: 'ci_rls_probe' });
    expect(resolveProbeRole('app_tenant')).toEqual({ role: 'app_tenant' });
    expect(resolveProbeRole('Bad"Role')).toHaveProperty('problem');
  });
});

describe('db-tls', () => {
  const remote = (q: string) => `postgresql://u:pw@db.example.invalid:5432/postgres${q}`;
  it('accepts only verify-full for remote hosts', () => {
    expect(checkVerifyFull(remote('?sslmode=verify-full'))).toEqual({ ok: true, loopback: false });
    for (const q of ['', '?sslmode=require', '?sslmode=prefer', '?sslmode=verify-ca', '?sslmode=disable']) {
      const v = checkVerifyFull(remote(q));
      expect(v.ok, q).toBe(false);
      if (!v.ok) expect(v.reason).not.toMatch(/pw|example/);
    }
  });
  it('refuses duplicated sslmode and non-URI strings', () => {
    expect(checkVerifyFull(remote('?sslmode=verify-full&sslmode=disable')).ok).toBe(false);
    expect(checkVerifyFull('host=db user=u sslmode=verify-full').ok).toBe(false);
  });
  it('exempts loopback unless strict', () => {
    expect(checkVerifyFull('postgresql://u@127.0.0.1:1/x').ok).toBe(true);
    expect(checkVerifyFull('postgresql://u@localhost:1/x', { allowLoopback: false }).ok).toBe(false);
  });
  it('builds an explicit rejectUnauthorized config and strips ssl* URL params', () => {
    const cfg = pgClientConfig(remote('?sslmode=verify-full&sslrootcert=/x&application_name=n'), {});
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
    expect(cfg.connectionString).not.toMatch(/ssl/);
    expect(cfg.connectionString).toMatch(/application_name=n/);
    const withCa = pgClientConfig(remote('?sslmode=verify-full'), { PGSSLROOTCERT: 'scripts/parity/supabase-root-ca.pem' });
    expect(withCa.ssl).toMatchObject({ rejectUnauthorized: true, ca: expect.stringContaining('BEGIN CERTIFICATE') });
    expect(() => pgClientConfig(remote('?sslmode=require'), {})).toThrow(/verify-full/);
  });
});
