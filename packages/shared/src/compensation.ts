// Pure compensation shaping kernels — the SINGLE SOURCE the TS compensation router returns AND the parity
// target for the C# port (Phase-5 compensation strangler, Slice 9, FX-FREE subset). No DB, no I/O, no clock,
// so they are golden-fixturable from the repo-root vitest AND importable everywhere.
//
// This slice extracts the two FX-FREE aggregate kernels: buildCompaRatioDistribution (read #4 — the meaty
// min-5 kernel) and buildBenefitsUtilization (read #3). The five FX-dependent reads (convertMoney/getFxRate)
// stay in the router and are Slice 9b.
//
// NOTE (2026-07-29): the TS router no longer calls buildCompaRatioDistribution or
// buildBenefitsUtilization — those two procedures were deleted once the C# read surface went live.
// Both kernels are DELIBERATELY KEPT: they remain the golden-fixtured cross-stack contract
// (contracts/compensation-fixtures/*, asserted by both this repo's vitest and the C# unit tests),
// and apps/web/lib/platform-api/compensation.ts imports their result types.
//
// PARITY PINS (each red-if-regressed in contracts/compensation-fixtures/*):
//  - min-5 k-anon (suppressBelowMin5 byte-identical to access/aggregate.ts): 1..4 → suppressed; 0 or ≥5 → not.
//  - compaRatio 6 FIXED buckets; bucket ONLY positive-salary rows (currentSalary > 0), so Σ buckets =
//    canonical positive population.
//  - avgCompaRatio = mean of the NON-null/NON-zero compaRatio values, floored on the CONTRIBUTOR count
//    (ratios.length) NOT the row count, JS half-up 2-dec → null when 1..4 ratios contributed OR 0.
//  - all-or-nothing empty-distribution: if suppress(positiveCount) || suppress(nonPositiveCount) ||
//    anyBucketSuppressed → { distribution:{}, avgCompaRatio, totalEmployees:null, suppressed:true } (NO keys).
//  - totalEmployees == positiveCount (NOT rows.length); 0 population → NON-suppressed empty distribution.
//  - benefits utilization = round((enrolled/totalUsers)*10000)/100, 0 when no users (JS half-up); NO min-5
//    (deliberate — benefits enrollment is not in the §21 sensitive matrix).

const MIN_AGGREGATE_SIZE = 5;

/** k-anon floor — byte-identical to packages/api/src/access/aggregate.ts suppressBelowMin5:
 *  1..4 → suppressed (count null); 0 or ≥5 → not suppressed (an empty bucket reveals no one). */
function suppressBelowMin5(count: number): { suppressed: boolean; count: number | null } {
  if (count > 0 && count < MIN_AGGREGATE_SIZE) return { suppressed: true, count: null };
  return { suppressed: false, count };
}

// ── Read 4: getCompaRatioDistribution ─────────────────────────────────────────

export interface CompaRatioRow {
  currentSalary: number;
  compaRatio: number | null;
}
export interface CompaRatioBucketCount {
  suppressed: boolean;
  count: number | null;
}
export interface CompaRatioDistribution {
  distribution: Record<string, CompaRatioBucketCount>;
  avgCompaRatio: number | null;
  totalEmployees: number | null;
  suppressed: boolean;
}

/**
 * The read-#4 kernel: bucket the positive-salary compensation rows into six fixed compa-ratio bands with
 * min-5 k-anonymity. Ported verbatim from the router body (behavior-preserving). All-or-nothing: any
 * sub-floor bucket OR sub-floor positive/non-positive population collapses the whole distribution to an
 * empty object + null total + suppressed:true (no keys survive to leak via cardinality or N−Σ).
 */
export function buildCompaRatioDistribution(rows: CompaRatioRow[]): CompaRatioDistribution {
  const buckets: Record<string, number> = {
    '<0.80': 0,
    '0.80-0.90': 0,
    '0.90-1.00': 0,
    '1.00-1.10': 0,
    '1.10-1.20': 0,
    '>1.20': 0,
  };

  // Canonical positive-salary population: compaRatio is null/0 for non-salaried rows, so the bucketed
  // population is exactly the positive-salary set. Σ buckets = positiveCount = the canonical comp population.
  let positiveCount = 0;
  for (const emp of rows) {
    const salary = Number(emp.currentSalary) || 0;
    if (!(salary > 0)) continue;
    positiveCount += 1;
    const cr = Number(emp.compaRatio) || 0;
    if (cr < 0.8) buckets['<0.80']++;
    else if (cr < 0.9) buckets['0.80-0.90']++;
    else if (cr < 1.0) buckets['0.90-1.00']++;
    else if (cr < 1.1) buckets['1.00-1.10']++;
    else if (cr < 1.2) buckets['1.10-1.20']++;
    else buckets['>1.20']++;
  }
  const nonPositiveCount = rows.length - positiveCount;

  // avgCompaRatio is the MEAN of the NON-null/NON-zero ratios — a DISTINCT (possibly smaller) sub-population
  // than the rows. Floor on the CONTRIBUTOR count (ratios.length): null when 1..4 ratios contributed. JS half-up.
  const ratios = rows.map((e) => Number(e.compaRatio) || 0).filter(Boolean);
  const avgCompaRatio =
    ratios.length && !suppressBelowMin5(ratios.length).suppressed
      ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) / 100
      : null;

  // Present-key cardinality + all-or-nothing: any sub-floor bucket OR sub-floor positive/non-positive
  // population ⇒ emit an EMPTY distribution (no keys) + null total + suppressed:true.
  const distributionShape: Record<string, CompaRatioBucketCount> = {};
  const anyBucketSuppressed = Object.values(buckets).some((count) => suppressBelowMin5(count).suppressed);
  if (
    suppressBelowMin5(positiveCount).suppressed ||
    suppressBelowMin5(nonPositiveCount).suppressed ||
    anyBucketSuppressed
  ) {
    return { distribution: distributionShape, avgCompaRatio, totalEmployees: null, suppressed: true };
  }

  const distribution = Object.fromEntries(
    Object.entries(buckets).map(([k, count]) => [k, { suppressed: false, count }]),
  );

  // totalEmployees = the positive-salary population (NOT rows.length) so cross-endpoint subtraction collapses.
  return { distribution, avgCompaRatio, totalEmployees: positiveCount, suppressed: false };
}

// ── Slice 11c: FX-derived money kernels (PURE given a rate) ─────────────────────
//
// convertMoney/sumMoney are DETERMINISTIC once the FX rate is injected: the live rate FETCH (frankfurter,
// Slice 11c gateway) is NEVER golden-fixtured, but the arithmetic that shapes a converted amount IS. These
// pure kernels are the SINGLE source the live `packages/api/src/lib/currency.ts` convertMoney/sumMoney now
// delegate to (behavior-preserving) AND the parity target the C# port mirrors
// (Tims.Domain.Compensation.CompensationKernels.ConvertMoney/SumMoney, golden-fixtured BOTH stacks against
// contracts/compensation-fixtures/convert-money.json). rounding uses roundMoney (JS half-up + Number.EPSILON
// bias), byte-identical to the live helper — a drift on either stack turns its CI red.
//
// PARITY PINS (each red-if-regressed in contracts/compensation-fixtures/convert-money.json):
//  - roundMoney(x) = Math.round((x + Number.EPSILON) * 100) / 100 — the EPSILON bias lifts an exact *.xx5
//    boundary (e.g. 1.005) off its binary-float undershoot so it rounds UP, NOT to-even/down.
//  - convertMoneyWithRate: originalAmount = Number(amount) || 0; amount = roundMoney(originalAmount * rate);
//    the from/to codes pass through verbatim (the CALLER normalizes them, exactly as the live helper does).
//  - sumMoneyWithRates: total = Σ roundMoney(amountᵢ * rateᵢ) THEN roundMoney(total) (round-then-sum-then-round,
//    matching the live sumMoney); converted = ANY row whose from ≠ to (identity rows do not flip it).

/** roundMoney — JS half-up to 2 decimals with the Number.EPSILON bias (byte-identical to the live currency
 *  helper). The bias nudges an exact half-cent boundary above its float undershoot so it rounds UP. */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export interface ConvertedMoneyView {
  originalAmount: number;
  originalCurrency: string;
  amount: number;
  currency: string;
  rate: number;
}

export interface MoneyRowInput {
  amount: number;
  from: string;
  rate: number;
}

/**
 * The PURE convert kernel: shape a single converted amount given an already-resolved FX `rate` (identity = 1).
 * The `from`/`to` codes are passed through verbatim — the caller normalizes them (the live convertMoney
 * normalizes with DEFAULT_CURRENCY / PLATFORM_BILLING_CURRENCY BEFORE calling this). No I/O, no clock.
 */
export function convertMoneyWithRate(amount: number, from: string, to: string, rate: number): ConvertedMoneyView {
  const originalAmount = Number(amount) || 0;
  return { originalAmount, originalCurrency: from, amount: roundMoney(originalAmount * rate), currency: to, rate };
}

/**
 * The PURE sum kernel: fold a set of {amount, from, rate} rows into a single display-currency total. Mirrors
 * the live sumMoney arithmetic EXACTLY — each row is roundMoney(amount * rate), the running total is summed,
 * then the total is roundMoney'd once more. `converted` is true iff ANY row's source currency differs from the
 * display currency (an identity row never flips it). The rate DATES (ratesAsOf) stay in the live wrapper (they
 * are pin/provider-derived, never fixtured).
 */
export function sumMoneyWithRates(rows: MoneyRowInput[], to: string): { amount: number; converted: boolean } {
  let total = 0;
  let converted = false;
  for (const row of rows) {
    total += convertMoneyWithRate(row.amount, row.from, to, row.rate).amount;
    converted ||= row.from !== to;
  }
  return { amount: roundMoney(total), converted };
}

// ── Read 3: getBenefitsUtilization ─────────────────────────────────────────────

export interface BenefitPlanInput {
  id: string;
  name: string;
  category: string;
  enrolled: number;
}
export interface BenefitUtilizationItem {
  id: string;
  name: string;
  category: string;
  enrolled: number;
  utilization: number;
}

/**
 * The read-#3 kernel: per-plan enrollment utilization as a percentage of the active-user population.
 * utilization = round((enrolled/totalUsers)*10000)/100 (JS half-up, 2-dec), 0 when there are no users.
 * Deliberately NO min-5 (benefits enrollment is not in the §21 sensitive-data matrix; see REMAINING-WORK).
 */
export function buildBenefitsUtilization(
  plans: BenefitPlanInput[],
  totalUsers: number,
): BenefitUtilizationItem[] {
  return plans.map((b) => ({
    id: b.id,
    name: b.name,
    category: b.category,
    enrolled: b.enrolled,
    utilization: totalUsers ? Math.round((b.enrolled / totalUsers) * 10000) / 100 : 0,
  }));
}

// ── Slice 11c: the five FX-derived READ shaping kernels (PURE given already-converted amounts + counts) ──────
//
// The router does the impure work (DB reads + FX conversion via lib/currency.ts convertMoney/sumMoney), then
// hands each read's ALREADY-CONVERTED amounts + counts + provenance to one of these pure shapers — the SAME
// split as convertMoneyWithRate/sumMoneyWithRates. Each is golden-fixtured BOTH stacks (the C# port mirrors it
// as Tims.Domain.Compensation.CompensationKernels.BuildX). Behavior-preserving ports of the deferred router
// bodies EXCEPT the FIX-1 k-anon fold (band-distribution now also folds the POSITIVE-unbanded sub-bucket, which
// intentionally changes output) and the FIX-7/FIX-8 latent-parity nits (dashboard avgCompaRatio 0→null;
// band display currency = normalizeCurrencyCode(band.currency) USD-fallback). Every min-5 guard is preserved.

// ── Read: getBandDistribution ──────────────────────────────────────────────────

/** One positive-salary banded row, ALREADY converted into its band's currency. `currency` is the band's
 *  DISPLAY currency (normalizeCurrencyCode(band.currency), USD fallback — FIX 8), NOT the conversion currency. */
export interface BandDistributionRowInput {
  bandId: string;
  level: string;
  title: string;
  min: number;
  mid: number;
  max: number;
  currency: string;
  salaryInBandCurrency: number;
}
export interface BandDot {
  pos: number;
  outlier: boolean;
}
export interface BandDistributionOut {
  level: string;
  title: string;
  min: number;
  mid: number;
  max: number;
  currency: string;
  dots: BandDot[];
  suppressed: boolean;
}

/**
 * The band-distribution shaper: group the positive-salary banded rows by band, plot each as a clamped dot
 * (pos 0..100, outlier when the raw position fell outside), sort bands by mid desc, and apply the all-or-nothing
 * min-5 trigger. Dots are dropped to [] on EVERY band (empty array returned) whenever the banded+unbanded
 * population is 1..4, OR any band, OR the unbanded bucket, OR the non-positive-salary banded complement, OR —
 * FIX 1 — the POSITIVE-unbanded sub-bucket is 1..4. The positive-unbanded fold closes the differencing oracle
 * `dashboard.compensatedEmployees − Σdots = positiveUnbanded` (compensatedEmployees = positiveBanded +
 * positiveUnbanded; Σdots = positiveBanded). 0 population passes through as [] (reveals no individual).
 */
export function buildBandDistribution(
  rows: BandDistributionRowInput[],
  unassignedCount: number,
  nonPositiveBanded: number,
  positiveUnbanded: number,
): BandDistributionOut[] {
  const byBand = new Map<
    string,
    { level: string; title: string; min: number; mid: number; max: number; currency: string; dots: BandDot[] }
  >();
  for (const r of rows) {
    if (!byBand.has(r.bandId)) {
      byBand.set(r.bandId, { level: r.level, title: r.title, min: r.min, mid: r.mid, max: r.max, currency: r.currency, dots: [] });
    }
    const span = r.max - r.min;
    const rawPos = span > 0 ? ((r.salaryInBandCurrency - r.min) / span) * 100 : 50;
    byBand.get(r.bandId)!.dots.push({ pos: Math.min(100, Math.max(0, rawPos)), outlier: rawPos < 0 || rawPos > 100 });
  }

  const allBands = [...byBand.values()].sort((a, b) => b.mid - a.mid);
  const bandedPopulation = allBands.reduce((sum, band) => sum + band.dots.length, 0) + unassignedCount;
  const anyBandSuppressed =
    allBands.some((band) => suppressBelowMin5(band.dots.length).suppressed) ||
    suppressBelowMin5(unassignedCount).suppressed ||
    suppressBelowMin5(nonPositiveBanded).suppressed ||
    // FIX 1: the positive-unbanded sub-bucket is the missing operand in the trigger (differencing oracle).
    suppressBelowMin5(positiveUnbanded).suppressed;
  if (suppressBelowMin5(bandedPopulation).suppressed || anyBandSuppressed) return [];

  return allBands.map((band) => ({ ...band, suppressed: false }));
}

// ── Read: getPayEquity (comp, single org-wide 'all' group) ──────────────────────

export interface CompPayEquityGroupOut {
  group: string;
  count: number | null;
  suppressed: boolean;
  averageSalary: number | null;
  medianSalary: number | null;
}
export interface CompPayEquityOut {
  groupBy: string;
  results: CompPayEquityGroupOut[];
  currency: string;
}

/**
 * The compensation pay-equity shaper: a single org-wide 'all' group over the ALREADY-CONVERTED positive
 * salaries. avg = mean (JS round), median = sorted[floor(n/2)] (the floor-index element, NOT the two-middle
 * mean). min-5: when the group is 1..4 the count + both salary stats are nulled (suppressed).
 */
export function buildCompPayEquity(convertedSalaries: number[], displayCurrency: string): CompPayEquityOut {
  const avg = convertedSalaries.length
    ? convertedSalaries.reduce((a, b) => a + b, 0) / convertedSalaries.length
    : 0;
  const sorted = [...convertedSalaries].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const s = suppressBelowMin5(convertedSalaries.length);
  const group: CompPayEquityGroupOut = s.suppressed
    ? { group: 'all', count: null, suppressed: true, averageSalary: null, medianSalary: null }
    : { group: 'all', count: s.count, suppressed: false, averageSalary: Math.round(avg), medianSalary: median };
  return { groupBy: 'all', results: [group], currency: displayCurrency };
}

// ── Read: getTotalCompBreakdown ─────────────────────────────────────────────────

/** The two ALREADY-SUMMED display-currency totals + provenance (from the impure sumMoney wrapper). `null`
 *  means the totals were not computed — either the population is suppressed, OR (C# fail-soft) a pin was
 *  missing; both collapse to the suppressed shape. */
export interface TotalCompTotals {
  baseAmount: number;
  variableAmount: number;
  converted: boolean;
  ratesAsOf: string | null;
}
export interface CompBreakdownLineOut {
  total: number | null;
  percentage: number | null;
}
export interface TotalCompBreakdownOut {
  totalComp: number | null;
  currency: string;
  converted: boolean;
  ratesAsOf: string | null;
  breakdown: { baseSalary: CompBreakdownLineOut; variablePay: CompBreakdownLineOut };
  employeeCount: number | null;
  suppressed: boolean;
}

/**
 * The total-comp-breakdown shaper: given the contributor counts + the two summed totals, emit the base/variable
 * split. All-or-nothing min-5: any sub-floor of {total rows, base contributors, variable contributors,
 * non-positive complement} — OR absent totals (`null`) — suppresses (all totals null, employeeCount null,
 * suppressed:true). employeeCount = baseContributors (aligns with dashboard.compensatedEmployees so the
 * denominators cannot be differenced). percentages round2, 0 when the total is 0.
 */
export function buildTotalCompBreakdown(input: {
  rowCount: number;
  baseContributors: number;
  variableContributors: number;
  totals: TotalCompTotals | null;
  displayCurrency: string;
}): TotalCompBreakdownOut {
  const { rowCount, baseContributors, variableContributors, totals, displayCurrency } = input;
  const nonPositiveContributors = rowCount - baseContributors;
  const suppressed =
    suppressBelowMin5(rowCount).suppressed ||
    suppressBelowMin5(baseContributors).suppressed ||
    suppressBelowMin5(variableContributors).suppressed ||
    suppressBelowMin5(nonPositiveContributors).suppressed;
  if (suppressed || !totals) {
    return {
      totalComp: null,
      currency: displayCurrency,
      converted: false,
      ratesAsOf: null,
      breakdown: { baseSalary: { total: null, percentage: null }, variablePay: { total: null, percentage: null } },
      employeeCount: null,
      suppressed: true,
    };
  }

  const normalizedTotalComp = roundMoney(totals.baseAmount + totals.variableAmount);
  return {
    totalComp: normalizedTotalComp,
    currency: displayCurrency,
    converted: totals.converted,
    ratesAsOf: totals.ratesAsOf,
    breakdown: {
      baseSalary: {
        total: totals.baseAmount,
        percentage: normalizedTotalComp ? Math.round((totals.baseAmount / normalizedTotalComp) * 10000) / 100 : 0,
      },
      variablePay: {
        total: totals.variableAmount,
        percentage: normalizedTotalComp ? Math.round((totals.variableAmount / normalizedTotalComp) * 10000) / 100 : 0,
      },
    },
    employeeCount: baseContributors,
    suppressed: false,
  };
}

// ── Read: getDashboardKpis ──────────────────────────────────────────────────────

/** The summed payroll total + provenance. `null` when the compensated population is suppressed OR (C#
 *  fail-soft) a pin was missing — the latter maps to the same suppressed aggregates (fxUnavailable). */
export interface DashboardPayroll {
  amount: number;
  converted: boolean;
  ratesAsOf: string | null;
}
export interface CompDashboardKpisOut {
  totalMonthlyPayroll: number | null;
  avgSalary: number | null;
  currency: string;
  converted: boolean;
  ratesAsOf: string | null;
  compensatedEmployees: number | null;
  compensatedSuppressed: boolean;
  activeEmployees: number;
  pendingAdjustments: number | null;
  pendingAdjustmentsSuppressed: boolean;
  benefitsUtilizationPct: number;
  avgCompaRatio: number | null;
}

/**
 * The dashboard-KPIs shaper. Compensated aggregates (payroll/avgSalary/compensatedEmployees) are suppressed
 * when the compensated population is 1..4 OR (fail-soft) the payroll sum was unavailable; avgCompaRatio is
 * suppressed when <5 compaRatio rows contributed OR — FIX 7 — the mean is exactly 0 (`!avgCompaRatio`, matching
 * the TS Float-avg falsy check). pendingAdjustments min-5 floored. benefitsUtilizationPct = mean over plans of
 * enrolled/activeEmployees. activeEmployees + benefits pass through.
 */
export function buildCompDashboardKpis(input: {
  compensatedCount: number;
  compaRatioCount: number;
  pendingAdjustments: number;
  activeEmployees: number;
  benefitEnrollmentCounts: number[];
  compaRatioAvg: number | null;
  payroll: DashboardPayroll | null;
  displayCurrency: string;
}): CompDashboardKpisOut {
  const benefitsUtilizationPct =
    input.benefitEnrollmentCounts.length && input.activeEmployees
      ? Math.round(
          (input.benefitEnrollmentCounts.reduce((sum, c) => sum + c / input.activeEmployees, 0) /
            input.benefitEnrollmentCounts.length) *
            1000,
        ) / 10
      : 0;

  const compensatedSuppressed = suppressBelowMin5(input.compensatedCount).suppressed;
  const compaRatioSuppressed = suppressBelowMin5(input.compaRatioCount).suppressed;
  const pendingFloor = suppressBelowMin5(input.pendingAdjustments);

  // fail-soft: a missing payroll pin (payroll === null while not k-anon-suppressed) suppresses the compensated
  // aggregates too — the same observable shape as a sub-floor population (never a wrong number).
  const fxUnavailable = !compensatedSuppressed && !input.payroll;
  const effectiveCompensatedSuppressed = compensatedSuppressed || fxUnavailable;

  return {
    totalMonthlyPayroll: effectiveCompensatedSuppressed ? null : input.payroll!.amount,
    avgSalary: effectiveCompensatedSuppressed ? null : Math.round(input.payroll!.amount / input.compensatedCount),
    currency: input.displayCurrency,
    converted: !effectiveCompensatedSuppressed && !!input.payroll?.converted,
    ratesAsOf: effectiveCompensatedSuppressed ? null : input.payroll!.ratesAsOf,
    compensatedEmployees: effectiveCompensatedSuppressed ? null : input.compensatedCount,
    compensatedSuppressed: effectiveCompensatedSuppressed,
    activeEmployees: input.activeEmployees,
    pendingAdjustments: pendingFloor.count,
    pendingAdjustmentsSuppressed: pendingFloor.suppressed,
    benefitsUtilizationPct,
    avgCompaRatio: compaRatioSuppressed || !input.compaRatioAvg ? null : Math.round(input.compaRatioAvg * 100) / 100,
  };
}

// ── Read: simulateAdjustment ────────────────────────────────────────────────────

export interface SimulateAdjustmentBase {
  currentSalary: number;
  currency: string;
  proposedSalary: number;
  proposedCurrency: string;
  proposedSalaryForComparison: number;
  comparisonCurrency: string;
  percentageChange: number;
}
export interface SimulateAdjustmentWithCompa extends SimulateAdjustmentBase {
  currentCompaRatio: number | null;
  newCompaRatio: number | null;
  bandMin: number | null;
  bandMax: number | null;
  bandCurrency: string;
  withinBand: boolean | null;
}
export interface SimulateBandInput {
  min: number;
  mid: number;
  max: number;
  bandCurrency: string;
}
export interface SimulateAdjustmentInput {
  currentSalary: number;
  currentCurrency: string;
  proposedSalary: number;
  proposedCurrency: string;
  proposedSalaryForComparison: number;
  // Present ONLY when the caller is entitled to compaRatio. band is null when the subject has no band; the six
  // compa keys are then ALL present (some null), NOT absent — the absent-vs-present distinction is canSee.
  compa: { currentCompaRatio: number; band: SimulateBandInput | null; proposedSalaryForBand: number } | null;
}

/**
 * The simulate-adjustment shaper. Emits the seven always-present projection fields; the six compa/band fields
 * are spread in ONLY when the caller is entitled to compaRatio (`compa != null`) — absent, NOT nulled, otherwise
 * (the §21 field-auth shape). When entitled but the subject has no band, ALL six keys are present:
 * newCompaRatio/bandMin/bandMax/withinBand are null and bandCurrency falls back to the CURRENT currency (never
 * null — FIX 3 parity). currentCompaRatio is `cr || null` (0 → null). percentageChange round2 (0 when no salary).
 */
export function buildSimulateAdjustment(
  input: SimulateAdjustmentInput,
): SimulateAdjustmentBase | SimulateAdjustmentWithCompa {
  const percentageChange = input.currentSalary
    ? Math.round(((input.proposedSalaryForComparison - input.currentSalary) / input.currentSalary) * 10000) / 100
    : 0;
  const base: SimulateAdjustmentBase = {
    currentSalary: input.currentSalary,
    currency: input.currentCurrency,
    proposedSalary: input.proposedSalary,
    proposedCurrency: input.proposedCurrency,
    proposedSalaryForComparison: input.proposedSalaryForComparison,
    comparisonCurrency: input.currentCurrency,
    percentageChange,
  };
  if (!input.compa) return base;

  const { currentCompaRatio, band, proposedSalaryForBand } = input.compa;
  const midpoint = band ? band.mid : 0;
  return {
    ...base,
    currentCompaRatio: currentCompaRatio || null,
    newCompaRatio: midpoint ? Math.round((proposedSalaryForBand / midpoint) * 100) / 100 : null,
    bandMin: band ? band.min : null,
    bandMax: band ? band.max : null,
    bandCurrency: band ? band.bandCurrency : input.currentCurrency,
    withinBand: band ? proposedSalaryForBand >= band.min && proposedSalaryForBand <= band.max : null,
  };
}
