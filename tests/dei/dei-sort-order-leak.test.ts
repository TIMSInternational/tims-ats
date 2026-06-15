import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Behavioral tests for DEI sub-floor leaks (round 7 supersedes round 6) ─────
// HIGH 4   getNationalityDiversity / getEthnicityDistribution: the round-6 fix kept
//          the group keys (counts nulled) and re-sorted alphabetically when suppressed
//          to hide the descending-by-count ranking channel. Round 7 SUPERSEDES that:
//          when any group is sub-floor the distribution is EMPTY (no keys at all), so
//          there is no order to leak. The not-suppressed path keeps descending-by-count.
// MEDIUM 6 getDashboardKpis: totalNationalities must be null whenever
//          getNationalityDiversity would suppress/empty its distribution (population
//          <5 OR any nationality group sub-floor).

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
    salaryWithGender: vi.fn(),
    leadershipGenders: vi.fn(),
  },
}));

import { deiService } from '../../packages/api/src/services/dei.service';
import { deiRepository } from '../../packages/api/src/repositories/dei.repository';

beforeEach(() => {
  vi.clearAllMocks();
  // round 8 null-bucket counts default to 0 (no missing-value bucket) so these tests
  // exercise only the explicit-group/population suppression paths they were written for.
  vi.mocked(deiRepository.nullNationalityCount).mockResolvedValue(0 as never);
  vi.mocked(deiRepository.nullBirthDateCount).mockResolvedValue(0 as never);
});

describe('getNationalityDiversity present-key cardinality (HIGH 4, round 7)', () => {
  it('N=6 one-small → EMPTY distribution (no keys, no order to leak)', async () => {
    // ZW=5 (large), AR=1 (sub-floor). Round 7: emit NO keys — there is no descending-by-
    // count ranking channel AND no present-key cardinality, so ZW>AR cannot leak at all.
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'ZW', _count: { _all: 5 } },
      { nationality: 'AR', _count: { _all: 1 } },
    ] as never);
    const r = await deiService.getNationalityDiversity('org-1');
    expect(r.distribution).toEqual([]);
    expect(r.suppressed).toBe(true);
    expect(r.totalNationalities).toBeNull();
  });

  it('all groups >= 5 → descending-by-count order preserved, counts visible', async () => {
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'AR', _count: { _all: 6 } },
      { nationality: 'ZW', _count: { _all: 20 } },
    ] as never);
    const r = await deiService.getNationalityDiversity('org-1');
    // not suppressed → ZW (20) sorts before AR (6) by descending count.
    expect(r.distribution.map((d) => d.nationality)).toEqual(['ZW', 'AR']);
    expect(r.distribution.find((d) => d.nationality === 'ZW')!.count).toBe(20);
  });
});

describe('getEthnicityDistribution present-key cardinality (HIGH 4, round 7)', () => {
  it('N=6 one-small → EMPTY distribution (no keys, no order to leak)', async () => {
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([
      { ethnicity: 'white', _count: { _all: 5 } },
      { ethnicity: 'asian', _count: { _all: 1 } },
    ] as never);
    const r = await deiService.getEthnicityDistribution('org-1');
    expect(r.groups).toEqual([]);
    expect(r.suppressed).toBe(true);
  });

  it('all groups >= 5 → descending-by-count order preserved', async () => {
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([
      { ethnicity: 'asian', _count: { _all: 6 } },
      { ethnicity: 'white', _count: { _all: 30 } },
    ] as never);
    const r = await deiService.getEthnicityDistribution('org-1');
    expect(r.suppressed).toBe(false);
    expect(r.groups.map((d) => d.ethnicity)).toEqual(['white', 'asian']);
  });
});

describe('getDashboardKpis totalNationalities cardinality (MEDIUM 6)', () => {
  const stubGenderAll = () => {
    // All gender + leader groups clear the floor so only the nationality guard is exercised.
    vi.mocked(deiRepository.countActiveEmployees).mockResolvedValue(40 as never);
    vi.mocked(deiRepository.countWithDemographics).mockResolvedValue(40 as never);
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([
      { gender: 'female', _count: { _all: 20 } }, { gender: 'male', _count: { _all: 20 } },
    ] as never);
    vi.mocked(deiRepository.leadershipGenders).mockResolvedValue([
      ...Array.from({ length: 5 }, () => ({ gender: 'female' })),
      ...Array.from({ length: 5 }, () => ({ gender: 'male' })),
    ] as never);
    // ethnicity clears the floor so demographicsCoverage / the nationality guard are the
    // only things under test (round 7 added ethnicity to the coverage suppression trigger).
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([
      { ethnicity: 'white', _count: { _all: 20 } }, { ethnicity: 'latino', _count: { _all: 20 } },
    ] as never);
  };

  it('nullifies totalNationalities when a nationality group is sub-floor', async () => {
    stubGenderAll();
    // CO=35, VE=2 (sub-floor) → getNationalityDiversity empties its distribution, so the
    // KPI must NOT publish the distinct-nationality cardinality (would be 2).
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'CO', _count: { _all: 35 } }, { nationality: 'VE', _count: { _all: 2 } },
    ] as never);
    const r = await deiService.getDashboardKpis('org-1');
    expect(r.totalNationalities).toBeNull();
    // gender groups clear the floor → those KPIs stay populated.
    expect(r.genderParityIndex).not.toBeNull();
  });

  it('nullifies totalNationalities when the nationality population itself is 1..4', async () => {
    stubGenderAll();
    // 3 people split across 2 nationalities → distribution empties at tiny N.
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'CO', _count: { _all: 2 } }, { nationality: 'VE', _count: { _all: 1 } },
    ] as never);
    const r = await deiService.getDashboardKpis('org-1');
    expect(r.totalNationalities).toBeNull();
  });

  it('publishes totalNationalities when every nationality group clears the floor', async () => {
    stubGenderAll();
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'CO', _count: { _all: 20 } }, { nationality: 'VE', _count: { _all: 8 } },
    ] as never);
    const r = await deiService.getDashboardKpis('org-1');
    expect(r.totalNationalities).toBe(2);
  });
});
