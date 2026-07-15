import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/dei.repository', () => ({
  deiRepository: {
    countActiveEmployees: vi.fn(),
    countWithDemographics: vi.fn(),
    genderCounts: vi.fn(),
    ethnicityCounts: vi.fn(),
    disabilityCounts: vi.fn(),
    nationalityCounts: vi.fn(),
    nullNationalityCount: vi.fn(),
    birthDates: vi.fn(),
    nullBirthDateCount: vi.fn(),
    displayCurrency: vi.fn(),
    salaryWithGender: vi.fn(),
    leadershipGenders: vi.fn(),
  },
}));

import { deiService } from '../../packages/api/src/services/dei.service';
import { deiRepository } from '../../packages/api/src/repositories/dei.repository';
import { clearFxRateCacheForTest } from '../../packages/api/src/lib/currency';

const gc = (g: string, n: number) => ({ gender: g, _count: { _all: n } });
const yearsAgo = (age: number) => new Date(new Date().getFullYear() - age, 0, 1); // Jan 1 → exact age

beforeEach(() => {
  clearFxRateCacheForTest();
  vi.clearAllMocks();
  // Default the round-8 null-bucket counts to 0 (no missing-value bucket) so existing
  // tests exercise only the explicit-group suppression; specific tests override these.
  vi.mocked(deiRepository.nullNationalityCount).mockResolvedValue(0 as never);
  vi.mocked(deiRepository.nullBirthDateCount).mockResolvedValue(0 as never);
  vi.mocked(deiRepository.displayCurrency).mockResolvedValue({ currency: 'USD' } as never);
  // Default the round-13-14 per-gender demographic counts to empty so getPayEquity tests
  // that don't model the demographic population fall back to each group's salaried count
  // (complement = 0 → no complement-driven suppression). Tests targeting the complement
  // oracle override this with explicit per-gender demographic counts.
  vi.mocked(deiRepository.genderCounts).mockResolvedValue([] as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deiService', () => {
  it('getDashboardKpis computes parity, women%, nationalities, coverage', async () => {
    vi.mocked(deiRepository.countActiveEmployees).mockResolvedValue(20 as never);
    vi.mocked(deiRepository.countWithDemographics).mockResolvedValue(20 as never);
    // All gender groups clear the min-5 floor so the cross-endpoint differencing guard
    // does NOT suppress the derived KPIs (a sub-floor group would null them — covered below).
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 8), gc('male', 12), gc('undisclosed', 5)] as never);
    // Both nationality groups clear the min-5 floor so totalNationalities is NOT
    // suppressed by the round-6 cardinality guard (a sub-floor group nulls it — the
    // distribution endpoint empties at tiny N; covered by getNationalityDiversity tests).
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'CO', _count: { _all: 8 } }, { nationality: 'VE', _count: { _all: 7 } },
    ] as never);
    // Each leader-gender group clears the min-5 floor (5 female + 5 male) so
    // leadershipWomenPct is NOT suppressed by the cross-endpoint differencing guard
    // (a sub-floor leader-gender group nulls it — covered separately below).
    vi.mocked(deiRepository.leadershipGenders).mockResolvedValue([
      { gender: 'female' }, { gender: 'female' }, { gender: 'female' }, { gender: 'female' }, { gender: 'female' },
      { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' },
    ] as never);

    // ethnicity distribution must also clear the floor so demographicsCoverage is not
    // nulled by the round-7 belt-and-suspenders guard (gender OR nationality OR ethnicity).
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([
      { ethnicity: 'white', _count: { _all: 10 } }, { ethnicity: 'latino', _count: { _all: 10 } },
    ] as never);

    const r = await deiService.getDashboardKpis('org-1');
    expect(r.genderParityIndex).toBe(0.67); // 8/12
    expect(r.womenPct).toBe(40); // 8 / (8+12) known
    expect(r.totalNationalities).toBe(2);
    expect(r.demographicsCoverage).toBe(100);
    expect(r.leadershipWomenPct).toBe(50); // 5 of 10
  });

  // ── slice 6 cross-endpoint differencing fix (fix 1, behavioral) ───────────
  // The distribution endpoints suppress a small gender group (e.g. female=3), but
  // getDashboardKpis published womenPct/genderParityIndex derived from the SAME
  // counts: female = round(womenPct% * genderKnown) recovers the hidden group.
  // So when ANY gender group is sub-floor, those KPIs must be null.
  it('getDashboardKpis nulls genderParityIndex + womenPct when a gender group is sub-floor', async () => {
    vi.mocked(deiRepository.countActiveEmployees).mockResolvedValue(23 as never);
    vi.mocked(deiRepository.countWithDemographics).mockResolvedValue(23 as never);
    // female=3 (suppressed in the distribution), male=20 visible.
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 3), gc('male', 20)] as never);
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([{ nationality: 'CO', _count: { _all: 23 } }] as never);
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([{ ethnicity: 'white', _count: { _all: 23 } }] as never);
    // leader pool clears the floor so leadershipWomenPct is governed only by leader-gender groups.
    vi.mocked(deiRepository.leadershipGenders).mockResolvedValue([
      { gender: 'female' }, { gender: 'female' }, { gender: 'female' }, { gender: 'female' }, { gender: 'female' },
      { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' },
    ] as never);

    const r = await deiService.getDashboardKpis('org-1');
    // re-derivation guard: with womenPct null and genderParityIndex null, female=3 is
    // not recoverable from female = round(womenPct% * (female+male)).
    expect(r.genderParityIndex).toBeNull();
    expect(r.womenPct).toBeNull();
    // round 2: demographicsCoverage is also nulled — coverage% × totalEmployees
    // reconstructs the gender-distribution denominator N_g (a per-gender denominator).
    expect(r.demographicsCoverage).toBeNull();
    // bare org headcount + distinct-nationality count reveal no gender split (all
    // per-gender counts are nulled in getGenderRepresentation), so they stay.
    expect(r.totalEmployees).toBe(23);
    expect(r.totalNationalities).toBe(1);
  });

  it('getDashboardKpis nulls leadershipWomenPct when a leader-gender group is sub-floor', async () => {
    vi.mocked(deiRepository.countActiveEmployees).mockResolvedValue(30 as never);
    vi.mocked(deiRepository.countWithDemographics).mockResolvedValue(30 as never);
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 15), gc('male', 15)] as never);
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([{ nationality: 'CO', _count: { _all: 30 } }] as never);
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([{ ethnicity: 'white', _count: { _all: 30 } }] as never);
    // leader pool >=5 overall, but female=2 leaders is sub-floor → leadershipWomenPct null.
    vi.mocked(deiRepository.leadershipGenders).mockResolvedValue([
      { gender: 'female' }, { gender: 'female' },
      { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' },
    ] as never);

    const r = await deiService.getDashboardKpis('org-1');
    expect(r.leadershipWomenPct).toBeNull(); // female=2 not recoverable from the ratio
    // org-wide gender groups both clear the floor → the gender KPIs stay populated.
    expect(r.genderParityIndex).not.toBeNull();
    expect(r.womenPct).not.toBeNull();
  });

  it('getAgeDistribution buckets DOBs into bands (all bands clear the floor)', async () => {
    // 5 per band so no band is suppressed and counts/percentages flow through normally.
    const dobs = [
      ...Array.from({ length: 5 }, () => ({ dateOfBirth: yearsAgo(22) })),
      ...Array.from({ length: 5 }, () => ({ dateOfBirth: yearsAgo(30) })),
      ...Array.from({ length: 5 }, () => ({ dateOfBirth: yearsAgo(40) })),
      ...Array.from({ length: 5 }, () => ({ dateOfBirth: yearsAgo(50) })),
      ...Array.from({ length: 5 }, () => ({ dateOfBirth: yearsAgo(60) })),
    ];
    vi.mocked(deiRepository.birthDates).mockResolvedValue(dobs as never);
    const r = await deiService.getAgeDistribution('org-1');
    expect(r.suppressed).toBe(false);
    const byRange = Object.fromEntries(r.groups.map((b) => [b.range, b.count]));
    expect(byRange).toEqual({ '<25': 5, '25-34': 5, '35-44': 5, '45-54': 5, '55+': 5 });
    expect(r.groups.every((b) => b.percentage === 20)).toBe(true);
  });

  // ── round 7: present-key cardinality — EMPTY distribution when any band sub-floor ──
  it('getAgeDistribution returns EMPTY groups + suppressed:true when one band is sub-floor', async () => {
    // 3 in <25 (sub-floor) + 10 in 25-34. The FIXED band set + a known total N would
    // otherwise difference the suppressed band; emitting NO band keys closes it.
    const dobs = [
      ...Array.from({ length: 3 }, () => ({ dateOfBirth: yearsAgo(22) })),
      ...Array.from({ length: 10 }, () => ({ dateOfBirth: yearsAgo(30) })),
    ];
    vi.mocked(deiRepository.birthDates).mockResolvedValue(dobs as never);
    const r = await deiService.getAgeDistribution('org-1');
    expect(r.groups).toEqual([]);
    expect(r.suppressed).toBe(true);
  });

  // ── round 7: empty distribution at tiny population ────────────────────────
  it('getAgeDistribution returns EMPTY groups + suppressed when the population itself is 1..4', async () => {
    const dobs = [
      { dateOfBirth: yearsAgo(22) },
      { dateOfBirth: yearsAgo(40) },
    ]; // N=2 total
    vi.mocked(deiRepository.birthDates).mockResolvedValue(dobs as never);
    const r = await deiService.getAgeDistribution('org-1');
    expect(r.groups).toEqual([]);
    expect(r.suppressed).toBe(true);
  });

  it('getPayEquity aggregates median salary by gender and computes the gap', async () => {
    const female = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'female' } } });
    const male = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'male' } } });
    vi.mocked(deiRepository.salaryWithGender).mockResolvedValue([
      // 5 female (median 3200) + 5 male (median 4000) so both clear the min-5 floor.
      female(3000), female(3100), female(3200), female(3300), female(3400),
      male(3800), male(3900), male(4000), male(4100), male(4200),
      // Excluded from groups AND from the skipped-SALARIED implicit bucket: salary 0 means
      // no salaried contribution to recover (round 8 FIX 1 only counts SALARIED skips).
      { currentSalary: 0, user: { demographics: { gender: 'undisclosed' } } },
      { currentSalary: 0, user: { demographics: null } },
    ] as never);
    const r = await deiService.getPayEquity('org-1');
    const f = r.results.find((x) => x.group === 'female')!;
    const m = r.results.find((x) => x.group === 'male')!;
    expect(f.count).toBe(5);
    expect(m.medianSalary).toBe(4000);
    expect(r.gapPct).toBe(-20); // median female 3200 vs male 4000 → (3200-4000)/4000
  });

  it('getPayEquity converts salaries into the company display currency before averaging', async () => {
    const female = (s: number) => ({ currentSalary: s, currency: 'COP', user: { demographics: { gender: 'female' } } });
    const male = (s: number) => ({ currentSalary: s, currency: 'USD', user: { demographics: { gender: 'male' } } });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ date: '2026-07-15', base: 'USD', quote: 'COP', rate: 4000 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(deiRepository.displayCurrency).mockResolvedValue({ currency: 'COP' } as never);
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 5), gc('male', 5)] as never);
    vi.mocked(deiRepository.salaryWithGender).mockResolvedValue([
      female(12_000_000), female(12_400_000), female(12_800_000), female(13_200_000), female(13_600_000),
      male(3_400), male(3_600), male(3_800), male(4_000), male(4_200),
    ] as never);

    const r = await deiService.getPayEquity('org-1');
    const f = r.results.find((x) => x.group === 'female')!;
    const m = r.results.find((x) => x.group === 'male')!;

    expect(r.currency).toBe('COP');
    expect(f.medianSalary).toBe(12_800_000);
    expect(m.medianSalary).toBe(15_200_000);
    expect(r.gapPct).toBe(-15.8);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.frankfurter.dev/v2/rate/USD/COP',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('getGenderRepresentation returns percentages when all groups clear the min-5 floor', async () => {
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 12), gc('male', 28)] as never);
    const r = await deiService.getGenderRepresentation('org-1');
    // round 7: distribution is { groups, suppressed }; not suppressed → counts visible.
    expect(r.suppressed).toBe(false);
    expect(r.groups).toEqual([
      { gender: 'female', count: 12, percentage: 30, suppressed: false },
      { gender: 'male', count: 28, percentage: 70, suppressed: false },
    ]);
  });

  // ── round 7: present-key cardinality — EMPTY distribution when any group sub-floor ──
  // The round-5 design nulled per-group counts but still emitted the group KEYS with a
  // uniform flag — N present + the present-key set pins singletons, and a known total
  // recovers a suppressed group (N − Σ visible). Round 7 emits NO keys: an empty groups
  // array + a single top-level suppressed:true marker. Nothing is recoverable.
  it('getGenderRepresentation returns EMPTY groups + suppressed:true when any group is sub-floor', async () => {
    // female=3 (suppressed), male=20, undisclosed=7. female=3 must NOT be recoverable.
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([
      gc('female', 3), gc('male', 20), gc('undisclosed', 7),
    ] as never);
    const r = await deiService.getGenderRepresentation('org-1');
    // no per-group key survives → cardinality (and N − Σ differencing) reveals nothing.
    expect(r.groups).toEqual([]);
    expect(r.suppressed).toBe(true);
  });

  // ── round 7: empty distribution at tiny population ────────────────────────
  it('getGenderRepresentation returns EMPTY groups + suppressed when the population itself is 1..4', async () => {
    // N=2 total (1 female + 1 male) → both keys would pin to 1; emit empty + suppressed.
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 1), gc('male', 1)] as never);
    const r = await deiService.getGenderRepresentation('org-1');
    expect(r.groups).toEqual([]);
    expect(r.suppressed).toBe(true);
  });

  // ATTACK A (round 7): female=3 / male=20 / coverage=100. The distribution emits NO
  // keys (empty + suppressed) so there is no male.count to subtract, AND
  // demographicsCoverage is null in the KPIs so the denominator oracle (coverage ×
  // totalEmployees → N_g, then N_g − male = female) is closed end-to-end.
  it('ATTACK A: female=3/male=20/coverage=100 → empty distribution + demographicsCoverage null (female unrecoverable)', async () => {
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 3), gc('male', 20)] as never);
    const rep = await deiService.getGenderRepresentation('org-1');
    expect(rep.groups).toEqual([]); // no per-group key → N − male is not even expressible
    expect(rep.suppressed).toBe(true);

    vi.mocked(deiRepository.countActiveEmployees).mockResolvedValue(23 as never);
    vi.mocked(deiRepository.countWithDemographics).mockResolvedValue(23 as never);
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 3), gc('male', 20)] as never);
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([{ nationality: 'CO', _count: { _all: 23 } }] as never);
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([{ ethnicity: 'white', _count: { _all: 23 } }] as never);
    vi.mocked(deiRepository.leadershipGenders).mockResolvedValue([
      { gender: 'female' }, { gender: 'female' }, { gender: 'female' }, { gender: 'female' }, { gender: 'female' },
      { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' },
    ] as never);
    const kpis = await deiService.getDashboardKpis('org-1');
    expect(kpis.demographicsCoverage).toBeNull(); // coverage × headcount → N_g closed
  });

  it('getLeadershipDiversity masks totalLeaders AND emits EMPTY byGender when a group is sub-floor (round 7)', async () => {
    // 2 female leaders (sub-floor) + 8 male leaders → empty byGender, no gender keys.
    vi.mocked(deiRepository.leadershipGenders).mockResolvedValue([
      ...Array.from({ length: 2 }, () => ({ gender: 'female' })),
      ...Array.from({ length: 8 }, () => ({ gender: 'male' })),
    ] as never);
    const r = await deiService.getLeadershipDiversity('org-1');
    expect(r.totalLeaders).toBeNull();
    // round 7: no per-gender key survives → totalLeaders − Σ visible is not expressible.
    expect(r.byGender).toEqual([]);
    expect(r.suppressed).toBe(true);
  });

  // ── round 7: empty distribution at tiny leader pool ───────────────────────
  it('getLeadershipDiversity returns EMPTY byGender + null total when the pool itself is 1..4', async () => {
    // 2 leaders total → emit empty byGender (no per-gender keys to pin)
    vi.mocked(deiRepository.leadershipGenders).mockResolvedValue([
      { gender: 'female' }, { gender: 'male' },
    ] as never);
    const r = await deiService.getLeadershipDiversity('org-1');
    expect(r.totalLeaders).toBeNull();
    expect(r.byGender).toEqual([]);
    expect(r.suppressed).toBe(true);
  });

  // payEquity round 7: a sub-floor gender group emits EMPTY results (no group keys).
  it('getPayEquity returns EMPTY results + null gap + suppressed when any group is sub-floor', async () => {
    const female = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'female' } } });
    const male = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'male' } } });
    vi.mocked(deiRepository.salaryWithGender).mockResolvedValue([
      // 3 female (sub-floor) + 8 male (clears floor) → empty results, no group keys.
      female(3000), female(3100), female(3200),
      male(3800), male(3900), male(4000), male(4100), male(4200), male(4300), male(4400), male(4500),
    ] as never);
    const r = await deiService.getPayEquity('org-1');
    expect(r.results).toEqual([]);
    expect(r.suppressed).toBe(true);
    expect(r.gapPct).toBeNull();
  });

  // ── round 7: empty distribution at tiny population ────────────────────────
  it('getPayEquity returns EMPTY results + null gap when the gendered population is 1..4', async () => {
    const female = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'female' } } });
    const male = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'male' } } });
    // 1 female + 1 male = 2 gendered/salaried people → emit []
    vi.mocked(deiRepository.salaryWithGender).mockResolvedValue([female(3000), male(4000)] as never);
    const r = await deiService.getPayEquity('org-1');
    expect(r.results).toEqual([]);
    expect(r.gapPct).toBeNull();
  });

  // ── round 8 FIX 1: getPayEquity implicit skipped-salaried bucket ──────────
  // female=5 + male=5 (both visible) but 3 undisclosed/no-demographics SALARIED people
  // are skipped before the suppression population is built. That skipped bucket's
  // count+salary is recoverable via N − Σ(visible) using getTotalCompBreakdown's org
  // total. Folding it in as an implicit group suppresses the whole result.
  it('getPayEquity suppresses when 1..4 undisclosed/no-demographics salaried people are skipped (FIX 1)', async () => {
    const female = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'female' } } });
    const male = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'male' } } });
    const undisclosed = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'undisclosed' } } });
    const noDemo = (s: number) => ({ currentSalary: s, user: { demographics: null } });
    vi.mocked(deiRepository.salaryWithGender).mockResolvedValue([
      female(3000), female(3100), female(3200), female(3300), female(3400),
      male(3800), male(3900), male(4000), male(4100), male(4200),
      // 3 skipped salaried contributors (sub-floor implicit bucket) → suppress everything.
      undisclosed(5000), undisclosed(5100), noDemo(5200),
    ] as never);
    const r = await deiService.getPayEquity('org-1');
    expect(r.results).toEqual([]);
    expect(r.suppressed).toBe(true);
    expect(r.gapPct).toBeNull();
  });

  // ── round 13-14: getPayEquity per-gender non-positive-salary complement ──────
  // genderRepresentation publishes the FULL demographic gender count (female=8); pay-equity
  // counts only positive-salaried gendered rows (female positive-salary=5). The complement
  // genderRep.female(8) − payEquity.female(5) = 3 zero-salary/no-comp female rows — a
  // recoverable 1..4 bucket. Folding the per-gender complement suppresses the whole result
  // so the subtraction can't yield 3.
  it('getPayEquity suppresses when a per-gender non-positive-salary complement is 1..4 (female demo=8, salaried=5, 3 zero-salary)', async () => {
    const female = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'female' } } });
    const male = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'male' } } });
    // Demographic gender counts: female=8, male=8 (the operand getGenderRepresentation exposes).
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 8), gc('male', 8)] as never);
    vi.mocked(deiRepository.salaryWithGender).mockResolvedValue([
      // 5 female with positive salary (visible group) + 3 female with zero salary (dropped).
      female(3000), female(3100), female(3200), female(3300), female(3400),
      female(0), female(0), female(0),
      // 8 male with positive salary (complement = 8 − 8 = 0, clears).
      male(3800), male(3900), male(4000), male(4100), male(4200), male(4300), male(4400), male(4500),
    ] as never);
    const r = await deiService.getPayEquity('org-1');
    // female complement = 8 − 5 = 3 (1..4) → suppress everything; 3 is not recoverable as
    // genderRep.female − payEquity.female.
    expect(r.results).toEqual([]);
    expect(r.suppressed).toBe(true);
    expect(r.gapPct).toBeNull();
  });

  it('getPayEquity stays visible when every per-gender complement is 0 or >=5 (control for round 13-14)', async () => {
    const female = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'female' } } });
    const male = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'male' } } });
    // female demo=5, salaried=5 → complement 0; male demo=5, salaried=5 → complement 0.
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 5), gc('male', 5)] as never);
    vi.mocked(deiRepository.salaryWithGender).mockResolvedValue([
      female(3000), female(3100), female(3200), female(3300), female(3400),
      male(3800), male(3900), male(4000), male(4100), male(4200),
    ] as never);
    const r = await deiService.getPayEquity('org-1');
    expect(r.suppressed).toBe(false);
    expect(r.results.find((x) => x.group === 'female')!.count).toBe(5);
  });

  it('getPayEquity stays visible when the skipped-salaried bucket is 0 or >=5', async () => {
    const female = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'female' } } });
    const male = (s: number) => ({ currentSalary: s, user: { demographics: { gender: 'male' } } });
    // 5 female + 5 male, zero skipped → results visible (control for FIX 1).
    vi.mocked(deiRepository.salaryWithGender).mockResolvedValue([
      female(3000), female(3100), female(3200), female(3300), female(3400),
      male(3800), male(3900), male(4000), male(4100), male(4200),
    ] as never);
    const r = await deiService.getPayEquity('org-1');
    expect(r.suppressed).toBe(false);
    expect(r.results.find((x) => x.group === 'female')!.count).toBe(5);
  });

  // ── round 8 FIX 2: DEI repository null buckets fold into suppression ───────
  // Visible nationality groups all >=5 but the null-nationality bucket is 1..4. Without
  // the fix the distribution publishes visible counts and (withDemographics − Σ visible)
  // recovers the missing bucket. Folding the null count in empties the distribution.
  it('getNationalityDiversity empties when the null-nationality bucket is 1..4 (FIX 2)', async () => {
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'CO', _count: { _all: 10 } }, { nationality: 'VE', _count: { _all: 8 } },
    ] as never);
    vi.mocked(deiRepository.nullNationalityCount).mockResolvedValue(3 as never); // sub-floor missing bucket
    const r = await deiService.getNationalityDiversity('org-1');
    expect(r.distribution).toEqual([]);
    expect(r.totalNationalities).toBeNull();
    expect(r.suppressed).toBe(true);
  });

  it('getNationalityDiversity stays visible when the null-nationality bucket is 0 or >=5', async () => {
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'CO', _count: { _all: 10 } }, { nationality: 'VE', _count: { _all: 8 } },
    ] as never);
    vi.mocked(deiRepository.nullNationalityCount).mockResolvedValue(0 as never);
    const r = await deiService.getNationalityDiversity('org-1');
    expect(r.suppressed).toBe(false);
    expect(r.totalNationalities).toBe(2);
  });

  it('getAgeDistribution empties when the null-DOB bucket is 1..4 (FIX 2)', async () => {
    // 5 per visible band (all clear the floor) but 3 people with no DOB → suppress.
    const dobs = [
      ...Array.from({ length: 5 }, () => ({ dateOfBirth: yearsAgo(22) })),
      ...Array.from({ length: 5 }, () => ({ dateOfBirth: yearsAgo(30) })),
      ...Array.from({ length: 5 }, () => ({ dateOfBirth: yearsAgo(40) })),
      ...Array.from({ length: 5 }, () => ({ dateOfBirth: yearsAgo(50) })),
      ...Array.from({ length: 5 }, () => ({ dateOfBirth: yearsAgo(60) })),
    ];
    vi.mocked(deiRepository.birthDates).mockResolvedValue(dobs as never);
    vi.mocked(deiRepository.nullBirthDateCount).mockResolvedValue(3 as never); // sub-floor missing bucket
    const r = await deiService.getAgeDistribution('org-1');
    expect(r.groups).toEqual([]);
    expect(r.suppressed).toBe(true);
  });

  // dependent KPI denominator: when a missing bucket trips, demographicsCoverage /
  // totalNationalities must be nulled (coverage × headcount reconstructs withDemographics).
  it('getDashboardKpis nulls demographicsCoverage + totalNationalities when a null bucket trips (FIX 2)', async () => {
    vi.mocked(deiRepository.countActiveEmployees).mockResolvedValue(40 as never);
    vi.mocked(deiRepository.countWithDemographics).mockResolvedValue(40 as never);
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 18), gc('male', 22)] as never);
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'CO', _count: { _all: 20 } }, { nationality: 'VE', _count: { _all: 17 } },
    ] as never);
    vi.mocked(deiRepository.nullNationalityCount).mockResolvedValue(3 as never); // sub-floor → nationalitySuppressed
    vi.mocked(deiRepository.nullBirthDateCount).mockResolvedValue(0 as never);
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([
      { ethnicity: 'white', _count: { _all: 20 } }, { ethnicity: 'latino', _count: { _all: 20 } },
    ] as never);
    vi.mocked(deiRepository.leadershipGenders).mockResolvedValue([
      { gender: 'female' }, { gender: 'female' }, { gender: 'female' }, { gender: 'female' }, { gender: 'female' },
      { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' },
    ] as never);
    const r = await deiService.getDashboardKpis('org-1');
    expect(r.totalNationalities).toBeNull();
    expect(r.demographicsCoverage).toBeNull();
  });

  it('getDashboardKpis nulls demographicsCoverage when only the null-DOB bucket trips (FIX 2)', async () => {
    vi.mocked(deiRepository.countActiveEmployees).mockResolvedValue(40 as never);
    vi.mocked(deiRepository.countWithDemographics).mockResolvedValue(40 as never);
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 18), gc('male', 22)] as never);
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'CO', _count: { _all: 20 } }, { nationality: 'VE', _count: { _all: 20 } },
    ] as never);
    vi.mocked(deiRepository.nullNationalityCount).mockResolvedValue(0 as never);
    vi.mocked(deiRepository.nullBirthDateCount).mockResolvedValue(3 as never); // sub-floor null-DOB bucket
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([
      { ethnicity: 'white', _count: { _all: 20 } }, { ethnicity: 'latino', _count: { _all: 20 } },
    ] as never);
    vi.mocked(deiRepository.leadershipGenders).mockResolvedValue([
      { gender: 'female' }, { gender: 'female' }, { gender: 'female' }, { gender: 'female' }, { gender: 'female' },
      { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' }, { gender: 'male' },
    ] as never);
    const r = await deiService.getDashboardKpis('org-1');
    expect(r.demographicsCoverage).toBeNull();
    // nationality groups + bucket clear the floor → totalNationalities still published.
    expect(r.totalNationalities).toBe(2);
  });
});
