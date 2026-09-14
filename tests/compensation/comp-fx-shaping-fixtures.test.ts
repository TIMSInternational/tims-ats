/**
 * comp-fx-shaping-fixtures.test.ts — Phase-5 compensation strangler, Slice 11c (FX reads).
 *
 * Asserts the REAL @tims/shared PURE shaping kernels for the five FX-derived compensation reads
 * (buildBandDistribution / buildCompPayEquity / buildTotalCompBreakdown / buildCompDashboardKpis /
 * buildSimulateAdjustment) against the shared goldens contracts/compensation-fixtures/{band-distribution,
 * pay-equity,total-comp-breakdown,dashboard-kpis,simulate-adjustment}.json — the SAME fixtures the C#
 * Tims.Domain.Compensation.CompensationKernels unit tests assert. UPDATE 2026-08-05 (#59): ALL FIVE
 * kernels now have zero TS call sites — buildCompPayEquity/buildSimulateAdjustment lost theirs when
 * getPayEquity/simulateAdjustment were TS-deleted along with the entire
 * packages/api/src/routers/compensation.ts router (the last 4 procedures were zero-FE-consumer dead
 * code); buildBandDistribution/buildTotalCompBreakdown/buildCompDashboardKpis had already lost theirs
 * on 2026-07-31 when getBandDistribution/getTotalCompBreakdown/getDashboardKpis went C#-only under
 * NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP. The kernels are deliberately KEPT: they are the live
 * cross-stack contract the C# port is golden-fixtured against, and this file is now their ONLY TS-side
 * test, exercising them directly rather than through a router (same as
 * benefits-utilization/compa-ratio-distribution's fixtures tests after those procedures were deleted
 * 2026-07-29). Inputs are ALREADY converted (the impure convertMoney/sumMoney ran in the deleted router
 * code; the C# side's impure conversion is unaffected). Any drift in either stack (FIX 1 positive-unbanded
 * fold, FIX 3 band-less compa shape, FIX 7 0-mean → null, min-5 triggers, round-then-sum) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildBandDistribution,
  buildCompPayEquity,
  buildTotalCompBreakdown,
  buildCompDashboardKpis,
  buildSimulateAdjustment,
} from '@tims/shared';

const dir = join(__dirname, '..', '..', 'contracts', 'compensation-fixtures');
const load = (file: string): { cases: { name: string; input: any; expected: unknown }[] } =>
  JSON.parse(readFileSync(join(dir, file), 'utf8'));

function suite(file: string, minCases: number, run: (input: any) => unknown): void {
  const fixture = load(file);
  describe(`${file} — golden parity (asserted identically by the C# port)`, () => {
    for (const c of fixture.cases) {
      it(c.name, () => {
        expect(run(c.input)).toEqual(c.expected);
      });
    }
    it('has cases (fixture loaded)', () => {
      expect(fixture.cases.length).toBeGreaterThanOrEqual(minCases);
    });
  });
}

suite('band-distribution.json', 8, (i) =>
  buildBandDistribution(i.rows, i.unassignedCount, i.nonPositiveBanded, i.positiveUnbanded),
);
suite('pay-equity.json', 5, (i) => buildCompPayEquity(i.convertedSalaries, i.displayCurrency));
suite('total-comp-breakdown.json', 6, (i) => buildTotalCompBreakdown(i));
suite('dashboard-kpis.json', 6, (i) => buildCompDashboardKpis(i));
suite('simulate-adjustment.json', 6, (i) => buildSimulateAdjustment(i));
