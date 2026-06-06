import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/recruitment-analytics.repository', () => ({
  recruitmentAnalyticsRepository: {
    acceptedOffers: vi.fn(),
    countOffersSent: vi.fn(),
    countOffersAccepted: vi.fn(),
    countApplications: vi.fn(),
    countApplicationsAllTime: vi.fn(),
    countOffersAcceptedAllTime: vi.fn(),
    applicationDates: vi.fn(),
    allStages: vi.fn(),
    activeCountsByStage: vi.fn(),
    applicationsBySource: vi.fn(),
    hireSources: vi.fn(),
    rejectedApplications: vi.fn(),
    assignedVacancies: vi.fn(),
    applicationCountsByVacancy: vi.fn(),
    activeApplicationsWithSla: vi.fn(),
  },
}));

import { recruitmentAnalyticsService } from '../../packages/api/src/services/recruitment-analytics.service';
import { recruitmentAnalyticsRepository as repo } from '../../packages/api/src/repositories/recruitment-analytics.repository';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

beforeEach(() => vi.clearAllMocks());

describe('recruitmentAnalyticsService', () => {
  it('getKpis computes TTF/TTH averages, accept rate, and lost-by-delay', async () => {
    vi.mocked(repo.acceptedOffers).mockResolvedValue([
      // vacancy opened 30d ago, applied 20d ago, accepted 10d ago → TTF 20, TTH 10
      {
        respondedAt: daysAgo(10),
        vacancyId: 'v1',
        vacancy: { createdAt: daysAgo(30) },
        application: { appliedAt: daysAgo(20), source: 'linkedin' },
      },
      // TTF 10, TTH 6
      {
        respondedAt: daysAgo(0),
        vacancyId: 'v2',
        vacancy: { createdAt: daysAgo(10) },
        application: { appliedAt: daysAgo(6), source: 'portal' },
      },
    ] as never);
    vi.mocked(repo.countOffersSent).mockResolvedValue(4 as never);
    vi.mocked(repo.countOffersAccepted).mockResolvedValue(2 as never);
    vi.mocked(repo.countApplications).mockResolvedValue(40 as never);
    vi.mocked(repo.rejectedApplications).mockResolvedValue([
      // SLA 24h, sat 48h in stage before rejection → lost by delay
      {
        appliedAt: daysAgo(5),
        rejectedAt: daysAgo(3),
        currentStage: { name: 'Entrevista', slaHours: 24 },
        movements: [{ movedAt: daysAgo(5) }],
      },
      // SLA 240h, rejected within SLA → not lost by delay
      {
        appliedAt: daysAgo(5),
        rejectedAt: daysAgo(4),
        currentStage: { name: 'Aplicado', slaHours: 240 },
        movements: [],
      },
      // no SLA on stage → never counts
      {
        appliedAt: daysAgo(9),
        rejectedAt: daysAgo(1),
        currentStage: { name: 'Oferta', slaHours: null },
        movements: [],
      },
    ] as never);

    const r = await recruitmentAnalyticsService.getKpis('org-1', '30D');
    expect(r.timeToFillDays).toBe(15); // (20+10)/2
    expect(r.timeToHireDays).toBe(8); // (10+6)/2
    expect(r.offerAcceptRatePct).toBe(50);
    expect(r.hires).toBe(2);
    expect(r.totalApplications).toBe(40);
    expect(r.lostByDelay).toBe(1);
  });

  it('getKpis returns nulls (not fake zeros/averages) when there is no data', async () => {
    vi.mocked(repo.acceptedOffers).mockResolvedValue([] as never);
    vi.mocked(repo.countOffersSent).mockResolvedValue(0 as never);
    vi.mocked(repo.countOffersAccepted).mockResolvedValue(0 as never);
    vi.mocked(repo.countApplications).mockResolvedValue(0 as never);
    vi.mocked(repo.rejectedApplications).mockResolvedValue([] as never);

    const r = await recruitmentAnalyticsService.getKpis('org-1');
    expect(r.timeToFillDays).toBeNull();
    expect(r.timeToHireDays).toBeNull();
    expect(r.offerAcceptRatePct).toBeNull();
  });

  it('getFunnel merges same-named stages across vacancies and orders them', async () => {
    vi.mocked(repo.allStages).mockResolvedValue([
      { id: 's1', name: 'Aplicado', order: 1, slaHours: null },
      { id: 's2', name: 'Entrevista', order: 2, slaHours: 48 },
      { id: 's3', name: 'Aplicado', order: 1, slaHours: null }, // second vacancy, same name
    ] as never);
    vi.mocked(repo.activeCountsByStage).mockResolvedValue([
      { currentStageId: 's1', _count: { _all: 7 } },
      { currentStageId: 's2', _count: { _all: 2 } },
      { currentStageId: 's3', _count: { _all: 3 } },
    ] as never);
    vi.mocked(repo.countApplicationsAllTime).mockResolvedValue(50 as never);
    vi.mocked(repo.countOffersAcceptedAllTime).mockResolvedValue(4 as never);

    const r = await recruitmentAnalyticsService.getFunnel('org-1');
    expect(r.stages).toEqual([
      { name: 'Aplicado', count: 10, pctOfMax: 100 },
      { name: 'Entrevista', count: 2, pctOfMax: 20 },
    ]);
    expect(r.conversionPct).toBe(8); // 4/50 = 8.0%
  });

  it('getSourceBreakdown pairs application counts with hires per source', async () => {
    vi.mocked(repo.applicationsBySource).mockResolvedValue([
      { source: 'linkedin', _count: { _all: 20 } },
      { source: 'portal', _count: { _all: 30 } },
    ] as never);
    vi.mocked(repo.hireSources).mockResolvedValue([
      { source: 'linkedin' },
      { source: 'linkedin' },
      { source: 'portal' },
    ] as never);

    const r = await recruitmentAnalyticsService.getSourceBreakdown('org-1');
    expect(r).toEqual([
      { source: 'portal', applications: 30, hires: 1 },
      { source: 'linkedin', applications: 20, hires: 2 },
    ]);
  });

  it('getTrend buckets applications into the last 6 calendar months', async () => {
    const now = new Date(2026, 5, 15); // Jun 15 2026
    vi.mocked(repo.applicationDates).mockResolvedValue([
      { appliedAt: new Date(2026, 5, 2) },
      { appliedAt: new Date(2026, 5, 9) },
      { appliedAt: new Date(2026, 3, 1) },
      { appliedAt: new Date(2026, 0, 30) },
    ] as never);

    const r = await recruitmentAnalyticsService.getTrend('org-1', now);
    expect(r).toHaveLength(6);
    expect(r[0]).toEqual({ year: 2026, month: 0, count: 1 }); // Jan
    expect(r[3]).toEqual({ year: 2026, month: 3, count: 1 }); // Apr
    expect(r[5]).toEqual({ year: 2026, month: 5, count: 2 }); // Jun
  });

  it('getRecruiterSla aggregates per recruiter and excludes no-SLA stages from compliance', async () => {
    const now = new Date();
    vi.mocked(repo.assignedVacancies).mockResolvedValue([
      { id: 'v1', createdAt: daysAgo(40), assignedTo: 'u1', assignee: { firstName: 'Ana', lastName: 'Perez' } },
      { id: 'v2', createdAt: daysAgo(20), assignedTo: 'u1', assignee: { firstName: 'Ana', lastName: 'Perez' } },
      { id: 'v3', createdAt: daysAgo(10), assignedTo: 'u2', assignee: { firstName: 'Luis', lastName: 'Diaz' } },
    ] as never);
    vi.mocked(repo.applicationCountsByVacancy).mockResolvedValue([
      { vacancyId: 'v1', _count: { _all: 5 } },
      { vacancyId: 'v2', _count: { _all: 3 } },
      { vacancyId: 'v3', _count: { _all: 2 } },
    ] as never);
    vi.mocked(repo.acceptedOffers).mockResolvedValue([
      // Ana: vacancy v1 created 40d ago, offer accepted 10d ago → TTF 30
      { respondedAt: daysAgo(10), vacancyId: 'v1', vacancy: { createdAt: daysAgo(40) }, application: null },
    ] as never);
    vi.mocked(repo.activeApplicationsWithSla).mockResolvedValue([
      // Ana, on time (SLA 100h, in stage ~24h)
      { vacancyId: 'v1', appliedAt: daysAgo(1), currentStage: { slaHours: 100 }, movements: [] },
      // Ana, overdue (SLA 24h, in stage ~72h)
      { vacancyId: 'v2', appliedAt: daysAgo(3), currentStage: { slaHours: 24 }, movements: [] },
      // Ana, stage without SLA → excluded
      { vacancyId: 'v1', appliedAt: daysAgo(9), currentStage: { slaHours: null }, movements: [] },
      // Luis, on time
      { vacancyId: 'v3', appliedAt: daysAgo(0), currentStage: { slaHours: 48 }, movements: [] },
    ] as never);

    const r = await recruitmentAnalyticsService.getRecruiterSla('org-1', now);
    expect(r).toHaveLength(2);
    const ana = r.find((x) => x.name === 'Ana Perez')!;
    expect(ana.vacancies).toBe(2);
    expect(ana.candidates).toBe(8);
    expect(ana.avgTtfDays).toBe(30);
    expect(ana.slaCompliancePct).toBe(50); // 1 of 2 SLA-tracked on time
    const luis = r.find((x) => x.name === 'Luis Diaz')!;
    expect(luis.slaCompliancePct).toBe(100);
  });

  it('getLostByDelay groups overdue rejections by stage with avg days over SLA', async () => {
    vi.mocked(repo.rejectedApplications).mockResolvedValue([
      // Entrevista, SLA 24h (1d), in stage 72h → 48h (2d) over
      { appliedAt: daysAgo(5), rejectedAt: daysAgo(2), currentStage: { name: 'Entrevista', slaHours: 24 }, movements: [{ movedAt: daysAgo(5) }] },
      // Entrevista, SLA 24h, in stage 120h → 96h (4d) over
      { appliedAt: daysAgo(6), rejectedAt: daysAgo(1), currentStage: { name: 'Entrevista', slaHours: 24 }, movements: [] },
      // within SLA → excluded
      { appliedAt: daysAgo(2), rejectedAt: daysAgo(1), currentStage: { name: 'Aplicado', slaHours: 240 }, movements: [] },
    ] as never);

    const r = await recruitmentAnalyticsService.getLostByDelay('org-1');
    expect(r.total).toBe(2);
    expect(r.items).toEqual([
      { stageName: 'Entrevista', slaDays: 1, lostCount: 2, avgDaysOver: 3 },
    ]);
  });
});
