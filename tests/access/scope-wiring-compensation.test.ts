import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 2.5 slice 4 — static tripwires for the compensation module.
// Compensation is the most sensitive module (salary data) — fail closed.
//
// Endpoint taxonomy — the 4 SURVIVING procedures. The other 10 (getSalaryBands,
// getCompaRatioDistribution, getBenefitsUtilization, listPendingAdjustments, myCompensation,
// createAdjustment, approveAdjustment — deleted 2026-07-29 — plus getBandDistribution,
// getTotalCompBreakdown, getDashboardKpis — deleted in the FX-read TS-deletion pass once
// NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP was confirmed permanently live) were DELETED once
// their C# read/write surfaces were confirmed live in prod; their guarantees now live in the C#
// implementation + scripts/parity/{surfaces,write-surfaces}.ts (and, for the min-5 shaping kernels
// the deleted procedures used to delegate to, in tests/compensation/*-fixtures.test.ts, which
// exercise the shared kernels directly against the golden fixtures both stacks share).
//   getMarketComparison   → org catalog (salaryBand only, no per-person data)
//                           UNTOUCHED — safe without scoping.
//   getPayEquity          → org-rollup aggregate  → requireOrgScope
//   simulateAdjustment    → per-person read (employeeCompensation by userId)
//                           → assertSubjectInScope on input.userId
//   getEmployeeComp       → per-person read (employeeCompensation by userId)
//                           → assertSubjectInScope on input.userId
//
// Fragment behavior: tests/access/entity-policies.test.ts.
// Write-rule behavior: tests/access/write-rules.test.ts.

const ROOT = join(__dirname, '..', '..');
const read = () => readFileSync(join(ROOT, 'packages/api/src/routers/compensation.ts'), 'utf8');
// Slice 11c (honest-fixture): getPayEquity's min-5 shaping lives in the shared kernel
// (@tims/shared compensation.ts, golden-fixtured both stacks) and the router DELEGATES to it. The tripwire
// that guards the (formerly inline) suppression reads the kernel + asserts the router calls the shaper.
const readKernel = () => readFileSync(join(ROOT, 'packages/shared/src/compensation.ts'), 'utf8');

describe('compensation module scope wiring', () => {
  it('composes employeeCompensation fragment or subjects per-user reads', () => {
    // simulateAdjustment and getEmployeeComp target a specific userId —
    // assertSubjectInScope enforces the same scope constraint for point-reads.
    const src = read();
    expect(src).toMatch(/scopeWhereFor\('employeeCompensation'|assertSubjectInScope/);
  });

  it('org-rollup analytics gated via requireOrgScope (≥1 call: getPayEquity)', () => {
    // getBandDistribution/getTotalCompBreakdown/getDashboardKpis (also requireOrgScope-gated) were
    // deleted in the FX-read TS-deletion pass — their gating guarantee now lives entirely in the C#
    // implementation, not this TS source file.
    const src = read();
    const matches = src.match(/requireOrgScope/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('no file spreads a scope fragment (AND-composition invariant, CI check 13)', () => {
    expect(read()).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
  });

  // ── Slice 6: min-5 k-anonymity suppression on aggregate counts ──────────
  // Defense in depth ON TOP of requireOrgScope. A salary bucket/band/group of
  // 1..4 employees must report a suppressed marker, never a raw count/avg/median.
  // getPayEquity is the only surviving router-level consumer of this guarantee — the
  // band-distribution/total-comp-breakdown/dashboard-kpis kernels' own min-5 shaping is exercised
  // directly (not through the router) by tests/compensation/comp-fx-shaping-fixtures.test.ts, the
  // same pattern already used for benefits-utilization/compa-ratio-distribution after their router
  // procedures were deleted 2026-07-29.
  it('getPayEquity routes the group count through suppressBelowMin5 (shared kernel)', () => {
    const k = readKernel();
    // buildCompPayEquity floors the org-wide 'all' group count; a suppressed group nulls the salary stats.
    expect(k).toMatch(/suppressBelowMin5\(convertedSalaries\.length\)/);
    expect(k).toMatch(/averageSalary:\s*null,\s*medianSalary:\s*null/);
    expect(read()).toMatch(/buildCompPayEquity\(/);
  });
});
