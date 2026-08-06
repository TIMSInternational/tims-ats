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

/** True for a result that passed only because there was nothing to compare:
 *  an RLS Mode-B both-orgs-empty structural pass (`checks/rls.ts`), or a parity
 *  check on a C#-only endpoint whose TS procedure has been deleted
 *  (`checks/parity.ts`). Narrowing on `r.check` first is required — `inconclusive`
 *  exists only on those two members, not on rbac/write results. */
function isInconclusive(r: CheckResult): r is RlsCheckResult | ParityCheckResult {
  return (r.check === 'rls' || r.check === 'parity') && r.ok === true && r.inconclusive === true;
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
 * Pure report renderer: no I/O, no process access. `allGreen` is true iff every
 * result is `ok` (vacuously true for an empty result set — nothing failed).
 */
export function renderReport(results: CheckResult[]): { text: string; allGreen: boolean } {
  const allGreen = results.every((r) => r.ok);
  const passCount = results.filter((r) => r.ok).length;
  const failCount = results.length - passCount;

  const lines = results.map(renderLine);
  const summary = `${passCount} passed, ${failCount} failed, ${results.length} total`;
  const text = [...lines, '', summary].join('\n');

  return { text, allGreen };
}
