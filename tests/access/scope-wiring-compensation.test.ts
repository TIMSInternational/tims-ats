import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 2.5 slice 4 — static tripwires for the compensation module.
// Compensation is the most sensitive module (salary data) — fail closed.
//
// Endpoint taxonomy (all 13 procedures enumerated):
//   getSalaryBands        → org catalog (band definitions, no per-person data)
//                           UNTOUCHED — safe without scoping.
//   getMarketComparison   → org catalog (salaryBand only, no per-person data)
//                           UNTOUCHED — safe without scoping.
//   getBandDistribution   → org-rollup aggregate  → requireOrgScope
//   getCompaRatioDistrib. → org-rollup aggregate  → requireOrgScope
//   getPayEquity          → org-rollup aggregate  → requireOrgScope
//   getBenefitsUtilization→ org-rollup aggregate  → requireOrgScope
//   getTotalCompBreakdown → org-rollup aggregate  → requireOrgScope
//   getDashboardKpis      → org-rollup aggregate  → requireOrgScope
//   listPendingAdjustments→ row-level (salaryAdjustment) → AND-compose fragment
//   createAdjustment      → write targeting input.userId → assertSubjectInScope
//   approveAdjustment     → by-id mutation on salaryAdjustment → assertScoped
//   simulateAdjustment    → per-person read (employeeCompensation by userId)
//                           → assertSubjectInScope on input.userId
//   getEmployeeComp       → per-person read (employeeCompensation by userId)
//                           → assertSubjectInScope on input.userId
//
// Fragment behavior: tests/access/entity-policies.test.ts.
// Write-rule behavior: tests/access/write-rules.test.ts.

const ROOT = join(__dirname, '..', '..');
const read = () => readFileSync(join(ROOT, 'packages/api/src/routers/compensation.ts'), 'utf8');

describe('compensation module scope wiring', () => {
  it('composes salaryAdjustment fragment (listPendingAdjustments is row-level)', () => {
    const src = read();
    expect(src).toMatch(/scopeWhereFor\('salaryAdjustment'/);
    // AND-composition required (no spread)
    expect(src).toMatch(/AND:\s*\[/);
  });

  it('composes employeeCompensation fragment or subjects per-user reads', () => {
    // simulateAdjustment and getEmployeeComp target a specific userId —
    // assertSubjectInScope enforces the same scope constraint for point-reads.
    const src = read();
    expect(src).toMatch(/scopeWhereFor\('employeeCompensation'|assertSubjectInScope/);
  });

  it('approveAdjustment probes salaryAdjustment via assertScoped', () => {
    expect(read()).toMatch(/assertScoped\('salaryAdjustment'/);
  });

  it('createAdjustment gates the target user via assertSubjectInScope', () => {
    expect(read()).toMatch(/assertSubjectInScope/);
  });

  it('org-rollup analytics gated via requireOrgScope (≥6 calls: getBandDistribution, getCompaRatioDistribution, getPayEquity, getBenefitsUtilization, getTotalCompBreakdown, getDashboardKpis)', () => {
    const src = read();
    const matches = src.match(/requireOrgScope/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(6);
  });

  it('no file spreads a scope fragment (AND-composition invariant, CI check 13)', () => {
    expect(read()).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
  });
});
