'use client';

// Compensation FE data layer — C#-ONLY, all 10 hooks below.
//
// The first 7 hooks' TS tRPC procedures were DELETED on 2026-07-29: getSalaryBands /
// getBenefitsUtilization / getCompaRatioDistribution / listPendingAdjustments / myCompensation
// (reads) and createAdjustment / approveAdjustment (writes). Both
// NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP and NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP were
// confirmed live in prod on 2026-07-28, so these hooks call the C# service unconditionally and no
// longer read either flag — both flags are now DEAD (see .env.example).
//
// The remaining 3 hooks — useCompensationBandDistribution / useCompensationTotalCompBreakdown /
// useCompensationDashboardKpis — were the FX-DEPENDENT reads (getBandDistribution /
// getTotalCompBreakdown / getDashboardKpis), gated by the backend `Platform__FxReadsEnabled` flag
// (shared cross-domain with `dei.getPayEquity` — see platform-api/dei.ts's header) and by their own
// FE flag, NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP. That flag is now confirmed permanently live
// in prod (`fx_rates` seeded via the first FxRefreshJob run — see
// docs/architecture/csharp-migration/fx-seed-once-runbook.md), and their TS tRPC procedures
// (packages/api/src/routers/compensation.ts) were DELETED in this same pass — this closes the
// compensation domain's TS-deletion carve-out. These 3 hooks now call the C# service
// unconditionally too, so this file is no longer split — every hook mirrors the C#-only pattern
// used across the rest of lib/platform-api/*.ts. Their output types are hand-declared below, or
// re-sourced from the @tims/shared kernels the C# port is golden-fixtured against (same as the
// first 7), because no tRPC procedure remains to infer them from.
//
// NOT WRAPPED AT ALL: getPayEquity (compensation's own — distinct from the DEI domain's
// `dei.getPayEquity`, wrapped in platform-api/dei.ts), simulateAdjustment, getMarketComparison and
// getEmployeeComp have zero FE call sites and get no hook here; their TS procedures stay live and
// untouched.
//
// FIELD-AUTH NUANCE (my-compensation + pending-adjustments): the C# OpenAPI types these 200 bodies as
// free-form `object` (JsonObject / oneOf[null,object]) — the field-authed shape is dynamic (restricted
// keys ABSENT for lower tiers, not null), so platformGet returns a loosely typed object. Each wrapper
// reads the raw object through a lens, maps it to the hand-declared shape PRESERVING key absence (no
// null injected for an absent restricted key), then casts. The field-auth guarantees are enforced
// server-side by the C# implementation + its integration tests; the FE wrapper only needs
// shape-compatibility. No `any`.

import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  BandDistributionOut,
  BenefitUtilizationItem,
  CompaRatioDistribution,
  CompDashboardKpisOut,
  TotalCompBreakdownOut,
} from '@tims/shared';
import { platformGet, platformPost } from './client';

// The 3 FX-dependent hooks' output types are re-sourced from the @tims/shared kernels the C# port
// is golden-fixtured against (buildBandDistribution / buildTotalCompBreakdown /
// buildCompDashboardKpis), the same strategy already used below for BenefitsUtilizationOutput /
// CompaRatioDistributionOutput — there is no tRPC procedure left to infer from.
type BandDistributionOutput = BandDistributionOut[];
type TotalCompBreakdownOutput = TotalCompBreakdownOut;
type CompDashboardKpisOutput = CompDashboardKpisOut;

// The other 7 C#-only hooks' output types are hand-declared (there is no tRPC procedure left to
// infer from). Shapes mirror what the deleted procedures returned, so every call site is unchanged.

// Prisma `SalaryBand` scalar row (packages/db/prisma/schema/compensation.prisma:1-19). The deleted
// getSalaryBands was a bare findMany with no `select`, so the tRPC output was the full 11-field row
// with superjson-rebuilt Dates — exactly what the mapper below produces. Every status/type column in
// that schema file is a plain `String` (no Prisma enums), so nothing is a union type.
interface SalaryBandRow {
  id: string;
  organizationId: string;
  level: string;
  title: string | null;
  minSalary: number;
  midSalary: number;
  maxSalary: number;
  currency: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
type SalaryBandsOutput = SalaryBandRow[];

// buildBenefitsUtilization / buildCompaRatioDistribution are the pure @tims/shared kernels the
// deleted procedures returned verbatim AND the C# port is golden-fixtured against
// (contracts/compensation-fixtures/*), so sourcing these two shapes from @tims/shared keeps the FE
// contract-locked to the one definition both stacks share.
type BenefitsUtilizationOutput = BenefitUtilizationItem[];
type CompaRatioDistributionOutput = CompaRatioDistribution;

// Field-authed dynamic shape: id/createdAt/user/requester are always present; the restricted salary
// keys are PRESENT for entitled tiers (super/hr; type/status also hrbp) and ABSENT otherwise — never
// nulled. Optional keys model exactly that.
interface PendingAdjustmentRow {
  id: string;
  createdAt: Date;
  previousSalary?: number;
  newSalary?: number;
  currency?: string;
  reason?: string | null;
  type?: string;
  status?: string;
  user: { id: string; firstName: string; lastName: string; jobTitle: string | null };
  requester: { id: string; firstName: string; lastName: string };
}
type PendingAdjustmentsOutput = PendingAdjustmentRow[];

// Mirrors EmployeeCompDto (packages/api/src/services/compensation.service.ts:33-40), which is NOT
// re-exported from @tims/api's entrypoint (package.json main/types = ./src/root.ts, which exports
// only the router + AppRouter) — so it is hand-declared here rather than imported. Same field-auth
// key-absence semantics as PendingAdjustmentRow above.
interface MyCompensationDto {
  userId: string;
  currency?: string;
  currentSalary?: number;
  variablePay?: number;
  compaRatio?: number | null;
  band?: {
    level: string | null;
    title: string | null;
    min: number;
    mid: number;
    max: number;
    currency: string;
  } | null;
}
type MyCompensationOutput = MyCompensationDto | null;

// §21 minimal-select: both write endpoints return only id + status (the deleted TS procedures did
// `select: { id: true, status: true }` and `return { id: input.id, status: newStatus }` respectively).
interface AdjustmentMutationResult {
  id: string;
  status: string;
}
type CreateAdjustmentOutput = AdjustmentMutationResult;
type ApproveAdjustmentOutput = AdjustmentMutationResult;

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to the `number` the tRPC output declares.
const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

// DateTime fields serialize as canonical Node-ISO strings (…fffZ) via the shared Node-ISO
// converter. The tRPC output types them as Prisma `Date` (superjson rebuilds real Date objects),
// so the C# path reconstructs Date objects to be byte-identical at cutover. The contract types
// the raw values as `unknown`; parse to Date.
const toDate = (v: unknown): Date => new Date(v as string);

/**
 * HR-admin org catalog: raw SalaryBand rows (no per-person salary data). C#-ONLY — the TS tRPC
 * procedure was deleted. GET /compensation/salary-bands (optional companyId query;
 * min/mid/maxSalary doubles coerced; createdAt/updatedAt Dates rebuilt; title null preserved).
 */
export function useCompensationSalaryBands(filters?: { companyId?: string }) {
  return useQuery<SalaryBandsOutput>({
    queryKey: ['platform-api', 'compensation', 'salary-bands', filters ?? {}],
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
}

/**
 * STAFF org-rollup: per-plan benefits utilization (pure kernel output; no min-5). C#-ONLY — the TS
 * tRPC procedure was deleted. GET /compensation/benefits-utilization (enrolled int + utilization
 * double coerced). The row shape is @tims/shared's BenefitUtilizationItem, the same kernel output
 * the C# port is golden-fixtured against.
 */
export function useCompensationBenefitsUtilization() {
  return useQuery<BenefitsUtilizationOutput>({
    queryKey: ['platform-api', 'compensation', 'benefits-utilization'],
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
}

/**
 * STAFF org-rollup: the min-5 compa-ratio distribution kernel. C#-ONLY — the TS tRPC procedure was
 * deleted. GET /compensation/compa-ratio-distribution (optional companyId/businessUnitId query;
 * bucket keys ("<0.80" etc.) preserved verbatim; per-bucket count int|null coerced, null preserved;
 * avgCompaRatio/totalEmployees int|null coerced; suppressed boolean). The shape is @tims/shared's
 * CompaRatioDistribution, the same kernel output the C# port is golden-fixtured against.
 */
export function useCompensationCompaRatioDistribution(filters?: { companyId?: string; businessUnitId?: string }) {
  return useQuery<CompaRatioDistributionOutput>({
    queryKey: ['platform-api', 'compensation', 'compa-ratio-distribution', filters ?? {}],
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
}

/**
 * STAFF row-scoped + FIELD-AUTHED: pending salary adjustments. The restricted salary fields
 * (previousSalary/newSalary/currency/reason/type/status) are PRESENT only for entitled tiers
 * (super/hr; type/status also hrbp) and ABSENT otherwise — key absence is preserved (not nulled).
 * C#-ONLY — the TS tRPC procedure was deleted. GET /compensation/pending-adjustments (JsonObject[];
 * dynamic field-authed shape; createdAt Date rebuilt; salaries coerced; absent restricted keys stay
 * absent).
 */
export function useCompensationListPendingAdjustments() {
  return useQuery<PendingAdjustmentsOutput>({
    queryKey: ['platform-api', 'compensation', 'pending-adjustments'],
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
        // The dynamic field-authed shape (optional restricted keys) is guaranteed server-side by the
        // C# implementation + its integration tests; cast the mapped rows to the declared type.
      }) as PendingAdjustmentsOutput;
    },
  });
}

/**
 * OWN-scoped + FIELD-AUTHED: the caller's own compensation, or null when no row exists. The
 * restricted analytics fields (variablePay/compaRatio/band; currency/currentSalary for entitled
 * tiers) are PRESENT only for entitled roles and ABSENT otherwise — key absence is preserved.
 * C#-ONLY — the TS tRPC procedure was deleted. GET /compensation/my-compensation
 * (oneOf[null,object]; null → null; salaries coerced; band bounds coerced, band null preserved;
 * absent restricted keys stay absent).
 */
export function useCompensationMyCompensation() {
  return useQuery<MyCompensationOutput>({
    queryKey: ['platform-api', 'compensation', 'my-compensation'],
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
        // The dynamic field-authed DTO (optional restricted keys) is guaranteed server-side by the
        // C# implementation + its integration tests; cast the mapped object to the declared type.
      } as MyCompensationOutput;
    },
  });
}

/**
 * STAFF org-rollup, FX-dependent: employees plotted within their salary band (1 call site:
 * comp-left-column.tsx SalaryBands). C#-ONLY — the TS tRPC procedure was deleted.
 * GET /compensation/band-distribution (per-band min/mid/max + per-dot pos coerced; EMPTY dots on
 * every band when suppressed).
 */
export function useCompensationBandDistribution() {
  return useQuery<BandDistributionOutput>({
    queryKey: ['platform-api', 'compensation', 'band-distribution'],
    queryFn: async () => {
      const raw = await platformGet('/compensation/band-distribution');
      return raw.map((b) => ({
        level: b.level,
        title: b.title,
        min: num(b.min),
        mid: num(b.mid),
        max: num(b.max),
        currency: b.currency,
        dots: b.dots.map((d) => ({ pos: num(d.pos), outlier: d.outlier })),
        suppressed: b.suppressed,
      }));
    },
  });
}

/**
 * STAFF org-rollup, FX-dependent: the base/variable comp total, org-wide (1 call site:
 * comp-bottom-row.tsx TotalCompBreakdown). C#-ONLY — the TS tRPC procedure was deleted. No
 * `companyId` filter is ever passed by the call site, so this hook is zero-arg.
 * GET /compensation/total-comp-breakdown (totalComp/employeeCount coerced-or-null;
 * breakdown.{baseSalary,variablePay}.{total,percentage} coerced-or-null).
 */
export function useCompensationTotalCompBreakdown() {
  return useQuery<TotalCompBreakdownOutput>({
    queryKey: ['platform-api', 'compensation', 'total-comp-breakdown'],
    queryFn: async () => {
      const raw = await platformGet('/compensation/total-comp-breakdown');
      return {
        totalComp: numOrNull(raw.totalComp),
        currency: raw.currency,
        converted: raw.converted,
        ratesAsOf: raw.ratesAsOf,
        breakdown: {
          baseSalary: {
            total: numOrNull(raw.breakdown.baseSalary.total),
            percentage: numOrNull(raw.breakdown.baseSalary.percentage),
          },
          variablePay: {
            total: numOrNull(raw.breakdown.variablePay.total),
            percentage: numOrNull(raw.breakdown.variablePay.percentage),
          },
        },
        employeeCount: numOrNull(raw.employeeCount),
        suppressed: raw.suppressed,
      };
    },
  });
}

/**
 * STAFF org-rollup, FX-dependent: the compensation dashboard KPIs (2 call sites:
 * compensation/page.tsx, hr-exec-dashboard.tsx). C#-ONLY — the TS tRPC procedure was deleted.
 * GET /compensation/dashboard-kpis (all numeric fields coerced-or-null per the min-5/fail-soft
 * guards; activeEmployees/benefitsUtilizationPct never null).
 */
export function useCompensationDashboardKpis() {
  return useQuery<CompDashboardKpisOutput>({
    queryKey: ['platform-api', 'compensation', 'dashboard-kpis'],
    queryFn: async () => {
      const raw = await platformGet('/compensation/dashboard-kpis');
      return {
        totalMonthlyPayroll: numOrNull(raw.totalMonthlyPayroll),
        avgSalary: numOrNull(raw.avgSalary),
        currency: raw.currency,
        converted: raw.converted,
        ratesAsOf: raw.ratesAsOf,
        compensatedEmployees: numOrNull(raw.compensatedEmployees),
        compensatedSuppressed: raw.compensatedSuppressed,
        activeEmployees: num(raw.activeEmployees),
        pendingAdjustments: numOrNull(raw.pendingAdjustments),
        pendingAdjustmentsSuppressed: raw.pendingAdjustmentsSuppressed,
        benefitsUtilizationPct: num(raw.benefitsUtilizationPct),
        avgCompaRatio: numOrNull(raw.avgCompaRatio),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Writes (Phase-5 Slice 12) — C#-ONLY. Both TS tRPC mutations (compensation.createAdjustment /
// compensation.approveAdjustment) were deleted on 2026-07-29;
// NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP was confirmed live in prod on 2026-07-28 and is no
// longer read here (the flag is retired — see .env.example). Both mutations have live FE consumers
// (talent/succession/request-adjustment-modal.tsx, compensation/approve-adjustment-modal.tsx) — a
// 100% wrap rate, so nothing was left unwrapped. Each hook keeps trpc's useMutation option shape
// ({ onSuccess?, onError?, onSettled? }), so both call sites are unchanged; both consumers invalidate
// the `['platform-api','compensation',...]` (and, for createAdjustment,
// `['platform-api','succession',...]` comp-gap) query keys themselves post-success — this file only
// supplies the mutation itself. Error messages were byte-identical between stacks before the TS side
// was removed (createAdjustment's FORBIDDEN, approveAdjustment's NOT_FOUND/CONFLICT all shared the
// exact TS/C# message constants), so the C# strings the consumers surface today are the same strings
// users already saw.
// ---------------------------------------------------------------------------

interface MutationOptions {
  onSuccess?: () => void;
  onError?: (err: { message: string }) => void;
  onSettled?: () => void;
}

function useCSharpMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
  options: MutationOptions | undefined,
) {
  return useMutation({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (err: unknown) => options?.onError?.(err instanceof Error ? err : { message: 'Unknown error' }),
    onSettled: options?.onSettled,
  });
}

interface CreateAdjustmentInputShape {
  userId: string;
  type: string;
  previousSalary: number;
  newSalary: number;
  currency?: string;
  reason?: string;
  effectiveDate: string;
}

/** STAFF: request a salary adjustment (1 call site: talent/succession/request-adjustment-modal.tsx). */
export function useCompensationCreateAdjustment(options?: MutationOptions) {
  return useCSharpMutation(async (input: CreateAdjustmentInputShape) => {
    const raw = await platformPost('/compensation/adjustments', {
      userId: input.userId,
      type: input.type,
      previousSalary: input.previousSalary,
      newSalary: input.newSalary,
      currency: input.currency,
      reason: input.reason,
      effectiveDate: input.effectiveDate,
    });
    return { id: raw.id, status: raw.status } satisfies CreateAdjustmentOutput;
  }, options);
}

interface ApproveAdjustmentInputShape {
  id: string;
  approved: boolean;
  comment?: string;
}

/** STAFF: approve/reject a pending adjustment (1 call site: compensation/approve-adjustment-modal.tsx). */
export function useCompensationApproveAdjustment(options?: MutationOptions) {
  return useCSharpMutation(async (input: ApproveAdjustmentInputShape) => {
    const raw = await platformPost(
      '/compensation/adjustments/{id}/approve',
      { approved: input.approved, comment: input.comment },
      { id: input.id },
    );
    return { id: raw.id, status: raw.status } satisfies ApproveAdjustmentOutput;
  }, options);
}
