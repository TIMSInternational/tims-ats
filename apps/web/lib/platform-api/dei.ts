'use client';

// DEI FE data layer — C#-ONLY (all 9 hooks below). NEXT_PUBLIC_DEI_READ_VIA_CSHARP was confirmed
// live in prod on 2026-07-31 (parity-verified fresh 50/50 PASS immediately before flipping — see
// docs/REMAINING-WORK.md), and the corresponding TS tRPC procedures (getDashboardKpis /
// getGenderRepresentation / getAgeDistribution / getNationalityDiversity / getPayEquity /
// getLeadershipDiversity / getHiringFunnel / getPromotionEquity / getInclusionIndex) have since
// been DELETED from packages/api/src/routers/dei.ts. These hooks now call the C# service
// unconditionally and no longer read the flag — it is DEAD. Mirrors the C#-only half of
// lib/platform-api/compensation.ts (its 7 C#-only hooks went through the identical transition on
// 2026-07-29).
//
// Every hook's output type is hand-declared below, matching exactly what the deleted tRPC
// procedure used to return (there is no router contract left to infer from via
// inferRouterOutputs). Every call site is unchanged — same hook names, same shapes.
//
// SCOPE — the dei router exposed TEN ported reads (services/Tims.Platform/src/Tims.Api/Dei/
// DeiReadEndpoints.cs; generateReport is a mutation stub and was never ported); only NINE were
// ever consumed by the FE (dei-kpis.tsx, dei-left-column.tsx, dei-right-column.tsx,
// dei-bottom-row.tsx, hr-exec-dashboard.tsx, comp-left-column.tsx) — those nine are wrapped here.
// getEthnicityDistribution and getDisabilityDistribution have NO call site — they get no wrapper
// here and their TS procedures are DELIBERATELY RETAINED (zero-FE-consumer exceptions, out of
// scope for this cutover). Every wrapped call site invokes its hook with NO arguments (no
// dateFrom/dateTo/year/surveyId filter is ever passed), so every hook here is zero-arg, matching
// current usage exactly.
//
// PAY-EQUITY NOTE — `getPayEquity`'s backend endpoint is additionally gated by
// `Platform:FxReadsEnabled` (independent of `Platform:DeiReadEnabled`); if that backend flag is
// ever behind, the pay-equity request 404s (a backend/ops sequencing concern, not something this
// wrapper can prevent). Its TS fallback is gone regardless, same as the other eight.
//
// NUMERIC WIRE ARTIFACTS — the C# minimal-API OpenAPI contract types every int32/double
// (nullable or not) as `number | string`; the k-anonymity suppression fields (count/percentage/
// average/median/gap) are additionally nullable (`null | number | string`) since a sub-floor
// group nulls them out. The coercers below restore the exact `number` / `number | null` shape
// each hand-declared type expects.

import { useQuery } from '@tanstack/react-query';
import { platformGet } from './client';

const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

interface DemographicGroup {
  count: number | null;
  percentage: number | null;
  suppressed: boolean;
}

interface DashboardKpisOutput {
  totalEmployees: number;
  demographicsCoverage: number | null;
  genderParityIndex: number | null;
  womenPct: number | null;
  leadershipWomenPct: number | null;
  totalNationalities: number | null;
}

interface GenderRepresentationOutput {
  groups: Array<DemographicGroup & { gender: string }>;
  suppressed: boolean;
}

interface AgeDistributionOutput {
  groups: Array<DemographicGroup & { range: string }>;
  suppressed: boolean;
}

interface NationalityDiversityOutput {
  totalNationalities: number | null;
  distribution: Array<DemographicGroup & { nationality: string }>;
  suppressed: boolean;
}

interface HiringFunnelOutput {
  total: number;
}

interface PromotionEquityOutput {
  year: number;
  totalPromotions: number | null;
  suppressed: boolean;
}

interface LeadershipDiversityOutput {
  totalLeaders: number | null;
  byGender: Array<DemographicGroup & { gender: string }>;
  suppressed: boolean;
}

interface InclusionIndexOutput {
  index: number | null;
  totalResponses: number | null;
  suppressed: boolean;
  questionsEvaluated?: number;
}

interface PayEquityRow {
  group: string;
  count: number | null;
  averageSalary: number | null;
  medianSalary: number | null;
  suppressed: boolean;
}

interface PayEquityOutput {
  results: PayEquityRow[];
  gapPct: number | null;
  suppressed: boolean;
  currency: string;
}

/**
 * ORG-wide headline KPIs (2 call sites: dei-kpis.tsx, hr-exec-dashboard.tsx). C#-ONLY.
 * GET /dei/dashboard-kpis (all fields coerced; nullable when cross-endpoint differencing guards
 * trip).
 */
export function useDeiDashboardKpis() {
  return useQuery<DashboardKpisOutput>({
    queryKey: ['platform-api', 'dei', 'dashboard-kpis'],
    queryFn: async () => {
      const raw = await platformGet('/dei/dashboard-kpis');
      return {
        totalEmployees: num(raw.totalEmployees),
        demographicsCoverage: numOrNull(raw.demographicsCoverage),
        genderParityIndex: numOrNull(raw.genderParityIndex),
        womenPct: numOrNull(raw.womenPct),
        leadershipWomenPct: numOrNull(raw.leadershipWomenPct),
        totalNationalities: numOrNull(raw.totalNationalities),
      };
    },
  });
}

/**
 * Gender distribution (2 call sites: dei-left-column.tsx GenderByDepartment, dei-kpis.tsx).
 * C#-ONLY. GET /dei/gender-representation (groups + per-group count/percentage coerced; EMPTY
 * groups when suppressed).
 */
export function useDeiGenderRepresentation() {
  return useQuery<GenderRepresentationOutput>({
    queryKey: ['platform-api', 'dei', 'gender-representation'],
    queryFn: async () => {
      const raw = await platformGet('/dei/gender-representation');
      return {
        groups: raw.groups.map((g) => ({
          gender: g.gender,
          count: numOrNull(g.count),
          percentage: numOrNull(g.percentage),
          suppressed: g.suppressed,
        })),
        suppressed: raw.suppressed,
      };
    },
  });
}

/**
 * Age-band distribution (1 call site: dei-right-column.tsx AgeDistribution). C#-ONLY.
 * GET /dei/age-distribution (groups + per-band count/percentage coerced; EMPTY groups when
 * suppressed).
 */
export function useDeiAgeDistribution() {
  return useQuery<AgeDistributionOutput>({
    queryKey: ['platform-api', 'dei', 'age-distribution'],
    queryFn: async () => {
      const raw = await platformGet('/dei/age-distribution');
      return {
        groups: raw.groups.map((g) => ({
          range: g.range,
          count: numOrNull(g.count),
          percentage: numOrNull(g.percentage),
          suppressed: g.suppressed,
        })),
        suppressed: raw.suppressed,
      };
    },
  });
}

/**
 * Nationality distribution, ranked descending by count (1 call site: dei-right-column.tsx
 * NationalityDiversity). C#-ONLY. GET /dei/nationality-diversity (totalNationalities +
 * per-nationality count/percentage coerced; EMPTY distribution when suppressed).
 */
export function useDeiNationalityDiversity() {
  return useQuery<NationalityDiversityOutput>({
    queryKey: ['platform-api', 'dei', 'nationality-diversity'],
    queryFn: async () => {
      const raw = await platformGet('/dei/nationality-diversity');
      return {
        totalNationalities: numOrNull(raw.totalNationalities),
        distribution: raw.distribution.map((n) => ({
          nationality: n.nationality,
          count: numOrNull(n.count),
          percentage: numOrNull(n.percentage),
          suppressed: n.suppressed,
        })),
        suppressed: raw.suppressed,
      };
    },
  });
}

/**
 * Candidate hiring-funnel total (1 call site: dei-right-column.tsx HiringFunnel). Candidates
 * carry no demographics, so this read has NO k-anon suppression. C#-ONLY. GET /dei/hiring-funnel
 * (total coerced; no date-range filter is ever passed by the call site, so this hook is
 * zero-arg).
 */
export function useDeiHiringFunnel() {
  return useQuery<HiringFunnelOutput>({
    queryKey: ['platform-api', 'dei', 'hiring-funnel'],
    queryFn: async () => {
      const raw = await platformGet('/dei/hiring-funnel');
      return { total: num(raw.total) };
    },
  });
}

/**
 * Promotion-equity count for the current year (1 call site: dei-bottom-row.tsx
 * PromotionEquity). C#-ONLY. GET /dei/promotion-equity (year + min-5-floored totalPromotions
 * coerced; no `year` filter is ever passed by the call site, so this hook is zero-arg — the C#
 * route resolves the omitted year to the current year, matching the deleted TS procedure).
 */
export function useDeiPromotionEquity() {
  return useQuery<PromotionEquityOutput>({
    queryKey: ['platform-api', 'dei', 'promotion-equity'],
    queryFn: async () => {
      const raw = await platformGet('/dei/promotion-equity');
      return {
        year: num(raw.year),
        totalPromotions: numOrNull(raw.totalPromotions),
        suppressed: raw.suppressed,
      };
    },
  });
}

/**
 * Leadership-pool gender diversity (1 call site: dei-bottom-row.tsx LeadershipDiversity).
 * C#-ONLY. GET /dei/leadership-diversity (totalLeaders + per-group count/percentage coerced;
 * EMPTY byGender when suppressed).
 */
export function useDeiLeadershipDiversity() {
  return useQuery<LeadershipDiversityOutput>({
    queryKey: ['platform-api', 'dei', 'leadership-diversity'],
    queryFn: async () => {
      const raw = await platformGet('/dei/leadership-diversity');
      return {
        totalLeaders: numOrNull(raw.totalLeaders),
        byGender: raw.byGender.map((g) => ({
          gender: g.gender,
          count: numOrNull(g.count),
          percentage: numOrNull(g.percentage),
          suppressed: g.suppressed,
        })),
        suppressed: raw.suppressed,
      };
    },
  });
}

/**
 * Climate-survey inclusion index (2 call sites: dei-bottom-row.tsx InclusionTrend,
 * dei-kpis.tsx). C#-ONLY. GET /dei/inclusion-index (index/totalResponses coerced-or-null;
 * questionsEvaluated is OMITTED — mapped to `undefined` — whenever the C# route returns it
 * `null`, matching the deleted TS procedure's OPTIONAL field, which was only ever set on the
 * non-suppressed, has-inclusion-question branch; no `surveyId` filter is ever passed by either
 * call site, so this hook is zero-arg).
 */
export function useDeiInclusionIndex() {
  return useQuery<InclusionIndexOutput>({
    queryKey: ['platform-api', 'dei', 'inclusion-index'],
    queryFn: async () => {
      const raw = await platformGet('/dei/inclusion-index');
      return {
        index: numOrNull(raw.index),
        totalResponses: numOrNull(raw.totalResponses),
        suppressed: raw.suppressed,
        questionsEvaluated: raw.questionsEvaluated == null ? undefined : num(raw.questionsEvaluated),
      };
    },
  });
}

/**
 * Pay-equity by gender, in the org's display currency (3 call sites: dei-left-column.tsx
 * PayEquityTable, dei-kpis.tsx, comp-left-column.tsx PayEquityCard — the compensation page
 * reuses the DEI domain's read). C#-ONLY; NOTE its backend endpoint is additionally gated by
 * `Platform:FxReadsEnabled` (see the file header) — a backend/ops sequencing concern only.
 * GET /dei/pay-equity (per-group count/averageSalary/medianSalary + gapPct coerced-or-null;
 * EMPTY results when suppressed).
 */
export function useDeiPayEquity() {
  return useQuery<PayEquityOutput>({
    queryKey: ['platform-api', 'dei', 'pay-equity'],
    queryFn: async () => {
      const raw = await platformGet('/dei/pay-equity');
      return {
        results: raw.results.map((r) => ({
          group: r.group,
          count: numOrNull(r.count),
          averageSalary: numOrNull(r.averageSalary),
          medianSalary: numOrNull(r.medianSalary),
          suppressed: r.suppressed,
        })),
        gapPct: numOrNull(raw.gapPct),
        suppressed: raw.suppressed,
        currency: raw.currency,
      };
    },
  });
}
