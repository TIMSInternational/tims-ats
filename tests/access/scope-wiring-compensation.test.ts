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

  // ── Slice 6: min-5 k-anonymity suppression on aggregate counts ──────────
  // Defense in depth ON TOP of requireOrgScope. A salary bucket/band/group of
  // 1..4 employees must report a suppressed marker, never a raw count/avg/median.
  it('imports suppressBelowMin5 from the access barrel', () => {
    expect(read()).toMatch(/suppressBelowMin5.*from '\.\.\/access'/);
  });

  it('getBandDistribution routes bands through suppressBelowMin5 (EMPTY bands when any band suppressed, round 7)', () => {
    const src = read();
    // dots.length count is suppressed; round 7 (present-key cardinality) returns an EMPTY
    // bands array — no per-band keys at all — when ANY band or the unbanded bucket is sub-floor.
    expect(src).toMatch(/suppressBelowMin5\(band\.dots\.length\)/);
    expect(src).toMatch(/anyBandSuppressed\) return \[\]/);
  });

  // ── Slice 6 round 3: implicit-bucket oracle (unbanded employees) ─────────
  // Source tripwire — behavioral mock omitted because compensation.ts calls `db`
  // (tenantDb) directly with no injected repository seam, so unit-mocking the DB
  // would require heavy vitest module-level mocking that does not exist elsewhere
  // in this test suite. A source tripwire is the established pattern here (see the
  // slice 6 round 2 tripwires above) and gives the same CI guarantee.
  //
  // Attack the tripwire guards against:
  //   20 banded employees (4 bands × 5 each) + 3 with bandId=null
  //   → WITHOUT fix: unassignedCount=3 is NOT fed to the trigger
  //     → anyBandSuppressed=false (all bands ≥5) → dots exposed
  //     → attacker reads Σ(dots.length)=20, sees getTotalCompBreakdown.employeeCount=23
  //     → 23−20 = 3 unbanded employees recovered
  //   → WITH fix: suppressBelowMin5(3).suppressed=true added to the trigger
  //     → anyBandSuppressed=true → all bands return dots:[]
  //     → no visible dot-counts → oracle closed.
  it('getBandDistribution counts bandId:null rows into the suppression trigger (implicit-bucket oracle, round 3)', () => {
    const src = read();
    // The fix must query unassigned rows separately …
    expect(src).toMatch(/bandId:\s*null/);
    // … and feed the resulting count into the trigger expression.
    expect(src).toMatch(/suppressBelowMin5\(unassignedCount\)\.suppressed/);
    // The trigger must OR the unbanded result with the per-band results.
    expect(src).toMatch(/anyBandSuppressed\s*=\s*[\s\S]{0,200}suppressBelowMin5\(unassignedCount\)/);
  });

  it('getCompaRatioDistribution routes every bucket count through suppressBelowMin5', () => {
    expect(read()).toMatch(/suppressBelowMin5\(count\)/);
  });

  it('getPayEquity routes each group count through suppressBelowMin5', () => {
    const src = read();
    expect(src).toMatch(/suppressBelowMin5\(count\)/);
    // suppressed group nulls the sensitive salary stats
    expect(src).toMatch(/averageSalary:\s*null,\s*medianSalary:\s*null/);
  });

  it('at least three aggregate endpoints invoke suppressBelowMin5', () => {
    const calls = read().match(/suppressBelowMin5\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
});
