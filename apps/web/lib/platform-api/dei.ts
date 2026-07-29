'use client';

// Per-surface read gate for the NINE FE-consumed DEI reads (getDashboardKpis /
// getGenderRepresentation / getAgeDistribution / getNationalityDiversity / getHiringFunnel /
// getPromotionEquity / getLeadershipDiversity / getInclusionIndex / getPayEquity) — the DEI
// domain's read surface staged to route to the C# Platform service. DARK by default: unless
// BOTH the platform-api base URL and NEXT_PUBLIC_DEI_READ_VIA_CSHARP are set at deploy time,
// every hook returns the existing tRPC query unchanged (byte-identical to today). Merging
// changes nothing in prod until Federico flips the flag at cutover.
//
// Mirrors lib/platform-api/{access-review,audit-log,billing,compensation,
// engagement}.ts exactly: each hook calls BOTH the tRPC hook (enabled when NOT viaCSharp) and a
// C# useQuery (enabled when viaCSharp), then returns the active one. The C# useQuery is typed
// to the EXACT tRPC output type (inferRouterOutputs), so each mapper below is compile-time-
// locked to the live contract's shape.
//
// SCOPE — the dei router exposes TEN ported reads (services/Tims.Platform/src/Tims.Api/Dei/
// DeiReadEndpoints.cs; generateReport is a mutation stub and was never ported); only NINE are
// consumed by the FE (dei-kpis.tsx, dei-left-column.tsx, dei-right-column.tsx,
// dei-bottom-row.tsx, hr-exec-dashboard.tsx, comp-left-column.tsx). getEthnicityDistribution
// and getDisabilityDistribution have NO call site — they get no wrapper here (they stay on
// tRPC; there is no call site to route). Every wrapped call site invokes its hook with NO
// arguments (no dateFrom/dateTo/year/surveyId filter is ever passed today), so every hook here
// is zero-arg, matching current usage exactly.
//
// TWO BACKEND FLAGS, ONE FE FLAG — eight of the nine reads are gated server-side by
// `Platform:DeiReadEnabled`; getPayEquity alone is gated by `Platform:FxReadsEnabled` (it
// depends on the FX-rate pipeline, canaried independently — see DeiReadEndpoints.cs's
// MapDeiPayEquityEndpoint). Both share this ONE FE flag: Federico is expected to flip both
// backend flags together at DEI cutover, so a single `NEXT_PUBLIC_DEI_READ_VIA_CSHARP` routes
// all nine reads. If the backend flags are ever out of lockstep, the pay-equity request 404s
// (that is a backend/ops sequencing concern, not something this wrapper can prevent).
//
// NO MISSING-RECORD / FORBIDDEN PARITY CASES — every wrapped read is an org-wide aggregate
// (permissionProcedure('dei','read'), GRANT-only, no org-scope gate); there is no findFirst/
// findFirstOrThrow point-read and no org-governance narrow-scope 403-as-empty-state case (unlike
// nine-box's listCalibrations). A 403 propagates as a react-query error on BOTH paths and every
// call site already renders that generically (isError → an error message), so no
// isDeiForbiddenError helper is needed.
//
// NUMERIC WIRE ARTIFACTS — the C# minimal-API OpenAPI contract types every int32/double
// (nullable or not) as `number | string`; the k-anonymity suppression fields (count/percentage/
// average/median/gap) are additionally nullable (`null | number | string`) since a sub-floor
// group nulls them out. The coercers below restore the exact `number` / `number | null` the
// tRPC output declares.

import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type DashboardKpisOutput = RouterOutput['dei']['getDashboardKpis'];
type GenderRepresentationOutput = RouterOutput['dei']['getGenderRepresentation'];
type AgeDistributionOutput = RouterOutput['dei']['getAgeDistribution'];
type NationalityDiversityOutput = RouterOutput['dei']['getNationalityDiversity'];
type HiringFunnelOutput = RouterOutput['dei']['getHiringFunnel'];
type PromotionEquityOutput = RouterOutput['dei']['getPromotionEquity'];
type LeadershipDiversityOutput = RouterOutput['dei']['getLeadershipDiversity'];
type InclusionIndexOutput = RouterOutput['dei']['getInclusionIndex'];
type PayEquityOutput = RouterOutput['dei']['getPayEquity'];

// Second gate: even when the client is enabled, DEI only routes to C# when its own flag is
// exactly 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const DEI_VIA_CSHARP = process.env.NEXT_PUBLIC_DEI_READ_VIA_CSHARP === 'true';

const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

/**
 * ORG-wide headline KPIs (2 call sites: dei-kpis.tsx, hr-exec-dashboard.tsx). Gate:
 * `isPlatformApiEnabled() && NEXT_PUBLIC_DEI_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /dei/dashboard-kpis (all fields coerced; nullable when cross-endpoint
 *            differencing guards trip).
 *  - false → trpc.dei.getDashboardKpis.useQuery() (the DEFAULT).
 */
export function useDeiDashboardKpis() {
  const viaCSharp = isPlatformApiEnabled() && DEI_VIA_CSHARP;

  const trpcQuery = trpc.dei.getDashboardKpis.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<DashboardKpisOutput>({
    queryKey: ['platform-api', 'dei', 'dashboard-kpis'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Gender distribution (2 call sites: dei-left-column.tsx GenderByDepartment, dei-kpis.tsx).
 * Gate as above.
 *  - true  → GET /dei/gender-representation (groups + per-group count/percentage coerced;
 *            EMPTY groups when suppressed).
 *  - false → trpc.dei.getGenderRepresentation.useQuery() (the DEFAULT).
 */
export function useDeiGenderRepresentation() {
  const viaCSharp = isPlatformApiEnabled() && DEI_VIA_CSHARP;

  const trpcQuery = trpc.dei.getGenderRepresentation.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<GenderRepresentationOutput>({
    queryKey: ['platform-api', 'dei', 'gender-representation'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Age-band distribution (1 call site: dei-right-column.tsx AgeDistribution). Gate as above.
 *  - true  → GET /dei/age-distribution (groups + per-band count/percentage coerced; EMPTY
 *            groups when suppressed).
 *  - false → trpc.dei.getAgeDistribution.useQuery() (the DEFAULT).
 */
export function useDeiAgeDistribution() {
  const viaCSharp = isPlatformApiEnabled() && DEI_VIA_CSHARP;

  const trpcQuery = trpc.dei.getAgeDistribution.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<AgeDistributionOutput>({
    queryKey: ['platform-api', 'dei', 'age-distribution'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Nationality distribution, ranked descending by count (1 call site: dei-right-column.tsx
 * NationalityDiversity). Gate as above.
 *  - true  → GET /dei/nationality-diversity (totalNationalities + per-nationality count/
 *            percentage coerced; EMPTY distribution when suppressed).
 *  - false → trpc.dei.getNationalityDiversity.useQuery() (the DEFAULT).
 */
export function useDeiNationalityDiversity() {
  const viaCSharp = isPlatformApiEnabled() && DEI_VIA_CSHARP;

  const trpcQuery = trpc.dei.getNationalityDiversity.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<NationalityDiversityOutput>({
    queryKey: ['platform-api', 'dei', 'nationality-diversity'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Candidate hiring-funnel total (1 call site: dei-right-column.tsx HiringFunnel). Candidates
 * carry no demographics, so this read has NO k-anon suppression. Gate as above.
 *  - true  → GET /dei/hiring-funnel (total coerced; no date-range filter is ever passed by the
 *            call site, so this hook is zero-arg).
 *  - false → trpc.dei.getHiringFunnel.useQuery() (the DEFAULT).
 */
export function useDeiHiringFunnel() {
  const viaCSharp = isPlatformApiEnabled() && DEI_VIA_CSHARP;

  const trpcQuery = trpc.dei.getHiringFunnel.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<HiringFunnelOutput>({
    queryKey: ['platform-api', 'dei', 'hiring-funnel'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/dei/hiring-funnel');
      return { total: num(raw.total) };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Promotion-equity count for the current year (1 call site: dei-bottom-row.tsx
 * PromotionEquity). Gate as above.
 *  - true  → GET /dei/promotion-equity (year + min-5-floored totalPromotions coerced; no
 *            `year` filter is ever passed by the call site, so this hook is zero-arg — the
 *            C# route resolves the omitted year to the current year, matching tRPC).
 *  - false → trpc.dei.getPromotionEquity.useQuery() (the DEFAULT).
 */
export function useDeiPromotionEquity() {
  const viaCSharp = isPlatformApiEnabled() && DEI_VIA_CSHARP;

  const trpcQuery = trpc.dei.getPromotionEquity.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<PromotionEquityOutput>({
    queryKey: ['platform-api', 'dei', 'promotion-equity'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/dei/promotion-equity');
      return {
        year: num(raw.year),
        totalPromotions: numOrNull(raw.totalPromotions),
        suppressed: raw.suppressed,
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Leadership-pool gender diversity (1 call site: dei-bottom-row.tsx LeadershipDiversity). Gate
 * as above.
 *  - true  → GET /dei/leadership-diversity (totalLeaders + per-group count/percentage coerced;
 *            EMPTY byGender when suppressed).
 *  - false → trpc.dei.getLeadershipDiversity.useQuery() (the DEFAULT).
 */
export function useDeiLeadershipDiversity() {
  const viaCSharp = isPlatformApiEnabled() && DEI_VIA_CSHARP;

  const trpcQuery = trpc.dei.getLeadershipDiversity.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<LeadershipDiversityOutput>({
    queryKey: ['platform-api', 'dei', 'leadership-diversity'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Climate-survey inclusion index (2 call sites: dei-bottom-row.tsx InclusionTrend,
 * dei-kpis.tsx). Gate as above.
 *  - true  → GET /dei/inclusion-index (index/totalResponses coerced-or-null; questionsEvaluated
 *            is OMITTED — mapped to `undefined` — whenever the C# route returns it `null`,
 *            matching the tRPC output's OPTIONAL field, which is only ever set on the
 *            non-suppressed, has-inclusion-question branch; no `surveyId` filter is ever passed
 *            by either call site, so this hook is zero-arg).
 *  - false → trpc.dei.getInclusionIndex.useQuery() (the DEFAULT).
 */
export function useDeiInclusionIndex() {
  const viaCSharp = isPlatformApiEnabled() && DEI_VIA_CSHARP;

  const trpcQuery = trpc.dei.getInclusionIndex.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<InclusionIndexOutput>({
    queryKey: ['platform-api', 'dei', 'inclusion-index'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Pay-equity by gender, in the org's display currency (3 call sites: dei-left-column.tsx
 * PayEquityTable, dei-kpis.tsx, comp-left-column.tsx PayEquityCard — the compensation page
 * reuses the DEI domain's read). Gate as above; NOTE its backend endpoint is additionally
 * gated by `Platform:FxReadsEnabled` (see the file header) — this hook still shares the ONE
 * `NEXT_PUBLIC_DEI_READ_VIA_CSHARP` flag.
 *  - true  → GET /dei/pay-equity (per-group count/averageSalary/medianSalary + gapPct coerced-
 *            or-null; EMPTY results when suppressed).
 *  - false → trpc.dei.getPayEquity.useQuery() (the DEFAULT).
 */
export function useDeiPayEquity() {
  const viaCSharp = isPlatformApiEnabled() && DEI_VIA_CSHARP;

  const trpcQuery = trpc.dei.getPayEquity.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<PayEquityOutput>({
    queryKey: ['platform-api', 'dei', 'pay-equity'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}
