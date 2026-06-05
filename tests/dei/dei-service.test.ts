import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/dei.repository', () => ({
  deiRepository: {
    countActiveEmployees: vi.fn(),
    countWithDemographics: vi.fn(),
    genderCounts: vi.fn(),
    ethnicityCounts: vi.fn(),
    disabilityCounts: vi.fn(),
    nationalityCounts: vi.fn(),
    birthDates: vi.fn(),
    salaryWithGender: vi.fn(),
    leadershipGenders: vi.fn(),
  },
}));

import { deiService } from '../../packages/api/src/services/dei.service';
import { deiRepository } from '../../packages/api/src/repositories/dei.repository';

const gc = (g: string, n: number) => ({ gender: g, _count: { _all: n } });
const yearsAgo = (age: number) => new Date(new Date().getFullYear() - age, 0, 1); // Jan 1 → exact age

beforeEach(() => vi.clearAllMocks());

describe('deiService', () => {
  it('getDashboardKpis computes parity, women%, nationalities, coverage', async () => {
    vi.mocked(deiRepository.countActiveEmployees).mockResolvedValue(12 as never);
    vi.mocked(deiRepository.countWithDemographics).mockResolvedValue(12 as never);
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 4), gc('male', 6), gc('undisclosed', 2)] as never);
    vi.mocked(deiRepository.nationalityCounts).mockResolvedValue([
      { nationality: 'CO', _count: { _all: 8 } }, { nationality: 'VE', _count: { _all: 2 } },
    ] as never);
    vi.mocked(deiRepository.leadershipGenders).mockResolvedValue([{ gender: 'female' }, { gender: 'male' }] as never);

    const r = await deiService.getDashboardKpis('org-1');
    expect(r.genderParityIndex).toBe(0.67); // 4/6
    expect(r.womenPct).toBe(40); // 4 / (4+6) known
    expect(r.totalNationalities).toBe(2);
    expect(r.demographicsCoverage).toBe(100);
    expect(r.leadershipWomenPct).toBe(50);
  });

  it('getAgeDistribution buckets DOBs into bands', async () => {
    vi.mocked(deiRepository.birthDates).mockResolvedValue([
      { dateOfBirth: yearsAgo(22) }, { dateOfBirth: yearsAgo(30) }, { dateOfBirth: yearsAgo(40) },
      { dateOfBirth: yearsAgo(50) }, { dateOfBirth: yearsAgo(60) }, { dateOfBirth: yearsAgo(31) },
    ] as never);
    const bands = await deiService.getAgeDistribution('org-1');
    const byRange = Object.fromEntries(bands.map((b) => [b.range, b.count]));
    expect(byRange).toEqual({ '<25': 1, '25-34': 2, '35-44': 1, '45-54': 1, '55+': 1 });
  });

  it('getPayEquity aggregates median salary by gender and computes the gap', async () => {
    vi.mocked(deiRepository.salaryWithGender).mockResolvedValue([
      { currentSalary: 3000, user: { demographics: { gender: 'female' } } },
      { currentSalary: 3400, user: { demographics: { gender: 'female' } } },
      { currentSalary: 4000, user: { demographics: { gender: 'male' } } },
      { currentSalary: 4000, user: { demographics: { gender: 'male' } } },
      { currentSalary: 9999, user: { demographics: { gender: 'undisclosed' } } }, // excluded
      { currentSalary: 5000, user: { demographics: null } },                       // excluded
    ] as never);
    const r = await deiService.getPayEquity('org-1');
    const female = r.results.find((x) => x.group === 'female')!;
    const male = r.results.find((x) => x.group === 'male')!;
    expect(female.count).toBe(2);
    expect(male.medianSalary).toBe(4000);
    expect(r.gapPct).toBe(-20); // median female 3200 vs male 4000 → (3200-4000)/4000
  });

  it('getGenderRepresentation returns percentages summing across groups', async () => {
    vi.mocked(deiRepository.genderCounts).mockResolvedValue([gc('female', 1), gc('male', 3)] as never);
    const r = await deiService.getGenderRepresentation('org-1');
    expect(r).toEqual([
      { gender: 'female', count: 1, percentage: 25 },
      { gender: 'male', count: 3, percentage: 75 },
    ]);
  });
});
