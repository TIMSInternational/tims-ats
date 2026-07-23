// Pure DEI shaping kernels (Phase-5 people-dashboards strangler, Slice 11b — GROUP 2).
// Extracted from the inline logic of packages/api/src/services/dei.service.ts + routers/dei.ts so BOTH the live
// TS service/router AND the C# port (Tims.Domain.Dei.DeiKernels) consume ONE definition, golden-fixtured against
// contracts/dei-fixtures/. No DB, no I/O, no clock (ageBand takes the clock as a parameter). Rounding uses JS
// Math.round (half-up) — mirror with ReportingMath.JsRound in C#. min-5 k-anon (suppressBelowMin5) is
// byte-identical to packages/api/src/access/aggregate.ts (kept private here so @tims/shared stays leaf-importable
// — shared must never depend on @tims/api).
//
// k-anonymity (Wave 2.5 slice 6, matrix §21): DEI demographics are AGGREGATE access — a group of 1..4 people
// re-identifies individuals, so EVERY per-group distribution routes its head-count through suppressBelowMin5.
// PRESENT-KEY CARDINALITY (round 7): when ANY group/bucket is below the floor, the distributions return an EMPTY
// distribution (NO per-group keys) + a single top-level `suppressed: true` marker — no present keys ⇒ cardinality
// reveals nothing, and N−Σ differencing has nothing to subtract.

const MIN_AGGREGATE_SIZE = 5;

/** k-anon floor — byte-identical to packages/api/src/access/aggregate.ts suppressBelowMin5:
 *  1..4 → suppressed (count null); 0 or ≥5 → not suppressed (an empty bucket reveals no one). */
function suppressBelowMin5(count: number): { suppressed: boolean; count: number | null } {
  if (count > 0 && count < MIN_AGGREGATE_SIZE) return { suppressed: true, count: null };
  return { suppressed: false, count };
}

// ── pct / median / ageBand (shared scalar helpers) ──────────────────────────────

/** Half-up percentage to one decimal (Math.round(count/total*1000)/10); 0 total → 0. */
export function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

/** Median of a numeric list (0 when empty). Even length → half-up round of the two-middle mean (matches the
 *  live getPayEquity path, which still calls this; the C# port is fixture-exercised, ready for Slice 11c). */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export const AGE_BANDS = ['<25', '25-34', '35-44', '45-54', '55+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Server-side age-band bucketing (the raw DOB never leaves the server). Age = full years at `now`. */
export function ageBand(dob: Date, now: Date): AgeBand {
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  if (age < 25) return '<25';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  return '55+';
}

// ── buildDistribution (reads #2/#3/#4/#5/#6) ────────────────────────────────────

export interface DistInput {
  key: string;
  count: number;
}

export interface DistGroup {
  key: string;
  count: number | null;
  percentage: number | null;
  suppressed: boolean;
}

export interface Distribution {
  groups: DistGroup[];
  suppressed: boolean;
}

/**
 * The shared present-key-cardinality distribution shaper. `groups` are the caller-ordered {key,count} buckets
 * (gender/disability = groupBy order; ethnicity/nationality = count-desc; age = the fixed AGE_BANDS order incl.
 * 0-count bands). `extraBuckets` are implicit missing-value groups (nationality → nullNationalityCount, age →
 * nullDobCount) folded into the suppression trigger without ever being emitted as a key. When `total`, ANY
 * extraBucket, OR ANY group count is 1..4, emit an EMPTY distribution (no keys) + suppressed:true. Otherwise every
 * group clears the floor → publish counts/percentages (percentage over `total`). A 0-count bucket passes through
 * (an empty bucket reveals no individual).
 */
export function buildDistribution(groups: DistInput[], total: number, extraBuckets: number[] = []): Distribution {
  const suppressed =
    suppressBelowMin5(total).suppressed ||
    extraBuckets.some((b) => suppressBelowMin5(b).suppressed) ||
    groups.some((g) => suppressBelowMin5(g.count).suppressed);
  if (suppressed) return { groups: [], suppressed: true };
  return {
    groups: groups.map((g) => ({ key: g.key, count: g.count, percentage: pct(g.count, total), suppressed: false })),
    suppressed: false,
  };
}

// ── leadershipDiversity (read #8) ───────────────────────────────────────────────

export interface LeaderGroup {
  gender: string;
  count: number | null;
  percentage: number | null;
  suppressed: boolean;
}

export interface LeadershipDiversity {
  totalLeaders: number | null;
  byGender: LeaderGroup[];
  suppressed: boolean;
}

/**
 * getLeadershipDiversity shaper: group the leader pool by gender with the present-key cardinality guard. When the
 * pool is 1..4 OR ANY leader-gender group is below the floor, emit an EMPTY byGender + null totalLeaders +
 * suppressed:true (the gender-key set pins values at tiny N; totalLeaders − Σ visible recovers a suppressed
 * group). 0 leaders passes through as a non-suppressed empty pool. Group order = first-seen leader order.
 */
export function leadershipDiversity(leaderGenders: string[]): LeadershipDiversity {
  const total = leaderGenders.length;
  const counts = new Map<string, number>();
  for (const g of leaderGenders) counts.set(g, (counts.get(g) ?? 0) + 1);

  const suppressed =
    suppressBelowMin5(total).suppressed || [...counts.values()].some((c) => suppressBelowMin5(c).suppressed);
  if (suppressed) {
    return { totalLeaders: null, byGender: [], suppressed: true };
  }
  return {
    totalLeaders: total,
    byGender: [...counts.entries()].map(([gender, count]) => ({
      gender,
      count: count as number | null,
      percentage: pct(count, total) as number | null,
      suppressed: false,
    })),
    suppressed: false,
  };
}

// ── buildPayEquity (read #12, Slice 11c) ────────────────────────────────────────
//
// The PURE pay-equity SHAPING kernel — a faithful extraction of the tail of dei.service.getPayEquity (the FX
// conversion + the raw byGender/skipped/demographic build stay in the impure service; the C# port mirrors this
// as DeiKernels.BuildPayEquity). Given each gender cohort's ALREADY-CONVERTED positive salaries (first-seen
// order), the FULL demographic gender counts, and the skipped-salaried (missing/undisclosed-gender) count, it
// applies the min-5 anti-differencing guard and, when clear, emits per-gender count/avg/median + the
// female-vs-male median gap%. Golden-fixtured BOTH stacks (contracts/dei-fixtures/pay-equity.json).

export interface PayEquityGenderInput {
  gender: string;
  convertedSalaries: number[];
}
export interface PayEquityGroupOut {
  group: string;
  count: number | null;
  averageSalary: number | null;
  medianSalary: number | null;
  suppressed: boolean;
}
export interface PayEquityView {
  results: PayEquityGroupOut[];
  gapPct: number | null;
  suppressed: boolean;
  currency: string;
}

/**
 * The pay-equity shaper. Suppression (all-or-nothing, present-key cardinality) fires when the TOTAL
 * gendered+salaried population is 1..4, OR the skipped-salaried implicit bucket is 1..4, OR ANY gender's
 * non-positive-salary complement (demographicCount − salaried) is 1..4, OR ANY cohort is 1..4 — then EMPTY
 * results + null gap + suppressed (no group keys survive). averageSalary = JS half-up round of the mean;
 * medianSalary = the shared median (odd → the middle value, even → half-up mean of the two middles).
 * gapPct = round((fMed−mMed)/mMed*1000)/10, null unless BOTH female + male cohorts exist with a positive male median.
 */
export function buildPayEquity(
  byGender: PayEquityGenderInput[],
  demographicGenderCounts: Record<string, number>,
  skippedSalaried: number,
  currency: string,
): PayEquityView {
  const populationTotal = byGender.reduce((sum, g) => sum + g.convertedSalaries.length, 0);

  // Per-gender non-positive-salary complement: demographicCount − salariedCount. A 1..4 complement is a
  // recoverable bucket (getGenderRepresentation publishes the demographic count), so fold it into the trigger.
  const anyComplementSubFloor = byGender.some((g) => {
    const demographic = demographicGenderCounts[g.gender] ?? g.convertedSalaries.length;
    return suppressBelowMin5(demographic - g.convertedSalaries.length).suppressed;
  });

  const suppressed =
    suppressBelowMin5(populationTotal).suppressed ||
    suppressBelowMin5(skippedSalaried).suppressed ||
    anyComplementSubFloor ||
    byGender.some((g) => suppressBelowMin5(g.convertedSalaries.length).suppressed);
  if (suppressed) {
    return { results: [], gapPct: null, suppressed: true, currency };
  }

  let femaleMedian: number | null = null;
  let maleMedian: number | null = null;
  const results = byGender.map((g): PayEquityGroupOut => {
    const salaries = g.convertedSalaries;
    const averageSalary = Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length);
    const medianSalary = median(salaries);
    if (g.gender === 'female') femaleMedian = medianSalary;
    else if (g.gender === 'male') maleMedian = medianSalary;
    return { group: g.gender, count: salaries.length, averageSalary, medianSalary, suppressed: false };
  });

  const gapPct =
    femaleMedian !== null && maleMedian !== null && maleMedian > 0
      ? Math.round(((femaleMedian - maleMedian) / maleMedian) * 1000) / 10
      : null;
  return { results, gapPct, suppressed: false, currency };
}

// ── deiDashboardKpis (read #1) ──────────────────────────────────────────────────

export interface DashboardKpisInput {
  totalEmployees: number;
  withDemographics: number;
  genders: DistInput[];
  nationalities: DistInput[];
  nullNationalityCount: number;
  nullDobCount: number;
  ethnicities: DistInput[];
  leaderGenders: string[];
}

export interface DashboardKpis {
  totalEmployees: number;
  demographicsCoverage: number | null;
  genderParityIndex: number | null;
  womenPct: number | null;
  leadershipWomenPct: number | null;
  totalNationalities: number | null;
}

/**
 * getDashboardKpis shaper: the headline ratios + the cross-endpoint DIFFERENCING suppression (slice-6 rounds
 * 2-8). genderParityIndex/womenPct are nulled when ANY gender group is sub-floor; leadershipWomenPct when ANY
 * leader-gender group is sub-floor; demographicsCoverage when ANY dynamic demographic distribution
 * (gender / nationality+its null bucket / ethnicity / the null-DOB bucket) is sub-floor — because
 * demographicsCoverage × totalEmployees reconstructs withDemographics, the denominator every distribution
 * differences against. totalNationalities mirrors getNationalityDiversity's trigger exactly. totalEmployees (bare
 * org head-count) and the parity ratios expose no gender split once the per-group counts are nulled.
 */
export function deiDashboardKpis(input: DashboardKpisInput): DashboardKpis {
  const byGender = new Map<string, number>();
  for (const g of input.genders) byGender.set(g.key, g.count);
  const female = byGender.get('female') ?? 0;
  const male = byGender.get('male') ?? 0;
  const genderKnown = input.genders.reduce((sum, g) => sum + (g.key === 'undisclosed' ? 0 : g.count), 0);
  const genderParityIndex =
    Math.max(female, male) > 0 ? Math.round((Math.min(female, male) / Math.max(female, male)) * 100) / 100 : 0;

  const leaderCounts = new Map<string, number>();
  for (const g of input.leaderGenders) leaderCounts.set(g, (leaderCounts.get(g) ?? 0) + 1);
  const leaderFemale = leaderCounts.get('female') ?? 0;

  const anyGenderSuppressed = input.genders.some((g) => suppressBelowMin5(g.count).suppressed);
  const anyLeaderGenderSuppressed = [...leaderCounts.values()].some((c) => suppressBelowMin5(c).suppressed);

  const nationalityPopulation = input.nationalities.reduce((sum, n) => sum + n.count, 0);
  const anyNationalitySuppressed = input.nationalities.some((n) => suppressBelowMin5(n.count).suppressed);
  const nationalitySuppressed =
    suppressBelowMin5(nationalityPopulation).suppressed ||
    suppressBelowMin5(input.nullNationalityCount).suppressed ||
    anyNationalitySuppressed;

  const ethnicityPopulation = input.ethnicities.reduce((sum, e) => sum + e.count, 0);
  const ethnicitySuppressed =
    suppressBelowMin5(ethnicityPopulation).suppressed ||
    input.ethnicities.some((e) => suppressBelowMin5(e.count).suppressed);
  const nullDobSuppressed = suppressBelowMin5(input.nullDobCount).suppressed;
  const anyDemographicSuppressed =
    anyGenderSuppressed || nationalitySuppressed || ethnicitySuppressed || nullDobSuppressed;

  return {
    totalEmployees: input.totalEmployees,
    demographicsCoverage: anyDemographicSuppressed ? null : pct(input.withDemographics, input.totalEmployees),
    genderParityIndex: anyGenderSuppressed ? null : genderParityIndex,
    womenPct: anyGenderSuppressed ? null : pct(female, genderKnown),
    leadershipWomenPct: anyLeaderGenderSuppressed ? null : pct(leaderFemale, input.leaderGenders.length),
    totalNationalities: nationalitySuppressed ? null : (input.nationalities.length as number | null),
  };
}

// ── inclusionIndex (read #11) ───────────────────────────────────────────────────

export interface InclusionIndexResult {
  index: number | null;
  totalResponses: number | null;
  suppressed: boolean;
  questionsEvaluated?: number;
}

/**
 * getInclusionIndex multi-tier suppression (slice-6 rounds 5/9). Survey-level floor first (1..4 respondents →
 * whole result nulled). No inclusion question → no index, just the (≥5) respondent count. Else the index average
 * is over the CONTRIBUTOR set; suppress when EITHER the contributors OR the complementary skip bucket (respondents
 * − contributors) is 1..4 — a contributor/skip all-or-nothing policy. `responses` carry only their `answers`
 * (answers-only minimal select). 0 respondents passes through unsuppressed.
 */
export function inclusionIndex(
  questions: Array<Record<string, unknown>>,
  responses: Array<{ answers: Record<string, unknown> | null }>,
): InclusionIndexResult {
  const total = responses.length;
  if (suppressBelowMin5(total).suppressed) {
    return { index: null, totalResponses: null, suppressed: true };
  }

  const inclusionQuestions = questions.filter((q) => q.category === 'inclusion');
  if (!inclusionQuestions.length) {
    return { index: null, totalResponses: total, suppressed: false };
  }

  let contributingRespondents = 0;
  const scores = responses.flatMap((r) => {
    const rowScores = inclusionQuestions
      .map((q) => Number((r.answers as Record<string, unknown> | null)?.[q.text as string]))
      .filter((n) => !isNaN(n));
    if (rowScores.length) contributingRespondents += 1;
    return rowScores;
  });

  const inclusionSkipped = total - contributingRespondents;
  if (
    suppressBelowMin5(contributingRespondents).suppressed ||
    suppressBelowMin5(inclusionSkipped).suppressed
  ) {
    return { index: null, totalResponses: total, suppressed: true };
  }

  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  return {
    index: Math.round(avg * 100) / 100,
    totalResponses: total,
    suppressed: false,
    questionsEvaluated: inclusionQuestions.length,
  };
}
