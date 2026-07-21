'use client';

// Per-surface read gate for the six recruitment-analytics reads (kpis / funnel /
// source-breakdown / trend / lost-by-delay / recruiter-sla) — the second read surface
// staged to route to the C# Platform service. DARK by default: unless BOTH env vars are
// set at deploy time, every hook returns the existing tRPC query unchanged (byte-identical
// to today). Merging changes nothing in prod until Federico flips the flag at cutover.
//
// Mirrors lib/platform-api/team-intel.ts exactly: each hook calls BOTH the tRPC hook
// (enabled when NOT viaCSharp) and a C# useQuery (enabled when viaCSharp), then returns the
// active one. The C# useQuery is typed to the EXACT tRPC output type (inferRouterOutputs),
// so the mapper below is compile-time-locked to the live contract's shape.

import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type KpisOutput = RouterOutput['recruitmentAnalytics']['getKpis'];
type FunnelOutput = RouterOutput['recruitmentAnalytics']['getFunnel'];
type SourceBreakdownOutput = RouterOutput['recruitmentAnalytics']['getSourceBreakdown'];
type TrendOutput = RouterOutput['recruitmentAnalytics']['getTrend'];
type LostByDelayOutput = RouterOutput['recruitmentAnalytics']['getLostByDelay'];
type RecruiterSlaOutput = RouterOutput['recruitmentAnalytics']['getRecruiterSla'];

// The period enum — identical to the tRPC `periodInput` z.enum AND the C# AllowedPeriods.
export type ReportingPeriod = '7D' | '30D' | '90D' | '6M' | '1Y';

// Second gate: even when the client is enabled, reporting only routes to C# when its own
// flag is exactly 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const REPORTING_VIA_CSHARP = process.env.NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP === 'true';

// The C# minimal-API OpenAPI contract types every integer/double as `number | string` (a
// number-as-string read artifact) and every nullable numeric as `null | number | string`.
// These coercers restore the exact `number` / `number | null` the tRPC output declares.
const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/**
 * Recruitment-analytics KPI row. Gate:
 * `isPlatformApiEnabled() && NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /reporting/kpis?period=… from the C# service (numeric artifacts coerced).
 *  - false → the existing trpc.recruitmentAnalytics.getKpis.useQuery (the DEFAULT).
 */
export function useReportingKpis(period: ReportingPeriod) {
  const viaCSharp = isPlatformApiEnabled() && REPORTING_VIA_CSHARP;

  const trpcQuery = trpc.recruitmentAnalytics.getKpis.useQuery(
    { period },
    { enabled: !viaCSharp },
  );

  const csharpQuery = useQuery<KpisOutput>({
    queryKey: ['platform-api', 'reporting', 'kpis', period],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/reporting/kpis', { period });
      return {
        period: raw.period,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Current org-wide funnel (3 call sites: analytics-funnel + both dashboards). Gate as above.
 *  - true  → GET /reporting/funnel; false → trpc.recruitmentAnalytics.getFunnel.useQuery.
 */
export function useReportingFunnel() {
  const viaCSharp = isPlatformApiEnabled() && REPORTING_VIA_CSHARP;

  const trpcQuery = trpc.recruitmentAnalytics.getFunnel.useQuery(undefined, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<FunnelOutput>({
    queryKey: ['platform-api', 'reporting', 'funnel'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Applications + hires per source, top 6 (period-relative). Gate as above.
 *  - true  → GET /reporting/source-breakdown?period=…; false → the tRPC query.
 */
export function useReportingSourceBreakdown(period: ReportingPeriod) {
  const viaCSharp = isPlatformApiEnabled() && REPORTING_VIA_CSHARP;

  const trpcQuery = trpc.recruitmentAnalytics.getSourceBreakdown.useQuery(
    { period },
    { enabled: !viaCSharp },
  );

  const csharpQuery = useQuery<SourceBreakdownOutput>({
    queryKey: ['platform-api', 'reporting', 'source-breakdown', period],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/reporting/source-breakdown', { period });
      return raw.map((s) => ({
        source: s.source,
        applications: num(s.applications),
        hires: num(s.hires),
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Applications per month, last 6 UTC calendar months (oldest-first). Gate as above.
 *  - true  → GET /reporting/trend; false → trpc.recruitmentAnalytics.getTrend.useQuery.
 */
export function useReportingTrend() {
  const viaCSharp = isPlatformApiEnabled() && REPORTING_VIA_CSHARP;

  const trpcQuery = trpc.recruitmentAnalytics.getTrend.useQuery(undefined, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<TrendOutput>({
    queryKey: ['platform-api', 'reporting', 'trend'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/reporting/trend');
      return raw.map((b) => ({
        year: num(b.year),
        month: num(b.month),
        count: num(b.count),
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Candidates rejected while overdue on their stage SLA (period-relative). Gate as above.
 *  - true  → GET /reporting/lost-by-delay?period=…; false → the tRPC query.
 */
export function useReportingLostByDelay(period: ReportingPeriod) {
  const viaCSharp = isPlatformApiEnabled() && REPORTING_VIA_CSHARP;

  const trpcQuery = trpc.recruitmentAnalytics.getLostByDelay.useQuery(
    { period },
    { enabled: !viaCSharp },
  );

  const csharpQuery = useQuery<LostByDelayOutput>({
    queryKey: ['platform-api', 'reporting', 'lost-by-delay', period],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Per-recruiter workload + SLA compliance. Gate as above.
 *  - true  → GET /reporting/recruiter-sla; false → the tRPC query.
 */
export function useReportingRecruiterSla() {
  const viaCSharp = isPlatformApiEnabled() && REPORTING_VIA_CSHARP;

  const trpcQuery = trpc.recruitmentAnalytics.getRecruiterSla.useQuery(undefined, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<RecruiterSlaOutput>({
    queryKey: ['platform-api', 'reporting', 'recruiter-sla'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}
