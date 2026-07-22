'use client';

// Per-surface read gate for the FIVE FE-consumed FX-FREE compensation reads
// (getSalaryBands / getBenefitsUtilization / getCompaRatioDistribution /
// listPendingAdjustments / myCompensation) — the sixth FE cutover surface staged to route to
// the C# Platform service. DARK by default: unless BOTH the platform-api base URL and
// NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP are set at deploy time, every hook returns the
// existing tRPC query unchanged (byte-identical to today). Merging changes nothing in prod
// until Federico flips the flag at cutover.
//
// Mirrors lib/platform-api/{reporting,billing,evaluation360,succession}.ts exactly: each hook
// calls BOTH the tRPC hook (enabled when NOT viaCSharp) and a C# useQuery (enabled when
// viaCSharp), then returns the active one. The C# useQuery is typed to the EXACT tRPC output
// type (inferRouterOutputs), so each mapper below is compile-time-locked to the live contract's
// shape — including the superjson Date semantics on the SalaryBand/adjustment date fields and
// the number-as-string wire artifacts.
//
// SCOPE — FX-FREE subset only. Slice-9 ported exactly the reads that need no currency
// conversion. The FX-dependent reads (getBandDistribution / getTotalCompBreakdown /
// getPayEquity / getDashboardKpis) AND the two not consumed by the FE (getMarketComparison /
// getEmployeeComp) get NO wrapper here — they stay on tRPC until Slice-9b lands the FX kernels.
//
// FIELD-AUTH NUANCE (myCompensation + listPendingAdjustments): the C# OpenAPI types these 200
// bodies as free-form `object` (JsonObject / oneOf[null,object]) — the field-authed shape is
// dynamic (restricted keys ABSENT for lower tiers, not null), so platformGet returns a loosely
// typed object. Each wrapper reads the raw object through a lens, maps it to the EXACT
// inferRouterOutputs shape PRESERVING key absence (no null injected for an absent restricted
// key), then casts `as <Output>` — the field-auth guarantees are enforced server-side + covered
// by the backend integration tests; the FE wrapper only needs shape-compatibility. No `any`.
//
// All five live behind the C# `Platform:CompensationReadEnabled` backend flag (see the FX-free
// GETs mapped in the compensation read endpoints), so they share ONE FE flag mirroring it.

import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type SalaryBandsOutput = RouterOutput['compensation']['getSalaryBands'];
type BenefitsUtilizationOutput = RouterOutput['compensation']['getBenefitsUtilization'];
type CompaRatioDistributionOutput = RouterOutput['compensation']['getCompaRatioDistribution'];
type PendingAdjustmentsOutput = RouterOutput['compensation']['listPendingAdjustments'];
type MyCompensationOutput = RouterOutput['compensation']['myCompensation'];

// Second gate: even when the client is enabled, compensation only routes to C# when its own flag
// is exactly 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const COMPENSATION_VIA_CSHARP = process.env.NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP === 'true';

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to the `number` the tRPC output declares.
const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

// DateTime fields serialize as canonical Node-ISO strings (…fffZ) via the shared Node-ISO
// converter. The tRPC output types them as Prisma `Date` (superjson rebuilds real Date objects),
// so the C# path reconstructs Date objects to be byte-identical at cutover. The contract types
// the raw values as `unknown`; parse to Date.
const toDate = (v: unknown): Date => new Date(v as string);

/**
 * HR-admin org catalog: raw SalaryBand rows (no per-person salary data). Gate:
 * `isPlatformApiEnabled() && NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /compensation/salary-bands (optional companyId query; min/mid/maxSalary doubles
 *            coerced; createdAt/updatedAt Dates rebuilt; title null preserved).
 *  - false → trpc.compensation.getSalaryBands.useQuery(filters) (the DEFAULT).
 */
export function useCompensationSalaryBands(filters?: { companyId?: string }) {
  const viaCSharp = isPlatformApiEnabled() && COMPENSATION_VIA_CSHARP;

  const trpcQuery = trpc.compensation.getSalaryBands.useQuery(filters ?? {}, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<SalaryBandsOutput>({
    queryKey: ['platform-api', 'compensation', 'salary-bands', filters ?? {}],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/compensation/salary-bands', { companyId: filters?.companyId });
      return raw.map((b) => ({
        id: b.id,
        organizationId: b.organizationId,
        level: b.level,
        title: b.title ?? null,
        minSalary: num(b.minSalary),
        midSalary: num(b.midSalary),
        maxSalary: num(b.maxSalary),
        currency: b.currency,
        isActive: b.isActive,
        createdAt: toDate(b.createdAt),
        updatedAt: toDate(b.updatedAt),
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF org-rollup: per-plan benefits utilization (pure kernel output; no min-5). Gate as above.
 *  - true  → GET /compensation/benefits-utilization (enrolled int + utilization double coerced).
 *  - false → trpc.compensation.getBenefitsUtilization.useQuery() (the DEFAULT).
 */
export function useCompensationBenefitsUtilization() {
  const viaCSharp = isPlatformApiEnabled() && COMPENSATION_VIA_CSHARP;

  const trpcQuery = trpc.compensation.getBenefitsUtilization.useQuery(undefined, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<BenefitsUtilizationOutput>({
    queryKey: ['platform-api', 'compensation', 'benefits-utilization'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/compensation/benefits-utilization');
      return raw.map((b) => ({
        id: b.id,
        name: b.name,
        category: b.category,
        enrolled: num(b.enrolled),
        utilization: num(b.utilization),
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF org-rollup: the min-5 compa-ratio distribution kernel. Gate as above.
 *  - true  → GET /compensation/compa-ratio-distribution (optional companyId/businessUnitId query;
 *            bucket keys ("<0.80" etc.) preserved verbatim; per-bucket count int|null coerced,
 *            null preserved; avgCompaRatio/totalEmployees int|null coerced; suppressed boolean).
 *  - false → trpc.compensation.getCompaRatioDistribution.useQuery(filters) (the DEFAULT).
 */
export function useCompensationCompaRatioDistribution(
  filters?: { companyId?: string; businessUnitId?: string },
) {
  const viaCSharp = isPlatformApiEnabled() && COMPENSATION_VIA_CSHARP;

  const trpcQuery = trpc.compensation.getCompaRatioDistribution.useQuery(filters ?? {}, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<CompaRatioDistributionOutput>({
    queryKey: ['platform-api', 'compensation', 'compa-ratio-distribution', filters ?? {}],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/compensation/compa-ratio-distribution', {
        companyId: filters?.companyId,
        businessUnitId: filters?.businessUnitId,
      });
      return {
        // Bucket keys ("<0.80", "0.80-0.90", …) are emitted verbatim by the kernel — map values
        // only, never rename/re-order keys (Object.entries preserves insertion order).
        distribution: Object.fromEntries(
          Object.entries(raw.distribution).map(([key, bucket]) => [
            key,
            { suppressed: bucket.suppressed, count: numOrNull(bucket.count) },
          ]),
        ),
        avgCompaRatio: numOrNull(raw.avgCompaRatio),
        totalEmployees: numOrNull(raw.totalEmployees),
        suppressed: raw.suppressed,
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF row-scoped + FIELD-AUTHED: pending salary adjustments. The restricted salary fields
 * (previousSalary/newSalary/currency/reason/type/status) are PRESENT only for entitled tiers
 * (super/hr; type/status also hrbp) and ABSENT otherwise — key absence is preserved (not nulled).
 * Gate as above.
 *  - true  → GET /compensation/pending-adjustments (JsonObject[]; dynamic field-authed shape;
 *            createdAt Date rebuilt; salaries coerced; absent restricted keys stay absent).
 *  - false → trpc.compensation.listPendingAdjustments.useQuery() (the DEFAULT).
 */
export function useCompensationListPendingAdjustments() {
  const viaCSharp = isPlatformApiEnabled() && COMPENSATION_VIA_CSHARP;

  const trpcQuery = trpc.compensation.listPendingAdjustments.useQuery(undefined, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<PendingAdjustmentsOutput>({
    queryKey: ['platform-api', 'compensation', 'pending-adjustments'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/compensation/pending-adjustments');
      // JsonObject is `Record<string, never>`; read through a lens that mirrors the field-authed
      // DTO (restricted keys optional). Double-cast via unknown because the index-signature type
      // is not directly comparable to the lens.
      return raw.map((row) => {
        const a = row as unknown as {
          id: string;
          createdAt: unknown;
          previousSalary?: number | string;
          newSalary?: number | string;
          currency?: string;
          reason?: string | null;
          type?: string;
          status?: string;
          user: { id: string; firstName: string; lastName: string; jobTitle?: string | null };
          requester: { id: string; firstName: string; lastName: string };
        };
        return {
          id: a.id,
          createdAt: toDate(a.createdAt),
          // Preserve ABSENCE of restricted keys (do not inject null for an omitted field).
          ...(a.previousSalary !== undefined ? { previousSalary: num(a.previousSalary) } : {}),
          ...(a.newSalary !== undefined ? { newSalary: num(a.newSalary) } : {}),
          ...(a.currency !== undefined ? { currency: a.currency } : {}),
          ...(a.reason !== undefined ? { reason: a.reason ?? null } : {}),
          ...(a.type !== undefined ? { type: a.type } : {}),
          ...(a.status !== undefined ? { status: a.status } : {}),
          user: {
            id: a.user.id,
            firstName: a.user.firstName,
            lastName: a.user.lastName,
            jobTitle: a.user.jobTitle ?? null,
          },
          requester: {
            id: a.requester.id,
            firstName: a.requester.firstName,
            lastName: a.requester.lastName,
          },
        };
        // The dynamic field-authed shape (optional restricted keys) is guaranteed server-side +
        // by backend integration tests; cast the mapped rows to the exact tRPC output type.
      }) as PendingAdjustmentsOutput;
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * OWN-scoped + FIELD-AUTHED: the caller's own compensation, or null when no row exists. The
 * restricted analytics fields (variablePay/compaRatio/band; currency/currentSalary for entitled
 * tiers) are PRESENT only for entitled roles and ABSENT otherwise — key absence is preserved.
 * Gate as above.
 *  - true  → GET /compensation/my-compensation (oneOf[null,object]; null → null; salaries coerced;
 *            band bounds coerced, band null preserved; absent restricted keys stay absent).
 *  - false → trpc.compensation.myCompensation.useQuery() (the DEFAULT).
 */
export function useCompensationMyCompensation() {
  const viaCSharp = isPlatformApiEnabled() && COMPENSATION_VIA_CSHARP;

  const trpcQuery = trpc.compensation.myCompensation.useQuery(undefined, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<MyCompensationOutput>({
    queryKey: ['platform-api', 'compensation', 'my-compensation'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/compensation/my-compensation');
      // 200 body is oneOf[null, object]: a missing comp row → null (graceful empty for the UI).
      if (raw === null) return null;
      const c = raw as unknown as {
        userId: string;
        currency?: string;
        currentSalary?: number | string;
        variablePay?: number | string;
        compaRatio?: number | string | null;
        band?: {
          level: string | null;
          title: string | null;
          min: number | string;
          mid: number | string;
          max: number | string;
          currency: string;
        } | null;
      };
      return {
        userId: c.userId,
        // Preserve ABSENCE of restricted keys (do not inject null for an omitted field).
        ...(c.currency !== undefined ? { currency: c.currency } : {}),
        ...(c.currentSalary !== undefined ? { currentSalary: num(c.currentSalary) } : {}),
        ...(c.variablePay !== undefined ? { variablePay: num(c.variablePay) } : {}),
        ...(c.compaRatio !== undefined ? { compaRatio: numOrNull(c.compaRatio) } : {}),
        ...(c.band !== undefined
          ? {
              band: c.band
                ? {
                    level: c.band.level,
                    title: c.band.title,
                    min: num(c.band.min),
                    mid: num(c.band.mid),
                    max: num(c.band.max),
                    currency: c.band.currency,
                  }
                : null,
            }
          : {}),
        // The dynamic field-authed DTO (optional restricted keys) is guaranteed server-side +
        // by backend integration tests; cast the mapped object to the exact tRPC output type.
      } as MyCompensationOutput;
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}
