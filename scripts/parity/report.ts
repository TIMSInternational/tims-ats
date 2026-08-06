import type { CheckResult as ParityCheckResult } from './checks/parity';
import type { CheckResult as RlsCheckResult } from './checks/rls';
import type { CheckResult as RbacCheckResult } from './checks/rbac';
import type { WriteCheckResult } from './checks/writes';

/**
 * Union of every check runner's result shape (Tasks 8/9/10). `report.ts` is the only
 * module that needs to see all three at once, so the union lives here rather than
 * forcing the individual `checks/*.ts` files to agree on one shared interface.
 *
 * `RlsCheckResult` AND `ParityCheckResult` each carry an optional
 * `inconclusive?: boolean` — set when an `ok:true` verdict was reached WITHOUT a
 * real comparison: for rls, a Mode-B both-orgs-empty structural pass; for parity,
 * a C#-only endpoint whose TS procedure has been deleted. `renderLine` renders
 * those as `[WEAK]` instead of `[PASS]`, and `renderReport` counts them in a
 * separate `weak` bucket so the summary line cannot read as "N compared, N agreed".
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
  const weakCount = results.filter(isInconclusive).length;
  const passCount = results.filter((r) => r.ok).length - weakCount;
  const failCount = results.length - passCount - weakCount;

  const lines = results.map(renderLine);
  // The weak count is in the SUMMARY, not just the per-line rendering. Without it, a run in which
  // every result was inconclusive printed "4 passed, 0 failed" — which is the did-not-run-renders-as
  // -a-tick shape this harness exists to avoid, one layer below the line where it was fixed. Whoever
  // reads only the last line must still see that nothing was compared.
  const summary =
    `${passCount} passed, ${failCount} failed, ${weakCount} weak, ${results.length} total` +
    (weakCount > 0
      ? `\n⚠ ${weakCount} check(s) reported WEAK — they passed WITHOUT a real comparison. See the [WEAK] lines above for why.` +
        (passCount === 0 && failCount === 0
          ? `\n⚠ NOTHING in this run was actually compared. Do not read this as a verification.`
          : '')
      : '');
  const text = [...lines, '', summary].join('\n');

  return { text, allGreen };
}
