/**
 * The empirical half of check 14 (verify-rls-isolation.ts), extracted so its control flow can be tested
 * offline against a recording fake — #292 tier-3 findings 3-5.
 *
 * WHICH ROLE PROBES, AND WHY NOT app_tenant ANY MORE
 * --------------------------------------------------
 * The probe used to `SET LOCAL ROLE app_tenant`. Postgres only allows that to a MEMBER of app_tenant, so
 * the nightly credential (ci_readonly) had to be granted app_tenant — and app_tenant holds INSERT/UPDATE/
 * DELETE on the tenant tables. A "read-only" CI credential that can assume a DML role is not read-only.
 *
 * The probe now assumes `ci_rls_probe` (scripts/db/ci-readonly-probe-role.sql): NOLOGIN, NOBYPASSRLS,
 * SELECT only. That is EQUIVALENT for this purpose only because every public-schema policy applies
 * `TO public` — a policy scoped to app_tenant alone would not bind ci_rls_probe, and the probe would stop
 * speaking for app_tenant. `verify-rls-isolation.ts` therefore asserts that scoping structurally
 * (finding `policy-role-scope`), so the equivalence is checked every night rather than assumed.
 */

export type Finding = { check: string; detail: string };

export interface Queryable {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

export const DEFAULT_PROBE_ROLE = 'ci_rls_probe';
export const DEFAULT_MIN_PROBED = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/** Returns the reason the value is unusable, or null. Absent is allowed (BYPASSRLS local runs). */
export function probeOrgIdProblem(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  return UUID_RE.test(value) ? null : 'RLS_PROBE_ORG_ID must be a valid organization UUID.';
}

export function resolveProbeRole(value: string | undefined): { role: string } | { problem: string } {
  const role = value && value !== '' ? value : DEFAULT_PROBE_ROLE;
  return ROLE_RE.test(role) ? { role } : { problem: 'RLS_PROBE_ROLE must be a plain lower-case role name.' };
}

/**
 * RLS_MIN_PROBED: the floor below which the empirical probe is too thin to certify anything. Coverage
 * fell 44 → 36 of 100 tables silently when the positive control moved to a single test tenant; a
 * silent fall to 3 would have printed the same ✓.
 */
export function resolveMinProbed(value: string | undefined): { min: number } | { problem: string } {
  if (value === undefined || value === '') return { min: DEFAULT_MIN_PROBED };
  if (!/^\d{1,4}$/.test(value)) return { problem: 'RLS_MIN_PROBED must be a non-negative integer.' };
  return { min: Number(value) };
}

/** Double-quote an identifier (a pg_class name may itself contain a double quote). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Caller owns the transaction: this must run between BEGIN and ROLLBACK, because every GUC and role
 * change below is LOCAL.
 *
 * Per table: (1) positive control — count rows as the CONNECTING role, with the probe org selected when
 * one is configured (a NOBYPASSRLS reader sees nothing otherwise); (2) clear the GUC; (3) assume the
 * probe role and count again. (3) must be zero: tenant isolation fails CLOSED.
 */
export async function runEmpiricalProbe(
  db: Queryable,
  candidates: readonly string[],
  opts: { probeOrgId?: string; probeRole: string },
): Promise<{ probed: number; findings: Finding[] }> {
  const findings: Finding[] = [];
  let probed = 0;
  const roleSql = quoteIdent(opts.probeRole);
  await db.query(`SELECT set_config('app.current_org_id', '', true)`);
  for (const relname of candidates) {
    const q = quoteIdent(relname);
    if (opts.probeOrgId) {
      await db.query(`SELECT set_config('app.current_org_id', $1, true)`, [opts.probeOrgId]);
    }
    const total = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${q}`);
    if (opts.probeOrgId) {
      await db.query(`SELECT set_config('app.current_org_id', '', true)`);
    }
    if (total.rows[0]?.n === '0') continue; // empty table proves nothing either way

    probed++;
    await db.query(`SET LOCAL ROLE ${roleSql}`);
    const seen = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${q}`);
    await db.query('RESET ROLE');

    if (seen.rows[0]?.n !== '0') {
      findings.push({
        check: 'FAILS-OPEN',
        detail: `${relname}: ${opts.probeRole} with NO org GUC sees ${seen.rows[0]?.n} of ${total.rows[0]?.n} rows. Tenant isolation must fail CLOSED — this should be 0.`,
      });
    }
  }
  return { probed, findings };
}
