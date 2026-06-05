import { deiRepository } from '../repositories/dei.repository';

// ---------------------------------------------------------------------------
// DEI service — turns demographic aggregates into the metrics the dashboard
// shows. All inputs are already grouped counts (no individual rows); this layer
// only computes percentages, age bands, parity ratios, and pay gaps.
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
    const [totalEmployees, withDemographics, genders, nationalities, leaders] = await Promise.all([
      deiRepository.countActiveEmployees(orgId),
      deiRepository.countWithDemographics(orgId),
      deiRepository.genderCounts(orgId),
      deiRepository.nationalityCounts(orgId),
      deiRepository.leadershipGenders(orgId),
    ]);

    const byGender = Object.fromEntries(genders.map((g) => [g.gender, g._count._all]));
    const female = byGender.female ?? 0;
    const male = byGender.male ?? 0;
    const genderKnown = genders.reduce((sum, g) => sum + (g.gender === 'undisclosed' ? 0 : g._count._all), 0);
    const genderParityIndex = Math.max(female, male) > 0 ? Math.round((Math.min(female, male) / Math.max(female, male)) * 100) / 100 : 0;

    const leaderFemale = leaders.filter((l) => l.gender === 'female').length;

    return {
      totalEmployees,
      demographicsCoverage: pct(withDemographics, totalEmployees),
      genderParityIndex,
      womenPct: pct(female, genderKnown),
      leadershipWomenPct: pct(leaderFemale, leaders.length),
      totalNationalities: nationalities.length,
    };
  },

  async getGenderRepresentation(orgId: string) {
    const counts = await deiRepository.genderCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    return counts.map((c) => ({ gender: c.gender, count: c._count._all, percentage: pct(c._count._all, total) }));
  },

  async getAgeDistribution(orgId: string) {
    const rows = await deiRepository.birthDates(orgId);
    const now = new Date();
    const buckets: Record<string, number> = Object.fromEntries(AGE_BANDS.map((b) => [b, 0]));
    for (const r of rows) {
      if (r.dateOfBirth) buckets[ageBand(r.dateOfBirth, now)]++;
    }
    const total = rows.length;
    return AGE_BANDS.map((range) => ({ range, count: buckets[range]!, percentage: pct(buckets[range]!, total) }));
  },

  async getNationalityDiversity(orgId: string) {
    const counts = await deiRepository.nationalityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    const distribution = counts
      .map((c) => ({ nationality: c.nationality as string, count: c._count._all, percentage: pct(c._count._all, total) }))
      .sort((a, b) => b.count - a.count);
    return { totalNationalities: distribution.length, distribution };
  },

  async getEthnicityDistribution(orgId: string) {
    const counts = await deiRepository.ethnicityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    return counts
      .map((c) => ({ ethnicity: c.ethnicity, count: c._count._all, percentage: pct(c._count._all, total) }))
      .sort((a, b) => b.count - a.count);
  },

  async getDisabilityDistribution(orgId: string) {
    const counts = await deiRepository.disabilityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    return counts.map((c) => ({ status: c.disabilityStatus, count: c._count._all, percentage: pct(c._count._all, total) }));
  },

  async getPayEquity(orgId: string) {
    const rows = await deiRepository.salaryWithGender(orgId);
    const byGender = new Map<string, number[]>();
    for (const r of rows) {
      const gender = r.user.demographics?.gender;
      if (!gender || gender === 'undisclosed') continue;
      const salary = Number(r.currentSalary);
      if (!salary) continue;
      let arr = byGender.get(gender);
      if (!arr) { arr = []; byGender.set(gender, arr); }
      arr.push(salary);
    }

    const results = [...byGender.entries()].map(([group, salaries]) => ({
      group,
      count: salaries.length,
      averageSalary: Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length),
      medianSalary: median(salaries),
    }));

    // Headline gap: female vs male median (negative = women paid less).
    const f = results.find((r) => r.group === 'female');
    const m = results.find((r) => r.group === 'male');
    const gapPct = f && m && m.medianSalary > 0
      ? Math.round(((f.medianSalary - m.medianSalary) / m.medianSalary) * 1000) / 10
      : null;

    return { results, gapPct };
  },

  async getLeadershipDiversity(orgId: string) {
    const leaders = await deiRepository.leadershipGenders(orgId);
    const total = leaders.length;
    const counts = new Map<string, number>();
    for (const l of leaders) counts.set(l.gender, (counts.get(l.gender) ?? 0) + 1);
    return {
      totalLeaders: total,
      byGender: [...counts.entries()].map(([gender, count]) => ({ gender, count, percentage: pct(count, total) })),
    };
  },
};
