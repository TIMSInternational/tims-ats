// Pure compensation shaping kernels — the SINGLE SOURCE the TS compensation router returns AND the parity
// target for the C# port (Phase-5 compensation strangler, Slice 9, FX-FREE subset). No DB, no I/O, no clock,
// so they are golden-fixturable from the repo-root vitest AND importable everywhere.
//
// This slice extracts the two FX-FREE aggregate kernels: buildCompaRatioDistribution (read #4 — the meaty
// min-5 kernel) and buildBenefitsUtilization (read #3). The five FX-dependent reads (convertMoney/getFxRate)
// stay in the router and are Slice 9b.
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
