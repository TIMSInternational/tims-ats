'use client';

// C#-only recruitment-analytics reads. The TS tRPC router
// (packages/api/src/routers/recruitment-analytics.ts) has been deleted —
// NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP is true in every environment and there is no TS
// fallback left to route to. Types below are hand-declared (previously derived from
// inferRouterOutputs<AppRouter>) since the router no longer exists to infer from.

import { useQuery } from '@tanstack/react-query';
import { platformGet } from './client';

// The period enum — identical to the deleted tRPC `periodInput` z.enum AND the C# AllowedPeriods.
export type ReportingPeriod = '7D' | '30D' | '90D' | '6M' | '1Y';

// The C# minimal-API OpenAPI contract types every integer/double as `number | string` (a
// number-as-string read artifact) and every nullable numeric as `null | number | string`.
// These coercers restore the exact `number` / `number | null` shape the FE expects.
const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

export interface ReportingKpis {
  period: ReportingPeriod;
  timeToFillDays: number | null;
  timeToHireDays: number | null;
  hires: number;
  offersSent: number;
  offersAccepted: number;
  offerAcceptRatePct: number | null;
  totalApplications: number;
  lostByDelay: number;
}

export interface ReportingFunnelStage {
  name: string;
  count: number;
  pctOfMax: number;
}

export interface ReportingFunnel {
  stages: ReportingFunnelStage[];
  totalApplications: number;
  totalHired: number;
  conversionPct: number | null;
}

export interface ReportingSourceBreakdownRow {
  source: string;
  applications: number;
  hires: number;
}

export interface ReportingTrendBucket {
  year: number;
  month: number;
  count: number;
}

export interface ReportingLostByDelayItem {
  stageName: string;
  slaDays: number;
  lostCount: number;
  avgDaysOver: number;
}

export interface ReportingLostByDelay {
  total: number;
  items: ReportingLostByDelayItem[];
}

export interface ReportingRecruiterSlaRow {
  name: string;
  vacancies: number;
  candidates: number;
  avgTtfDays: number | null;
  slaCompliancePct: number | null;
}

/** Recruitment-analytics KPI row. GET /reporting/kpis?period=… */
export function useReportingKpis(period: ReportingPeriod) {
  return useQuery<ReportingKpis>({
    queryKey: ['platform-api', 'reporting', 'kpis', period],
    queryFn: async () => {
      const raw = await platformGet('/reporting/kpis', { period });
      return {
        period: raw.period as ReportingPeriod,
        timeToFillDays: numOrNull(raw.timeToFillDays),
        timeToHireDays: numOrNull(raw.timeToHireDays),
        hires: num(raw.hires),
        offersSent: num(raw.offersSent),
        offersAccepted: num(raw.offersAccepted),
        offerAcceptRatePct: numOrNull(raw.offerAcceptRatePct),
        totalApplications: num(raw.totalApplications),
        lostByDelay: num(raw.lostByDelay),
      };
    },
  });
}

/** Current org-wide funnel (3 call sites: analytics-funnel + both dashboards). GET /reporting/funnel. */
export function useReportingFunnel() {
  return useQuery<ReportingFunnel>({
    queryKey: ['platform-api', 'reporting', 'funnel'],
    queryFn: async () => {
      const raw = await platformGet('/reporting/funnel');
      return {
        stages: raw.stages.map((s) => ({
          name: s.name,
          count: num(s.count),
          pctOfMax: num(s.pctOfMax),
        })),
        totalApplications: num(raw.totalApplications),
        totalHired: num(raw.totalHired),
        conversionPct: numOrNull(raw.conversionPct),
      };
    },
  });
}

/** Applications + hires per source, top 6 (period-relative). GET /reporting/source-breakdown?period=…. */
export function useReportingSourceBreakdown(period: ReportingPeriod) {
  return useQuery<ReportingSourceBreakdownRow[]>({
    queryKey: ['platform-api', 'reporting', 'source-breakdown', period],
    queryFn: async () => {
      const raw = await platformGet('/reporting/source-breakdown', { period });
      return raw.map((s) => ({
        source: s.source,
        applications: num(s.applications),
        hires: num(s.hires),
      }));
    },
  });
}

/** Applications per month, last 6 UTC calendar months (oldest-first). GET /reporting/trend. */
export function useReportingTrend() {
  return useQuery<ReportingTrendBucket[]>({
    queryKey: ['platform-api', 'reporting', 'trend'],
    queryFn: async () => {
      const raw = await platformGet('/reporting/trend');
      return raw.map((b) => ({
        year: num(b.year),
        month: num(b.month),
        count: num(b.count),
      }));
    },
  });
}

/** Candidates rejected while overdue on their stage SLA (period-relative). GET /reporting/lost-by-delay?period=…. */
export function useReportingLostByDelay(period: ReportingPeriod) {
  return useQuery<ReportingLostByDelay>({
    queryKey: ['platform-api', 'reporting', 'lost-by-delay', period],
    queryFn: async () => {
      const raw = await platformGet('/reporting/lost-by-delay', { period });
      return {
        total: num(raw.total),
        items: raw.items.map((i) => ({
          stageName: i.stageName,
          slaDays: num(i.slaDays),
          lostCount: num(i.lostCount),
          avgDaysOver: num(i.avgDaysOver),
        })),
      };
    },
  });
}

/** Per-recruiter workload + SLA compliance. GET /reporting/recruiter-sla. */
export function useReportingRecruiterSla() {
  return useQuery<ReportingRecruiterSlaRow[]>({
    queryKey: ['platform-api', 'reporting', 'recruiter-sla'],
    queryFn: async () => {
      const raw = await platformGet('/reporting/recruiter-sla');
      return raw.map((r) => ({
        name: r.name,
        vacancies: num(r.vacancies),
        candidates: num(r.candidates),
        avgTtfDays: numOrNull(r.avgTtfDays),
        slaCompliancePct: numOrNull(r.slaCompliancePct),
      }));
    },
  });
}
