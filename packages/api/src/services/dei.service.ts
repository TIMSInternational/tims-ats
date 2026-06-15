import { deiRepository } from '../repositories/dei.repository';
import { suppressBelowMin5 } from '../access';

// ---------------------------------------------------------------------------
// DEI service — turns demographic aggregates into the metrics the dashboard
// shows. All inputs are already grouped counts (no individual rows); this layer
// only computes percentages, age bands, parity ratios, and pay gaps.
//
// k-anonymity (Wave 2.5 slice 6, matrix §21): DEI Demographics are AGGREGATE
// access — a demographic group of 1..4 people re-identifies individuals, so
// EVERY per-group distribution routes its head-count through suppressBelowMin5.
//
// PRESENT-KEY CARDINALITY (round 7): the round-5 design nulled per-group
// counts/percentages but STILL EMITTED THE GROUP KEYS with a uniform suppressed
// flag. That leaks: with N=5 published and 5 present band/nationality keys, each
// group pins to 1 (singleton). The set of present keys + an exposed total is a
// covert head-count channel. So round 7 SUPERSEDES the uniform-flag-keep-keys
// approach: when ANY group/bucket/band/area (incl. the implicit unbanded/skipped
// bucket) is below the min-5 floor, return an EMPTY distribution (NO per-group
// keys at all) plus a single top-level `suppressed: true` marker. No present
// keys ⇒ cardinality reveals nothing. min-5 IS the access mechanism here — it
// sits on top of the `dei:read` permission gate, not as a replacement.
// ---------------------------------------------------------------------------

const AGE_BANDS = ['<25', '25-34', '35-44', '45-54', '55+'] as const;

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function ageBand(dob: Date, now: Date): (typeof AGE_BANDS)[number] {
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  if (age < 25) return '<25';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  return '55+';
}

export const deiService = {
  async getDashboardKpis(orgId: string) {
    const [totalEmployees, withDemographics, genders, nationalities, nullNationalityCount, nullDobCount, ethnicities, leaders] = await Promise.all([
      deiRepository.countActiveEmployees(orgId),
      deiRepository.countWithDemographics(orgId),
      deiRepository.genderCounts(orgId),
      deiRepository.nationalityCounts(orgId),
      deiRepository.nullNationalityCount(orgId),
      deiRepository.nullBirthDateCount(orgId),
      deiRepository.ethnicityCounts(orgId),
      deiRepository.leadershipGenders(orgId),
    ]);

    const byGender = Object.fromEntries(genders.map((g) => [g.gender, g._count._all]));
    const female = byGender.female ?? 0;
    const male = byGender.male ?? 0;
    const genderKnown = genders.reduce((sum, g) => sum + (g.gender === 'undisclosed' ? 0 : g._count._all), 0);
    const genderParityIndex = Math.max(female, male) > 0 ? Math.round((Math.min(female, male) / Math.max(female, male)) * 100) / 100 : 0;

    // Per-leader-gender head-counts (mirror getLeadershipDiversity's grouping).
    const leaderCounts = new Map<string, number>();
    for (const l of leaders) leaderCounts.set(l.gender, (leaderCounts.get(l.gender) ?? 0) + 1);
    const leaderFemale = leaderCounts.get('female') ?? 0;

    // Cross-endpoint differencing guard (slice 6, reviewer finding): the distribution
    // endpoints (getGenderRepresentation, getLeadershipDiversity) suppress small
    // gender/leader groups, but these KPIs publish ratios derived from the SAME counts.
    // With female=3 (suppressed in the distribution) but male=20 visible and womenPct=13.0,
    // an attacker recovers female = round(13.0% * (3+20)) = 3. Same for leadership
    // (female=2 of 10, leadershipWomenPct=20 + visible male=8 → female=2). So when ANY
    // gender group is below the min-5 floor we null genderParityIndex AND womenPct; when
    // ANY leader-gender group is below the floor we null leadershipWomenPct. The floor
    // decision matches the distribution endpoints exactly (per-group suppressBelowMin5).
    // Denominator-oracle guard (slice 6 round 2): demographicsCoverage is
    // pct(withDemographics, totalEmployees). With totalEmployees published (org
    // headcount) an attacker reconstructs withDemographics = round(coverage% ×
    // totalEmployees) = the EXACT gender-distribution denominator N_g (gender groups
    // are counted over the demographics population). Combined with the round-1 leak
    // (visible male=20) that recovered female; the round-2 fix nulls all per-gender
    // counts in getGenderRepresentation, but a recovered N_g is still a per-gender
    // denominator that we must not hand out. So null demographicsCoverage whenever any
    // gender group is sub-floor. totalEmployees (bare org headcount) and
    // totalNationalities (distinct-value count) reveal no gender split once every
    // per-gender count is nulled in the distribution endpoint, so they stay.
    const anyGenderSuppressed = genders.some((g) => suppressBelowMin5(g._count._all).suppressed);
    const anyLeaderGenderSuppressed = [...leaderCounts.values()].some((c) => suppressBelowMin5(c).suppressed);

    // totalNationalities cardinality oracle (round 6, MEDIUM 6): getNationalityDiversity
    // EMPTIES its distribution (and nulls totalNationalities) when the nationality
    // population is 1..4 OR any nationality group is sub-floor. Publishing
    // nationalities.length here regardless re-exposes the distinct-group cardinality that
    // the distribution endpoint deliberately hid (and, at tiny N, the NUMBER of groups
    // pins values). Mirror getNationalityDiversity's trigger exactly: null
    // totalNationalities whenever its distribution would be suppressed/empty.
    // Null-bucket implicit group (round 8): getNationalityDiversity now folds the
    // null-nationality count into its suppression trigger, so mirror it here exactly —
    // otherwise totalNationalities would publish a distinct-group count that the
    // distribution endpoint has empties at the same time.
    const nationalityPopulation = nationalities.reduce((sum, n) => sum + n._count._all, 0);
    const anyNationalitySuppressed = nationalities.some((n) => suppressBelowMin5(n._count._all).suppressed);
    const nationalitySuppressed =
      suppressBelowMin5(nationalityPopulation).suppressed ||
      suppressBelowMin5(nullNationalityCount).suppressed ||
      anyNationalitySuppressed;

    // Belt-and-suspenders (round 7, finding 3): demographicsCoverage × totalEmployees
    // reconstructs the demographics-population denominator N_g shared by ALL dynamic
    // demographic distributions (gender/nationality/ethnicity). Round 2 nulled it only
    // when a GENDER group was suppressed, but a sub-floor NATIONALITY or ETHNICITY
    // distribution empties at tiny N and leaves the same recoverable denominator. So
    // null demographicsCoverage whenever ANY dynamic demographic distribution is
    // suppressed. (ethnicity distribution empties when its population is <5 OR any
    // ethnicity group is sub-floor — mirror getEthnicityDistribution's trigger.)
    const ethnicityPopulation = ethnicities.reduce((sum, e) => sum + e._count._all, 0);
    const ethnicitySuppressed =
      suppressBelowMin5(ethnicityPopulation).suppressed ||
      ethnicities.some((e) => suppressBelowMin5(e._count._all).suppressed);
    // Null-DOB bucket (round 8): getAgeDistribution suppresses its whole distribution when
    // the missing-DOB bucket is 1..4, but demographicsCoverage × totalEmployees reconstructs
    // withDemographics — the denominator (withDemographics − Σ visible bands) the age
    // distribution differences against. So null demographicsCoverage when the null-DOB
    // bucket trips too. (nationalitySuppressed already folds in the null-nationality bucket.)
    const nullDobSuppressed = suppressBelowMin5(nullDobCount).suppressed;
    const anyDemographicSuppressed =
      anyGenderSuppressed || nationalitySuppressed || ethnicitySuppressed || nullDobSuppressed;

    return {
      totalEmployees,
      demographicsCoverage: anyDemographicSuppressed ? null : pct(withDemographics, totalEmployees),
      genderParityIndex: anyGenderSuppressed ? null : genderParityIndex,
      womenPct: anyGenderSuppressed ? null : pct(female, genderKnown),
      leadershipWomenPct: anyLeaderGenderSuppressed ? null : pct(leaderFemale, leaders.length),
      totalNationalities: nationalitySuppressed ? null : (nationalities.length as number | null),
    };
  },

  async getGenderRepresentation(orgId: string) {
    const counts = await deiRepository.genderCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    // Present-key cardinality (round 7): when the demographics population is 1..4 OR
    // ANY gender group is below the min-5 floor, emit an EMPTY distribution (no
    // per-group keys) + a top-level `suppressed: true` marker. Emitting the keys —
    // even with counts/percentages nulled — leaks via cardinality: N present + the
    // set of group keys pins singleton groups, and a known population total recovers
    // a suppressed group (N − Σ visible). With no keys at all, nothing is recoverable.
    // 0 population passes through as a non-suppressed empty distribution (no person).
    const suppressed =
      suppressBelowMin5(total).suppressed || counts.some((c) => suppressBelowMin5(c._count._all).suppressed);
    type GenderOut = { gender: string; count: number | null; percentage: number | null; suppressed: boolean };
    if (suppressed) return { groups: [] as GenderOut[], suppressed: true };
    return {
      groups: counts.map((c): GenderOut => ({ gender: c.gender, count: c._count._all, percentage: pct(c._count._all, total), suppressed: false })),
      suppressed: false,
    };
  },

  async getAgeDistribution(orgId: string) {
    const [rows, nullDobCount] = await Promise.all([
      deiRepository.birthDates(orgId),
      deiRepository.nullBirthDateCount(orgId),
    ]);
    const now = new Date();
    const buckets: Record<string, number> = Object.fromEntries(AGE_BANDS.map((b) => [b, 0]));
    for (const r of rows) {
      if (r.dateOfBirth) buckets[ageBand(r.dateOfBirth, now)]++;
    }
    const total = rows.length;
    // Present-key cardinality (round 7): when the population is 1..4 OR ANY band is
    // below the floor, emit an EMPTY distribution (no band keys) + top-level
    // `suppressed: true`. Even the FIXED band set leaks at tiny N (a single nonzero
    // band pins the people), and a visible band count + a known total N recovers a
    // suppressed band. No band keys ⇒ nothing recoverable. 0 population passes through
    // as a non-suppressed empty distribution (reveals no person).
    //
    // Null-bucket implicit group (round 8): birthDates() excludes rows with no DOB, so
    // the people WITHOUT a recorded DOB never participate in suppression — yet
    // getDashboardKpis.demographicsCoverage × totalEmployees reconstructs withDemographics
    // and (withDemographics − Σ visible bands) recovers the missing-DOB bucket. Fold the
    // null-DOB count in as an implicit group: if it is 1..4, suppress the whole
    // distribution (empty + suppressed), same as any sub-floor band. 0 passes through.
    const suppressed =
      suppressBelowMin5(total).suppressed ||
      suppressBelowMin5(nullDobCount).suppressed ||
      AGE_BANDS.some((range) => suppressBelowMin5(buckets[range]!).suppressed);
    type AgeOut = { range: string; count: number | null; percentage: number | null; suppressed: boolean };
    if (suppressed) return { groups: [] as AgeOut[], suppressed: true };
    return {
      groups: AGE_BANDS.map((range): AgeOut => ({ range, count: buckets[range]!, percentage: pct(buckets[range]!, total), suppressed: false })),
      suppressed: false,
    };
  },

  async getNationalityDiversity(orgId: string) {
    const [counts, nullNationalityCount] = await Promise.all([
      deiRepository.nationalityCounts(orgId),
      deiRepository.nullNationalityCount(orgId),
    ]);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    // Present-key cardinality (round 7): when the population is 1..4 OR ANY nationality
    // group is below the floor, emit an EMPTY distribution (no nationality keys) + null
    // totalNationalities + top-level `suppressed: true`. The NUMBER of distinct keys
    // pins values at tiny N, and a present-key set + a known total recovers a suppressed
    // group; emitting NO keys closes both. This SUPERSEDES the round-5/6 "keep keys,
    // null counts, alphabetical-sort, mask total" approach — with no keys there is no
    // sort-order channel and no cardinality left to leak. 0 passes through unsuppressed.
    //
    // Null-bucket implicit group (round 8): nationalityCounts() filters out null
    // nationality, so people WITHOUT a recorded nationality never participate in
    // suppression — yet getDashboardKpis.demographicsCoverage × totalEmployees recovers
    // withDemographics and (withDemographics − Σ visible) recovers the missing bucket.
    // Fold the null-nationality count in as an implicit group: if it is 1..4, suppress
    // the whole distribution (empty + null total + suppressed). 0 passes through.
    type NatOut = { nationality: string; count: number | null; percentage: number | null; suppressed: boolean };
    const suppressed =
      suppressBelowMin5(total).suppressed ||
      suppressBelowMin5(nullNationalityCount).suppressed ||
      counts.some((c) => suppressBelowMin5(c._count._all).suppressed);
    if (suppressed) {
      return { totalNationalities: null as number | null, distribution: [] as NatOut[], suppressed: true };
    }
    // Not suppressed: every group clears the floor → publish counts/percentages,
    // descending-by-count (a non-sensitive ranking once all counts are >=5 and visible).
    const distribution: NatOut[] = counts
      .map((c) => ({ nationality: c.nationality as string, count: c._count._all as number | null, percentage: pct(c._count._all, total) as number | null, suppressed: false, _sort: c._count._all }))
      .sort((a, b) => b._sort - a._sort)
      .map(({ _sort, ...rest }) => rest);
    return { totalNationalities: distribution.length as number | null, distribution, suppressed: false };
  },

  async getEthnicityDistribution(orgId: string) {
    const counts = await deiRepository.ethnicityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    // Present-key cardinality (round 7): empty distribution + top-level suppressed when
    // the population is 1..4 OR any ethnicity group is below the floor. No keys ⇒ no
    // cardinality, no sort-order channel, no N − Σ differencing. 0 passes through.
    type EthOut = { ethnicity: string; count: number | null; percentage: number | null; suppressed: boolean };
    const suppressed =
      suppressBelowMin5(total).suppressed || counts.some((c) => suppressBelowMin5(c._count._all).suppressed);
    if (suppressed) return { groups: [] as EthOut[], suppressed: true };
    const groups: EthOut[] = counts
      .map((c) => ({ ethnicity: c.ethnicity, count: c._count._all as number | null, percentage: pct(c._count._all, total) as number | null, suppressed: false, _sort: c._count._all }))
      .sort((a, b) => b._sort - a._sort)
      .map(({ _sort, ...rest }) => rest);
    return { groups, suppressed: false };
  },

  async getDisabilityDistribution(orgId: string) {
    const counts = await deiRepository.disabilityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    // Present-key cardinality (round 7): empty distribution + top-level suppressed when
    // the population is 1..4 OR any status group is below the floor. No keys survive.
    type DisOut = { status: string; count: number | null; percentage: number | null; suppressed: boolean };
    const suppressed =
      suppressBelowMin5(total).suppressed || counts.some((c) => suppressBelowMin5(c._count._all).suppressed);
    if (suppressed) return { groups: [] as DisOut[], suppressed: true };
    return {
      groups: counts.map((c): DisOut => ({ status: c.disabilityStatus, count: c._count._all as number | null, percentage: pct(c._count._all, total) as number | null, suppressed: false })),
      suppressed: false,
    };
  },

  async getPayEquity(orgId: string) {
    const [rows, genderDemographicCounts] = await Promise.all([
      deiRepository.salaryWithGender(orgId),
      // Full per-gender demographic counts — the SAME population getGenderRepresentation
      // publishes. Needed to fold the non-positive-salary complement (round 13-14, below).
      deiRepository.genderCounts(orgId),
    ]);
    const byGender = new Map<string, number[]>();
    // Implicit skipped-salaried bucket (round 8): rows whose gender is missing or
    // 'undisclosed' are dropped from the visible per-gender groups, but they ARE salaried
    // contributors counted in getTotalCompBreakdown's org salary total / employeeCount. So
    // with female=5 + male=5 visible but 1..4 undisclosed/no-demographics salaried people,
    // that skipped bucket's count+salary is recoverable as N − Σ(visible). Count it as an
    // implicit group and fold it into the suppression trigger below — never emit it as a key.
    let skippedSalaried = 0;
    for (const r of rows) {
      const gender = r.user.demographics?.gender;
      const salary = Number(r.currentSalary);
      if (!gender || gender === 'undisclosed') {
        if (salary) skippedSalaried++;
        continue;
      }
      if (!salary) continue;
      let arr = byGender.get(gender);
      if (!arr) { arr = []; byGender.set(gender, arr); }
      arr.push(salary);
    }

    // Per-gender non-positive-salary complement (round 13-14): getPayEquity's per-gender
    // count is the POSITIVE-SALARIED-gendered population (rows with `!salary` are dropped by
    // the `continue` above, and people with no comp row are absent from salaryWithGender
    // entirely). getGenderRepresentation, however, publishes the FULL demographic gender
    // count (employeeDemographics grouped by gender). So:
    //   genderRepresentation.female.count − payEquity.female.count = the female
    //   demographic rows WITHOUT a positive salary (zero-salary or no comp row) — a
    //   complementary bucket that is recoverable when it is 1..4.
    // Fold that complement (per visible gender group) into the all-or-nothing trigger: if
    // ANY gender's non-positive-salary complement is 1..4, suppress the whole pay-equity
    // result. The complement is computed against the canonical demographic gender count
    // (the exact operand getGenderRepresentation exposes), closing the subtraction at its
    // source. 'undisclosed'/missing genders are not emitted by getGenderRepresentation as a
    // differenceable per-group operand here and are already covered by skippedSalaried.
    const demographicGenderCount = new Map<string, number>();
    for (const g of genderDemographicCounts) demographicGenderCount.set(g.gender, g._count._all);
    const anyGenderComplementSubFloor = [...byGender.entries()].some(([gender, salaries]) => {
      const demographic = demographicGenderCount.get(gender) ?? salaries.length;
      const nonPositiveComplement = demographic - salaries.length;
      return suppressBelowMin5(nonPositiveComplement).suppressed;
    });

    // min-5 (slice 6): a small group's average/median ARE individual salary data.
    // Route each group's head-count through suppressBelowMin5; when suppressed, null
    // the count AND both salary stats so no per-person salary leaks. medianSalary is
    // kept internally (_median) only to compute the headline gap, and the gap is
    // itself suppressed unless BOTH the female and male groups clear the min-5 floor.
    //
    // Present-key cardinality (round 7): when the total gendered+salaried population is
    // 1..4 OR ANY gender group is below the floor, emit EMPTY results (no group keys) +
    // null gap + top-level `suppressed: true`. A small group's average/median ARE
    // individual salary data, and the present-key set + a known gender denominator
    // recovers a suppressed group's size — no keys closes both. 0 passes through.
    type PayOut = { group: string; count: number | null; averageSalary: number | null; medianSalary: number | null; suppressed: boolean };
    const populationTotal = [...byGender.values()].reduce((sum, salaries) => sum + salaries.length, 0);
    // The implicit skipped-salaried bucket participates in the suppression decision (so a
    // 1..4 undisclosed/no-demographics bucket trips the floor and empties the results),
    // but is NEVER emitted as a group key — it would itself be a sub-floor disclosure.
    const suppressed =
      suppressBelowMin5(populationTotal).suppressed ||
      suppressBelowMin5(skippedSalaried).suppressed ||
      anyGenderComplementSubFloor ||
      [...byGender.values()].some((salaries) => suppressBelowMin5(salaries.length).suppressed);
    if (suppressed) {
      return { results: [] as PayOut[], gapPct: null as number | null, suppressed: true };
    }

    const results = [...byGender.entries()].map(([group, salaries]) => ({
      group,
      count: salaries.length,
      averageSalary: Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length),
      medianSalary: median(salaries),
      suppressed: false,
      _median: median(salaries) as number | null,
    }));

    // Headline gap: female vs male median (negative = women paid less). Every group
    // cleared the floor (else we returned suppressed above), so both medians exist.
    const f = results.find((r) => r.group === 'female');
    const m = results.find((r) => r.group === 'male');
    const gapPct = f && m && f._median !== null && m._median !== null && m._median > 0
      ? Math.round(((f._median - m._median) / m._median) * 1000) / 10
      : null;

    return { results: results.map(({ _median, ...rest }): PayOut => rest), gapPct, suppressed: false };
  },

  async getLeadershipDiversity(orgId: string) {
    const leaders = await deiRepository.leadershipGenders(orgId);
    const total = leaders.length;
    const counts = new Map<string, number>();
    for (const l of leaders) counts.set(l.gender, (counts.get(l.gender) ?? 0) + 1);

    // Present-key cardinality (round 7): when the leader pool is 1..4 OR ANY leader-
    // gender group is below the floor, emit an EMPTY byGender (no gender keys) + null
    // totalLeaders + top-level `suppressed: true`. The gender-key set pins values at
    // tiny N, and totalLeaders − Σ visible recovers a suppressed group — no keys closes
    // both. 0 leaders passes through as a non-suppressed empty pool (reveals no person).
    type LeaderOut = { gender: string; count: number | null; percentage: number | null; suppressed: boolean };
    const suppressed =
      suppressBelowMin5(total).suppressed || [...counts.values()].some((count) => suppressBelowMin5(count).suppressed);
    if (suppressed) {
      return { totalLeaders: null as number | null, byGender: [] as LeaderOut[], suppressed: true };
    }
    return {
      totalLeaders: total as number | null,
      byGender: [...counts.entries()].map(([gender, count]): LeaderOut => ({ gender, count: count as number | null, percentage: pct(count, total) as number | null, suppressed: false })),
      suppressed: false,
    };
  },
};
