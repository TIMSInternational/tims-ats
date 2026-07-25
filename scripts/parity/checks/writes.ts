import type { WriteEndpointDef, WriteResolved, Row } from '../write-surfaces';

/**
 * Write-verification check runners: light parity (the single mutating happy-path),
 * write-IDOR (org-A → org-B, denied + no mutation), write-RBAC-deny (deny role →
 * 403 + no mutation). Every assertion runs against the DB via an injected `readback`
 * so a denied write is proven to have made NO mutation, not merely returned a 4xx.
 * The runners are generic; the per-endpoint goldens live in the WriteEndpointDef.
 */

export interface WriteCheckResult {
  check: 'write-parity' | 'write-idor' | 'write-rbac';
  endpoint: string;
  role?: string;
  ok: boolean;
  detail?: string;
}

/** Runs a parameterized read-only SQL query and returns the rows (BYPASSRLS pg client). */
export type Readback = (sql: string, params: unknown[]) => Promise<Row[]>;

/** C# write caller shape, matching `callCsharpWrite` in scripts/parity/callers.ts. */
export type CallWrite = (
  base: string,
  method: 'POST' | 'PATCH',
  path: string,
  token: string,
  body: unknown,
) => Promise<{ status: number; body: unknown }>;

/**
 * Light parity — the probe (allow) role runs the write ONCE and we assert 200 + the
 * response shape + a DB read-back of the created/mutated row against the golden. This
 * is the single mutation per endpoint and doubles as the probe-role "allow" proof.
 */
export async function runWriteParity(
  ep: WriteEndpointDef,
  res: WriteResolved,
  probeToken: string,
  callWrite: CallWrite,
  readback: Readback,
): Promise<WriteCheckResult> {
  const { path, body } = ep.buildParity(res);
  const resp = await callWrite(res.base, ep.method, path, probeToken, body);
  if (resp.status !== 200) {
    return { check: 'write-parity', endpoint: ep.name, ok: false, detail: `expected 200, got ${resp.status}: ${JSON.stringify(resp.body).slice(0, 160)}` };
  }
  const rd = ep.expectResponse(resp.body);
  if (rd) return { check: 'write-parity', endpoint: ep.name, ok: false, detail: `response mismatch: ${rd}` };

  const { sql, params, expect } = ep.readbackMutated(res, resp.body);
  const md = expect(await readback(sql, params));
  if (md) return { check: 'write-parity', endpoint: ep.name, ok: false, detail: `db read-back mismatch: ${md}` };
  return { check: 'write-parity', endpoint: ep.name, ok: true };
}

/**
 * Write-IDOR — the org-A probe token attempts the write against an org-B resource/
 * subject. Must be DENIED (403 create / 404 approve; any 4xx is denied, a 200 is a
 * write leak → FAIL) AND a read-back must prove org-B was NOT mutated (a 4xx that
 * still wrote the row is the worst-case bug). Fails closed on any other status.
 */
export async function runWriteIdor(
  ep: WriteEndpointDef,
  res: WriteResolved,
  orgAProbeToken: string,
  callWrite: CallWrite,
  readback: Readback,
): Promise<WriteCheckResult> {
  const { path, body } = ep.buildIdor(res);
  const resp = await callWrite(res.base, ep.method, path, orgAProbeToken, body);
  if (resp.status === 200) {
    return { check: 'write-idor', endpoint: ep.name, ok: false, detail: `WRITE LEAK: org-A token reached an org-B write (status 200) — cross-tenant mutation` };
  }
  if (resp.status !== 403 && resp.status !== 404) {
    return { check: 'write-idor', endpoint: ep.name, ok: false, detail: `cannot confirm isolation: unexpected status ${resp.status} (expected 403/404)` };
  }
  const { sql, params, expect } = ep.readbackNoMutation(res, 'b');
  const nm = expect(await readback(sql, params));
  if (nm) return { check: 'write-idor', endpoint: ep.name, ok: false, detail: `denied (${resp.status}) BUT ${nm}` };
  return { check: 'write-idor', endpoint: ep.name, ok: true };
}

/**
 * Write-RBAC — for each DENY role (expected 403): assert 403 + no mutation. For each
 * non-probe ALLOW role (expected 200) when `ep.allowRolesLiveTestable` (an unconditional
 * create): assert 200 + a read-back proving the row was written under THAT role's grant —
 * this exercises the real grant-resolution path for a non-bypass role (the probe is a
 * permission-bypass role, so light-parity alone never proves grant resolution). The
 * probe's own allow is covered by light-parity; allow roles on a state-transition endpoint
 * are skipped (they'd need their own precondition — a rollout item).
 */
export async function runWriteRbac(
  ep: WriteEndpointDef,
  res: WriteResolved,
  tokensByRole: Record<string, string>,
  probeRole: string,
  callWrite: CallWrite,
  readback: Readback,
): Promise<WriteCheckResult[]> {
  const results: WriteCheckResult[] = [];
  const fail = (role: string, detail: string): WriteCheckResult => ({ check: 'write-rbac', endpoint: ep.name, role, ok: false, detail });
  const pass = (role: string): WriteCheckResult => ({ check: 'write-rbac', endpoint: ep.name, role, ok: true });

  for (const [role, expected] of Object.entries(ep.expectedByRole)) {
    const token = tokensByRole[role];

    if (expected === 403) {
      if (!token) { results.push(fail(role, `no token for role '${role}'`)); continue; }
      const { path, body } = ep.buildParity(res);
      const resp = await callWrite(res.base, ep.method, path, token, body);
      if (resp.status !== 403) { results.push(fail(role, `expected 403, got ${resp.status}`)); continue; }
      const rb = ep.readbackNoMutation(res, 'a', role);
      const nm = rb.expect(await readback(rb.sql, rb.params));
      results.push(nm ? fail(role, `denied (403) BUT ${nm}`) : pass(role));
      continue;
    }

    // ALLOW (200): the probe is covered by light-parity; other allow roles run live only when
    // the endpoint is safe to (unconditional create). Otherwise skip (no live allow coverage).
    if (role === probeRole || !ep.allowRolesLiveTestable || !ep.readbackAllow) continue;
    if (!token) { results.push(fail(role, `no token for role '${role}'`)); continue; }
    const { path, body } = ep.buildParity(res);
    const resp = await callWrite(res.base, ep.method, path, token, body);
    if (resp.status !== 200) { results.push(fail(role, `allow role expected 200, got ${resp.status}`)); continue; }
    const rd = ep.expectResponse(resp.body);
    if (rd) { results.push(fail(role, `allow role response mismatch: ${rd}`)); continue; }
    const arb = ep.readbackAllow(res, role, resp.body);
    const am = arb.expect(await readback(arb.sql, arb.params));
    results.push(am ? fail(role, `allow role ${am}`) : pass(role));
  }
  return results;
}
