import type { CheckResult as ParityCheckResult } from './checks/parity';
import type { CheckResult as RlsCheckResult } from './checks/rls';
import type { CheckResult as RbacCheckResult } from './checks/rbac';
import type { WriteCheckResult } from './checks/writes';

/**
 * Union of every check runner's result shape (Tasks 8/9/10). `report.ts` is the only
 * module that needs to see all three at once, so the union lives here rather than
 * forcing the individual `checks/*.ts` files to agree on one shared interface.
 *
 * `RlsCheckResult` (the `check: 'rls'` member) additionally carries an optional
 * `inconclusive?: boolean` — set when an `ok:true` RLS verdict was a structural
 * pass only (Mode B both-orgs-empty), not a real cross-tenant comparison.
 * `renderLine` below renders that case as `[WEAK]` instead of `[PASS]`.
 */
export type CheckResult = ParityCheckResult | RlsCheckResult | RbacCheckResult | WriteCheckResult;

function hasRole(r: CheckResult): r is RbacCheckResult | (WriteCheckResult & { role: string }) {
  return (r.check === 'rbac' || r.check === 'write-rbac') && 'role' in r && r.role !== undefined;
}

/** True for an RLS result that passed only because there was no cross-tenant
 *  data to compare (see `CheckResult.inconclusive` in checks/rls.ts). Narrowing
 *  on `r.check === 'rls'` first is required — `inconclusive` only exists on
 *  `RlsCheckResult`, not the parity/rbac union members. */
function isInconclusive(r: CheckResult): r is RlsCheckResult {
  return r.check === 'rls' && r.ok === true && r.inconclusive === true;
}

function renderLine(r: CheckResult): string {
  const weak = isInconclusive(r);
  const status = weak ? 'WEAK' : r.ok ? 'PASS' : 'FAIL';
  const role = hasRole(r) ? ` role=${r.role}` : '';
  const showDetail = weak || (!r.ok && !!r.detail);
  const detail = showDetail && r.detail ? ` — ${r.detail}` : '';
  return `[${status}] ${r.check} ${r.endpoint}${role}${detail}`;
}

/**
 * Pure report renderer: no I/O, no process access. `allGreen` is true iff at least one check ran AND
 * every result is `ok`.
 *
 * The zero-results case is a FAILURE, not a pass (changed 2026-08-05, #59). It used to return
 * `allGreen: true` — `[].every(...)` is vacuously true — and `cmdCheck`/`cmdVerifyWrite` turn
 * `allGreen` straight into the process exit code, so a surface that produced no checks at all exited
 * 0 and printed a clean summary. That is indistinguishable from "everything passed" for the caller,
 * and it is reachable: an endpoint list that is empty, or (since #59) a `parity` run where every
 * endpoint had its TS side deleted and was skipped. A control that cannot run must report that it did
 * not run — it must never render as green.
 */
export function renderReport(results: CheckResult[]): { text: string; allGreen: boolean } {
  if (results.length === 0) {
    return {
      text: 'NO CHECKS RAN — 0 results. This is NOT a pass: every endpoint was skipped or the surface has no endpoints.',
      allGreen: false,
    };
  }

  const allGreen = results.every((r) => r.ok);
  const passCount = results.filter((r) => r.ok).length;
  const failCount = results.length - passCount;

  const lines = results.map(renderLine);
  const summary = `${passCount} passed, ${failCount} failed, ${results.length} total`;
  const text = [...lines, '', summary].join('\n');

  return { text, allGreen };
}
