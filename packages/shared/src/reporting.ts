// Pure recruitment-analytics shaping kernels — the SINGLE SOURCE the TS router returns
// AND the parity target for the C# port (Phase-5 reporting strangler). No DB, no I/O,
// so it is golden-fixturable from the repo-root vitest AND importable everywhere.

export interface FunnelStageInput {
  id: string;
  name: string;
  order: number;
}
export interface FunnelCountInput {
  stageId: string;
  count: number;
}
export interface FunnelViewInput {
  stages: FunnelStageInput[];
  counts: FunnelCountInput[];
  totalApplications: number;
  totalHired: number;
}
export interface FunnelStageView {
  name: string;
  count: number;
  pctOfMax: number;
}
export interface FunnelView {
  stages: FunnelStageView[];
  totalApplications: number;
  totalHired: number;
  conversionPct: number | null;
}

/**
 * Current org-wide funnel — stages MERGED BY NAME (same-name stages across pipelines
 * summed; order = the min order seen), ordered by pipeline order. `pctOfMax` is each
 * stage's share of the largest stage (floor of max at 1 to avoid /0). `conversionPct`
 * is hired/applications to one decimal, or null when there are no applications.
 *
 * NOTE (C# parity): both roundings use JS `Math.round` (half-UP, toward +Infinity) —
 * the C# port must use `Math.Floor(x + 0.5)`, NOT banker's rounding.
 */
export function buildFunnelView(input: FunnelViewInput): FunnelView {
  const countByStageId = new Map(input.counts.map((c) => [c.stageId, c.count]));
  const merged = new Map<string, { name: string; order: number; count: number }>();
  for (const s of input.stages) {
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
    totalApplications: input.totalApplications,
    totalHired: input.totalHired,
    conversionPct:
      input.totalApplications > 0
        ? Math.round((input.totalHired / input.totalApplications) * 1000) / 10
        : null,
  };
}

export interface TrendBucket {
  year: number;
  /** 0-indexed UTC month (JS getUTCMonth: January = 0). */
  month: number;
  count: number;
}

/**
 * Applications per month for the last 6 UTC calendar months (OLDEST-FIRST). `nowMs` and each
 * `appliedAtMs` are epoch-milliseconds; UTC year/month are derived HERE so the DB's UTC timestamps
 * bucket identically in both stacks. The window is the six months ending in `nowMs`'s UTC month; the
 * start month (`m - 5`) uses JS `Date.UTC` normalization, so it underflows cleanly into the prior year.
 *
 * NOTE (C# parity): `m - i` can be negative — the C# port must reproduce JS `Date.UTC(y, m - i, 1)`
 * month normalization (floored div/mod into the year), NOT `new DateTime(y, month, 1)` which throws.
 */
export function buildTrendView(nowMs: number, appliedAtMs: number[]): TrendBucket[] {
  const now = new Date(nowMs);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const buckets: TrendBucket[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    buckets.push({ year: d.getUTCFullYear(), month: d.getUTCMonth(), count: 0 });
  }
  for (const ms of appliedAtMs) {
    const d = new Date(ms);
    const b = buckets.find(
      (x) => x.year === d.getUTCFullYear() && x.month === d.getUTCMonth(),
    );
    if (b) b.count++;
  }
  return buckets;
}

// --- Shared pure helpers (used by the kpi/lostByDelay/recruiterSla kernels) -----------------

/** One day in milliseconds — the divisor for span→day conversions. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mean of the given millisecond spans, converted to whole days (JS `Math.round`, half-UP), or `null`
 * when there are no spans. C# parity: `Math.Round(x, MidpointRounding.AwayFromZero)` semantics via
 * `Floor(x + 0.5)` — NOT banker's rounding.
 */
export function avgDaysFromSpans(spansMs: number[]): number | null {
  if (spansMs.length === 0) return null;
  const avg = spansMs.reduce((a, b) => a + b, 0) / spansMs.length;
  return Math.round(avg / DAY_MS);
}

/**
 * Hours an application has sat in its current stage: entered = the latest stage movement if any, else
 * `appliedAtMs`. All arguments are epoch-milliseconds; `lastMovedAtMs` is the movement chosen by the
 * repository (movements ordered by movedAt desc, take 1) or `null` when the app never moved.
 */
export function hoursInStage(
  appliedAtMs: number,
  lastMovedAtMs: number | null,
  untilMs: number,
): number {
  const enteredMs = lastMovedAtMs ?? appliedAtMs;
  return (untilMs - enteredMs) / (1000 * 60 * 60);
}

// --- KPI kernel -----------------------------------------------------------------------------

export interface KpiAcceptedOffer {
  respondedAtMs: number | null;
  vacancyCreatedAtMs: number;
  /** appliedAt of the linked application, or `null` when the accepted offer has no application. */
  appliedAtMs: number | null;
}
export interface KpiRejectedApp {
  slaHours: number | null;
  rejectedAtMs: number | null;
  appliedAtMs: number;
  lastMovedAtMs: number | null;
}
export interface KpiViewInput {
  period: string;
  accepted: KpiAcceptedOffer[];
  offersSent: number;
  offersAccepted: number;
  totalApplications: number;
  rejected: KpiRejectedApp[];
}
export interface KpiView {
  period: string;
  timeToFillDays: number | null;
  timeToHireDays: number | null;
  hires: number;
  offersSent: number;
  offersAccepted: number;
  offerAcceptRatePct: number | null;
  totalApplications: number;
  lostByDelay: number;
}

/**
 * The KPI row — only the honestly computable metrics (no cost-per-hire / quality-of-hire / ML: those
 * have no data source and are intentionally absent, never stubbed). Time-to-fill = accepted-offer
 * respondedAt − vacancy.createdAt; time-to-hire = respondedAt − application.appliedAt; both average
 * only non-negative spans over offers with the needed timestamps. `lostByDelay` counts rejections
 * that sat past their stage SLA at rejection time.
 */
export function buildKpiView(input: KpiViewInput): KpiView {
  const ttf = avgDaysFromSpans(
    input.accepted
      .filter((o) => o.respondedAtMs != null)
      .map((o) => o.respondedAtMs! - o.vacancyCreatedAtMs)
      .filter((ms) => ms >= 0),
  );
  const tth = avgDaysFromSpans(
    input.accepted
      .filter((o) => o.respondedAtMs != null && o.appliedAtMs != null)
      .map((o) => o.respondedAtMs! - o.appliedAtMs!)
      .filter((ms) => ms >= 0),
  );

  const lostByDelay = input.rejected.filter((r) => {
    return (
      r.slaHours != null &&
      r.rejectedAtMs != null &&
      hoursInStage(r.appliedAtMs, r.lastMovedAtMs, r.rejectedAtMs) > r.slaHours
    );
  }).length;

  return {
    period: input.period,
    timeToFillDays: ttf,
    timeToHireDays: tth,
    hires: input.accepted.length,
    offersSent: input.offersSent,
    offersAccepted: input.offersAccepted,
    offerAcceptRatePct:
      input.offersSent > 0 ? Math.round((input.offersAccepted / input.offersSent) * 100) : null,
    totalApplications: input.totalApplications,
    lostByDelay,
  };
}

// --- Source-breakdown kernel ----------------------------------------------------------------

export interface SourceApplications {
  source: string;
  applications: number;
}
export interface SourceBreakdownItem {
  source: string;
  applications: number;
  hires: number;
}

/**
 * Applications + hires per source, top 6 by application volume (descending, stable — ties keep the
 * input order). `hireSources` is one entry per application that converted to an accepted offer in the
 * period; it is counted by source here.
 */
export function buildSourceBreakdown(
  apps: SourceApplications[],
  hireSources: string[],
): SourceBreakdownItem[] {
  const hiresBySource = new Map<string, number>();
  for (const s of hireSources) hiresBySource.set(s, (hiresBySource.get(s) ?? 0) + 1);

  return apps
    .map((a) => ({
      source: a.source,
      applications: a.applications,
      hires: hiresBySource.get(a.source) ?? 0,
    }))
    .sort((a, b) => b.applications - a.applications)
    .slice(0, 6);
}

// --- Lost-by-delay kernel -------------------------------------------------------------------

export interface LostByDelayApp {
  stageName: string;
  slaHours: number | null;
  rejectedAtMs: number | null;
  appliedAtMs: number;
  lastMovedAtMs: number | null;
}
export interface LostByDelayItem {
  stageName: string;
  slaDays: number;
  lostCount: number;
  avgDaysOver: number;
}
export interface LostByDelayView {
  total: number;
  items: LostByDelayItem[];
}

/**
 * Candidates rejected while overdue on their stage SLA, grouped by stage NAME (first-seen SLA kept).
 * Only rejections with a stage SLA and a rejectedAt that sat STRICTLY past the SLA count. `slaDays`
 * and `avgDaysOver` round to whole days (half-UP). Items sort by lostCount descending (stable).
 */
export function buildLostByDelayView(rejected: LostByDelayApp[]): LostByDelayView {
  const byStage = new Map<
    string,
    { stageName: string; slaHours: number; lost: number; hoursOver: number[] }
  >();
  for (const r of rejected) {
    if (r.slaHours == null || r.rejectedAtMs == null) continue;
    const hours = hoursInStage(r.appliedAtMs, r.lastMovedAtMs, r.rejectedAtMs);
    if (hours <= r.slaHours) continue;
    const entry =
      byStage.get(r.stageName) ??
      { stageName: r.stageName, slaHours: r.slaHours, lost: 0, hoursOver: [] };
    entry.lost++;
    entry.hoursOver.push(hours - r.slaHours);
    byStage.set(r.stageName, entry);
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
}

// --- Recruiter-SLA kernel -------------------------------------------------------------------

export interface RecruiterVacancy {
  id: string;
  assignedTo: string;
  firstName: string | null;
  lastName: string | null;
}
export interface RecruiterAppCount {
  vacancyId: string;
  count: number;
}
export interface RecruiterAcceptedOffer {
  vacancyId: string;
  respondedAtMs: number | null;
  vacancyCreatedAtMs: number;
}
export interface RecruiterActiveApp {
  vacancyId: string;
  slaHours: number | null;
  appliedAtMs: number;
  lastMovedAtMs: number | null;
}
export interface RecruiterSlaInput {
  nowMs: number;
  vacancies: RecruiterVacancy[];
  appCounts: RecruiterAppCount[];
  accepted: RecruiterAcceptedOffer[];
  active: RecruiterActiveApp[];
}
export interface RecruiterSlaRow {
  name: string;
  vacancies: number;
  candidates: number;
  avgTtfDays: number | null;
  slaCompliancePct: number | null;
}

/**
 * Per-recruiter workload + SLA compliance over their active pipeline. Recruiters are keyed by
 * `assignedTo` (first-seen assignee name kept); candidates = applications across their vacancies;
 * avgTtf = mean non-negative accepted-offer span (respondedAt − vacancy.createdAt) over their
 * vacancies; slaCompliance = share of their active apps still within stage SLA (stages without an SLA
 * are excluded). Rows sort by vacancy count descending (stable).
 */
export function buildRecruiterSlaView(input: RecruiterSlaInput): RecruiterSlaRow[] {
  interface Row {
    name: string;
    vacancyIds: string[];
    candidates: number;
    ttfSpans: number[];
    activeTotal: number;
    activeOnTime: number;
  }
  const appsByVacancy = new Map(input.appCounts.map((c) => [c.vacancyId, c.count]));

  const byRecruiter = new Map<string, Row>();
  for (const v of input.vacancies) {
    const row =
      byRecruiter.get(v.assignedTo) ??
      {
        name: `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim(),
        vacancyIds: [],
        candidates: 0,
        ttfSpans: [],
        activeTotal: 0,
        activeOnTime: 0,
      };
    row.vacancyIds.push(v.id);
    row.candidates += appsByVacancy.get(v.id) ?? 0;
    byRecruiter.set(v.assignedTo, row);
  }

  const vacancyToRecruiter = new Map<string, Row>();
  for (const row of byRecruiter.values()) {
    for (const id of row.vacancyIds) vacancyToRecruiter.set(id, row);
  }

  for (const o of input.accepted) {
    const row = vacancyToRecruiter.get(o.vacancyId);
    if (row && o.respondedAtMs != null) {
      const span = o.respondedAtMs - o.vacancyCreatedAtMs;
      if (span >= 0) row.ttfSpans.push(span);
    }
  }

  for (const app of input.active) {
    const row = vacancyToRecruiter.get(app.vacancyId);
    if (!row) continue;
    if (app.slaHours == null) continue; // stages without an SLA don't count against compliance
    row.activeTotal++;
    if (hoursInStage(app.appliedAtMs, app.lastMovedAtMs, input.nowMs) <= app.slaHours) {
      row.activeOnTime++;
    }
  }

  return [...byRecruiter.values()]
    .map((r) => ({
      name: r.name,
      vacancies: r.vacancyIds.length,
      candidates: r.candidates,
      avgTtfDays: avgDaysFromSpans(r.ttfSpans),
      slaCompliancePct:
        r.activeTotal > 0 ? Math.round((r.activeOnTime / r.activeTotal) * 100) : null,
    }))
    .sort((a, b) => b.vacancies - a.vacancies);
}
