import { recruitmentAnalyticsRepository as repo } from '../repositories/recruitment-analytics.repository';

// ---------------------------------------------------------------------------
// Recruitment analytics service — derives dashboard metrics from real
// pipeline/offer data. Metrics with no data source (cost-per-hire, quality of
// hire, ML predictions) are NOT computed here — the UI shows honest
// unavailable states (rule: no stub may impersonate a feature).
// ---------------------------------------------------------------------------

export type AnalyticsPeriod = '7D' | '30D' | '90D' | '6M' | '1Y';

const PERIOD_DAYS: Record<AnalyticsPeriod, number> = {
  '7D': 7,
  '30D': 30,
  '90D': 90,
  '6M': 180,
  '1Y': 365,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function periodStart(period: AnalyticsPeriod, now = new Date()) {
  return new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS);
}

function avgDays(spansMs: number[]) {
  if (spansMs.length === 0) return null;
  const avg = spansMs.reduce((a, b) => a + b, 0) / spansMs.length;
  return Math.round(avg / DAY_MS);
}

/** Hours an application has sat in its current stage (entered = last movement, else appliedAt). */
function hoursInStage(
  app: { appliedAt: Date; movements: Array<{ movedAt: Date }> },
  until: Date,
) {
  const entered = app.movements[0]?.movedAt ?? app.appliedAt;
  return (until.getTime() - entered.getTime()) / (1000 * 60 * 60);
}

export const recruitmentAnalyticsService = {
  /** KPI row — only the honestly computable metrics. */
  async getKpis(orgId: string, period: AnalyticsPeriod = '30D') {
    const from = periodStart(period);
    const [accepted, offersSent, offersAccepted, totalApplications, rejected] =
      await Promise.all([
        repo.acceptedOffers(orgId, from),
        repo.countOffersSent(orgId, from),
        repo.countOffersAccepted(orgId, from),
        repo.countApplications(orgId, from),
        repo.rejectedApplications(orgId, from),
      ]);

    const ttf = avgDays(
      accepted
        .filter((o) => o.respondedAt)
        .map((o) => o.respondedAt!.getTime() - o.vacancy.createdAt.getTime())
        .filter((ms) => ms >= 0),
    );
    const tth = avgDays(
      accepted
        .filter((o) => o.respondedAt && o.application)
        .map((o) => o.respondedAt!.getTime() - o.application!.appliedAt.getTime())
        .filter((ms) => ms >= 0),
    );

    const lostByDelay = rejected.filter((r) => {
      const sla = r.currentStage.slaHours;
      return sla != null && r.rejectedAt != null && hoursInStage(r, r.rejectedAt) > sla;
    }).length;

    return {
      period,
      timeToFillDays: ttf,
      timeToHireDays: tth,
      hires: accepted.length,
      offersSent,
      offersAccepted,
      offerAcceptRatePct:
        offersSent > 0 ? Math.round((offersAccepted / offersSent) * 100) : null,
      totalApplications,
      lostByDelay,
    };
  },

  /** Current org-wide funnel — stages merged by name, ordered by pipeline order. */
  async getFunnel(orgId: string) {
    const [stages, counts, totalApplications, totalHired] = await Promise.all([
      repo.allStages(orgId),
      repo.activeCountsByStage(orgId),
      repo.countApplicationsAllTime(orgId),
      repo.countOffersAcceptedAllTime(orgId),
    ]);

    const countByStageId = new Map(counts.map((c) => [c.currentStageId, c._count._all]));
    const merged = new Map<string, { name: string; order: number; count: number }>();
    for (const s of stages) {
      const entry = merged.get(s.name) ?? { name: s.name, order: s.order, count: 0 };
      entry.count += countByStageId.get(s.id) ?? 0;
      entry.order = Math.min(entry.order, s.order);
      merged.set(s.name, entry);
    }

    const funnel = [...merged.values()].sort((a, b) => a.order - b.order);
    const maxCount = Math.max(1, ...funnel.map((f) => f.count));

    return {
      stages: funnel.map((f) => ({
        name: f.name,
        count: f.count,
        pctOfMax: Math.round((f.count / maxCount) * 100),
      })),
      totalApplications,
      totalHired,
      conversionPct:
        totalApplications > 0
          ? Math.round((totalHired / totalApplications) * 1000) / 10
          : null,
    };
  },

  /** Applications + hires per source, in period. */
  async getSourceBreakdown(orgId: string, period: AnalyticsPeriod = '30D') {
    const from = periodStart(period);
    const [apps, hires] = await Promise.all([
      repo.applicationsBySource(orgId, from),
      repo.hireSources(orgId, from),
    ]);

    const hiresBySource = new Map<string, number>();
    for (const h of hires) {
      hiresBySource.set(h.source, (hiresBySource.get(h.source) ?? 0) + 1);
    }

    return apps
      .map((a) => ({
        source: a.source,
        applications: a._count._all,
        hires: hiresBySource.get(a.source) ?? 0,
      }))
      .sort((a, b) => b.applications - a.applications)
      .slice(0, 6);
  },

  /** Applications per month, last 6 calendar months (oldest first). UTC buckets — DB timestamps are UTC. */
  async getTrend(orgId: string, now = new Date()) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const start = new Date(Date.UTC(y, m - 5, 1));
    const dates = await repo.applicationDates(orgId, start);

    const buckets: Array<{ year: number; month: number; count: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - i, 1));
      buckets.push({ year: d.getUTCFullYear(), month: d.getUTCMonth(), count: 0 });
    }
    for (const { appliedAt } of dates) {
      const b = buckets.find(
        (x) => x.year === appliedAt.getUTCFullYear() && x.month === appliedAt.getUTCMonth(),
      );
      if (b) b.count++;
    }
    return buckets;
  },

  /** Candidates rejected while overdue on their stage SLA, grouped by stage. */
  async getLostByDelay(orgId: string, period: AnalyticsPeriod = '30D') {
    const from = periodStart(period);
    const rejected = await repo.rejectedApplications(orgId, from);

    const byStage = new Map<
      string,
      { stageName: string; slaHours: number; lost: number; hoursOver: number[] }
    >();
    for (const r of rejected) {
      const sla = r.currentStage.slaHours;
      if (sla == null || r.rejectedAt == null) continue;
      const hours = hoursInStage(r, r.rejectedAt);
      if (hours <= sla) continue;
      const entry =
        byStage.get(r.currentStage.name) ??
        { stageName: r.currentStage.name, slaHours: sla, lost: 0, hoursOver: [] };
      entry.lost++;
      entry.hoursOver.push(hours - sla);
      byStage.set(r.currentStage.name, entry);
    }

    const items = [...byStage.values()].map((e) => ({
      stageName: e.stageName,
      slaDays: Math.round(e.slaHours / 24),
      lostCount: e.lost,
      avgDaysOver: Math.round(
        e.hoursOver.reduce((a, b) => a + b, 0) / e.hoursOver.length / 24,
      ),
    }));

    return {
      total: items.reduce((a, b) => a + b.lostCount, 0),
      items: items.sort((a, b) => b.lostCount - a.lostCount),
    };
  },

  /** Per-recruiter workload + SLA compliance over their active pipeline. TTF over a 1-year lookback. */
  async getRecruiterSla(orgId: string, now = new Date()) {
    const ttfLookback = new Date(now.getTime() - 365 * DAY_MS);
    const [vacancies, appCounts, accepted, active] = await Promise.all([
      repo.assignedVacancies(orgId),
      repo.applicationCountsByVacancy(orgId),
      repo.acceptedOffers(orgId, ttfLookback),
      repo.activeApplicationsWithSla(orgId),
    ]);

    const appsByVacancy = new Map(appCounts.map((c) => [c.vacancyId, c._count._all]));

    type Row = {
      name: string;
      vacancyIds: string[];
      candidates: number;
      ttfSpans: number[];
      activeTotal: number;
      activeOnTime: number;
    };
    const byRecruiter = new Map<string, Row>();
    for (const v of vacancies) {
      const key = v.assignedTo!;
      const row =
        byRecruiter.get(key) ??
        {
          name: `${v.assignee?.firstName ?? ''} ${v.assignee?.lastName ?? ''}`.trim(),
          vacancyIds: [],
          candidates: 0,
          ttfSpans: [],
          activeTotal: 0,
          activeOnTime: 0,
        };
      row.vacancyIds.push(v.id);
      row.candidates += appsByVacancy.get(v.id) ?? 0;
      byRecruiter.set(key, row);
    }

    const vacancyToRecruiter = new Map<string, Row>();
    for (const row of byRecruiter.values()) {
      for (const id of row.vacancyIds) vacancyToRecruiter.set(id, row);
    }

    for (const o of accepted) {
      const row = vacancyToRecruiter.get(o.vacancyId);
      if (row && o.respondedAt) {
        const span = o.respondedAt.getTime() - o.vacancy.createdAt.getTime();
        if (span >= 0) row.ttfSpans.push(span);
      }
    }

    for (const app of active) {
      const row = vacancyToRecruiter.get(app.vacancyId);
      if (!row) continue;
      const sla = app.currentStage.slaHours;
      if (sla == null) continue; // stages without an SLA don't count against compliance
      row.activeTotal++;
      if (hoursInStage(app, now) <= sla) row.activeOnTime++;
    }

    return [...byRecruiter.values()]
      .map((r) => ({
        name: r.name,
        vacancies: r.vacancyIds.length,
        candidates: r.candidates,
        avgTtfDays: avgDays(r.ttfSpans),
        slaCompliancePct:
          r.activeTotal > 0 ? Math.round((r.activeOnTime / r.activeTotal) * 100) : null,
      }))
      .sort((a, b) => b.vacancies - a.vacancies);
  },
};
