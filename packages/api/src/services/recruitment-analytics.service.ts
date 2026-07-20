import { recruitmentAnalyticsRepository as repo } from '../repositories/recruitment-analytics.repository';
import {
  buildFunnelView,
  buildTrendView,
  buildKpiView,
  buildSourceBreakdown,
  buildLostByDelayView,
  buildRecruiterSlaView,
  DAY_MS,
} from '@tims/shared';

// ---------------------------------------------------------------------------
// Recruitment analytics service — derives dashboard metrics from real
// pipeline/offer data. All response shaping lives in @tims/shared pure kernels
// (build*View) — this service only maps repository rows to their plain,
// epoch-millisecond inputs, so the C# reporting port (Phase-5) golden-parity
// targets the exact exports the router returns (behavior-preserving).
// Metrics with no data source (cost-per-hire, quality of hire, ML predictions)
// are NOT computed — the UI shows honest unavailable states (no stub may
// impersonate a feature).
// ---------------------------------------------------------------------------

export type AnalyticsPeriod = '7D' | '30D' | '90D' | '6M' | '1Y';

const PERIOD_DAYS: Record<AnalyticsPeriod, number> = {
  '7D': 7,
  '30D': 30,
  '90D': 90,
  '6M': 180,
  '1Y': 365,
};

function periodStart(period: AnalyticsPeriod, now = new Date()) {
  return new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS);
}

/** Latest stage movement (movements ordered movedAt desc, take 1) as epoch-ms, or null. */
function lastMovedAtMs(app: { movements: Array<{ movedAt: Date }> }): number | null {
  return app.movements[0]?.movedAt.getTime() ?? null;
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

    return buildKpiView({
      period,
      accepted: accepted.map((o) => ({
        respondedAtMs: o.respondedAt?.getTime() ?? null,
        vacancyCreatedAtMs: o.vacancy.createdAt.getTime(),
        appliedAtMs: o.application?.appliedAt.getTime() ?? null,
      })),
      offersSent,
      offersAccepted,
      totalApplications,
      rejected: rejected.map((r) => ({
        slaHours: r.currentStage.slaHours,
        rejectedAtMs: r.rejectedAt?.getTime() ?? null,
        appliedAtMs: r.appliedAt.getTime(),
        lastMovedAtMs: lastMovedAtMs(r),
      })),
    });
  },

  /** Current org-wide funnel — stages merged by name, ordered by pipeline order. */
  async getFunnel(orgId: string) {
    const [stages, counts, totalApplications, totalHired] = await Promise.all([
      repo.allStages(orgId),
      repo.activeCountsByStage(orgId),
      repo.countApplicationsAllTime(orgId),
      repo.countOffersAcceptedAllTime(orgId),
    ]);

    return buildFunnelView({
      stages: stages.map((s) => ({ id: s.id, name: s.name, order: s.order })),
      counts: counts.map((c) => ({ stageId: c.currentStageId, count: c._count._all })),
      totalApplications,
      totalHired,
    });
  },

  /** Applications + hires per source, in period. */
  async getSourceBreakdown(orgId: string, period: AnalyticsPeriod = '30D') {
    const from = periodStart(period);
    const [apps, hires] = await Promise.all([
      repo.applicationsBySource(orgId, from),
      repo.hireSources(orgId, from),
    ]);

    return buildSourceBreakdown(
      apps.map((a) => ({ source: a.source, applications: a._count._all })),
      hires.map((h) => h.source),
    );
  },

  /** Applications per month, last 6 calendar months (oldest first). UTC buckets — DB timestamps are UTC. */
  async getTrend(orgId: string, now = new Date()) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const start = new Date(Date.UTC(y, m - 5, 1));
    const dates = await repo.applicationDates(orgId, start);

    return buildTrendView(
      now.getTime(),
      dates.map((d) => d.appliedAt.getTime()),
    );
  },

  /** Candidates rejected while overdue on their stage SLA, grouped by stage. */
  async getLostByDelay(orgId: string, period: AnalyticsPeriod = '30D') {
    const from = periodStart(period);
    const rejected = await repo.rejectedApplications(orgId, from);

    return buildLostByDelayView(
      rejected.map((r) => ({
        stageName: r.currentStage.name,
        slaHours: r.currentStage.slaHours,
        rejectedAtMs: r.rejectedAt?.getTime() ?? null,
        appliedAtMs: r.appliedAt.getTime(),
        lastMovedAtMs: lastMovedAtMs(r),
      })),
    );
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

    return buildRecruiterSlaView({
      nowMs: now.getTime(),
      vacancies: vacancies.map((v) => ({
        id: v.id,
        assignedTo: v.assignedTo!,
        firstName: v.assignee?.firstName ?? null,
        lastName: v.assignee?.lastName ?? null,
      })),
      appCounts: appCounts.map((c) => ({ vacancyId: c.vacancyId, count: c._count._all })),
      accepted: accepted.map((o) => ({
        vacancyId: o.vacancyId,
        respondedAtMs: o.respondedAt?.getTime() ?? null,
        vacancyCreatedAtMs: o.vacancy.createdAt.getTime(),
      })),
      active: active.map((app) => ({
        vacancyId: app.vacancyId,
        slaHours: app.currentStage.slaHours,
        appliedAtMs: app.appliedAt.getTime(),
        lastMovedAtMs: lastMovedAtMs(app),
      })),
    });
  },
};
