import { deiRepository } from '../repositories/dei.repository';
import { suppressBelowMin5 } from '../access';
import { convertMoney } from '../lib/currency';
import {
  normalizeCurrencyCode,
  AGE_BANDS,
  ageBand,
  median,
  buildDistribution,
  leadershipDiversity,
  deiDashboardKpis,
} from '@tims/shared';

// ---------------------------------------------------------------------------
// DEI service — turns demographic aggregates into the metrics the dashboard
// shows. All inputs are already grouped counts (no individual rows); this layer
// only computes percentages, age bands, parity ratios, and pay gaps.
//
// The suppression + shaping logic lives in the PURE @tims/shared/dei.ts kernels
// (buildDistribution / leadershipDiversity / deiDashboardKpis / ageBand / pct /
// median), golden-fixtured against contracts/dei-fixtures/*.json and shared
// byte-for-byte with the C# port (Tims.Domain.Dei.DeiKernels, Phase-5 Slice 11b).
// This service only threads the repository aggregates into those kernels and
// maps the generic {key,count} distribution shape to each endpoint's field name.
//
// k-anonymity (Wave 2.5 slice 6, matrix §21): a demographic group of 1..4 people
// re-identifies individuals, so the kernels route every per-group head-count
// through the min-5 floor and, when ANY group/bucket is sub-floor, emit an EMPTY
// distribution (no per-group keys) + a single top-level `suppressed: true`. min-5
// IS the disclosure mechanism here — it sits on top of the `dei:read` grant.
// ---------------------------------------------------------------------------

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

    return deiDashboardKpis({
      totalEmployees,
      withDemographics,
      genders: genders.map((g) => ({ key: g.gender, count: g._count._all })),
      nationalities: nationalities.map((n) => ({ key: n.nationality as string, count: n._count._all })),
      nullNationalityCount,
      nullDobCount,
      ethnicities: ethnicities.map((e) => ({ key: e.ethnicity, count: e._count._all })),
      leaderGenders: leaders.map((l) => l.gender),
    });
  },

  async getGenderRepresentation(orgId: string) {
    const counts = await deiRepository.genderCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    const dist = buildDistribution(
      counts.map((c) => ({ key: c.gender, count: c._count._all })),
      total,
    );
    return {
      groups: dist.groups.map((g) => ({ gender: g.key, count: g.count, percentage: g.percentage, suppressed: g.suppressed })),
      suppressed: dist.suppressed,
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
    // Fixed AGE_BANDS order (incl. 0-count bands); the null-DOB count is an implicit group folded into the
    // suppression trigger (birthDates() excludes null-DOB rows, so they would otherwise never participate).
    const dist = buildDistribution(
      AGE_BANDS.map((range) => ({ key: range, count: buckets[range]! })),
      total,
      [nullDobCount],
    );
    return {
      groups: dist.groups.map((g) => ({ range: g.key, count: g.count, percentage: g.percentage, suppressed: g.suppressed })),
      suppressed: dist.suppressed,
    };
  },

  async getNationalityDiversity(orgId: string) {
    const [counts, nullNationalityCount] = await Promise.all([
      deiRepository.nationalityCounts(orgId),
      deiRepository.nullNationalityCount(orgId),
    ]);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    // Descending-by-count ranking (non-sensitive once every count is >=5 and visible); the null-nationality
    // count is an implicit group folded into the suppression trigger.
    const sorted = counts
      .map((c) => ({ key: c.nationality as string, count: c._count._all }))
      .sort((a, b) => b.count - a.count);
    const dist = buildDistribution(sorted, total, [nullNationalityCount]);
    if (dist.suppressed) {
      return { totalNationalities: null as number | null, distribution: [] as Array<{ nationality: string; count: number | null; percentage: number | null; suppressed: boolean }>, suppressed: true };
    }
    const distribution = dist.groups.map((g) => ({ nationality: g.key, count: g.count, percentage: g.percentage, suppressed: g.suppressed }));
    return { totalNationalities: distribution.length as number | null, distribution, suppressed: false };
  },

  async getEthnicityDistribution(orgId: string) {
    const counts = await deiRepository.ethnicityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    const sorted = counts
      .map((c) => ({ key: c.ethnicity, count: c._count._all }))
      .sort((a, b) => b.count - a.count);
    const dist = buildDistribution(sorted, total);
    return {
      groups: dist.groups.map((g) => ({ ethnicity: g.key, count: g.count, percentage: g.percentage, suppressed: g.suppressed })),
      suppressed: dist.suppressed,
    };
  },

  async getDisabilityDistribution(orgId: string) {
    const counts = await deiRepository.disabilityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    const dist = buildDistribution(
      counts.map((c) => ({ key: c.disabilityStatus, count: c._count._all })),
      total,
    );
    return {
      groups: dist.groups.map((g) => ({ status: g.key, count: g.count, percentage: g.percentage, suppressed: g.suppressed })),
      suppressed: dist.suppressed,
    };
  },

  async getPayEquity(orgId: string) {
    const [rows, genderDemographicCounts, currencySource] = await Promise.all([
      deiRepository.salaryWithGender(orgId),
      // Full per-gender demographic counts — the SAME population getGenderRepresentation
      // publishes. Needed to fold the non-positive-salary complement (round 13-14, below).
      deiRepository.genderCounts(orgId),
      deiRepository.displayCurrency(orgId),
    ]);
    const displayCurrency = normalizeCurrencyCode(currencySource?.currency, 'USD');
    const byGender = new Map<string, Array<{ amount: number; currency: string | null | undefined }>>();
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
      arr.push({ amount: salary, currency: r.currency });
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
      return { results: [] as PayOut[], gapPct: null as number | null, suppressed: true, currency: displayCurrency };
    }

    const results = await Promise.all(
      [...byGender.entries()].map(async ([group, salaries]) => {
        const convertedSalaries = await Promise.all(
          salaries.map((s) => convertMoney(s.amount, s.currency, displayCurrency).then((m) => m.amount)),
        );
        const medianSalary = median(convertedSalaries);
        return {
          group,
          count: salaries.length,
          averageSalary: Math.round(convertedSalaries.reduce((a, b) => a + b, 0) / convertedSalaries.length),
          medianSalary,
          suppressed: false,
          _median: medianSalary as number | null,
        };
      }),
    );

    // Headline gap: female vs male median (negative = women paid less). Every group
    // cleared the floor (else we returned suppressed above), so both medians exist.
    const f = results.find((r) => r.group === 'female');
    const m = results.find((r) => r.group === 'male');
    const gapPct = f && m && f._median !== null && m._median !== null && m._median > 0
      ? Math.round(((f._median - m._median) / m._median) * 1000) / 10
      : null;

    return { results: results.map(({ _median, ...rest }): PayOut => rest), gapPct, suppressed: false, currency: displayCurrency };
  },

  async getLeadershipDiversity(orgId: string) {
    const leaders = await deiRepository.leadershipGenders(orgId);
    return leadershipDiversity(leaders.map((l) => l.gender));
  },
};
