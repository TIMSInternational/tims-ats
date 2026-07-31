'use client';

// Per-surface dark-cutover wrapper for the access-review surface (Phase-5 Slice 18) — the C# port
// of `platform.getAccessReview`/`exportAccessReviewCsv`/`attestAccessReview`/
// `listAccessReviewAttestations`. DARK by default for the 3 READ hooks: unless BOTH the
// platform-api base URL and NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP are set at deploy time,
// each read hook returns the existing tRPC call unchanged. Mirrors lib/platform-api/audit-log.ts —
// this is the SAME platform-owner-only, untyped-response situation.
//
// TWO independent flags, matching the backend split: reads (getAccessReview/exportAccessReviewCsv/
// listAccessReviewAttestations) live behind `Platform:AccessReviewReadEnabled`, still dark-gated
// below (their TS deletion is a separate, out-of-scope task). The attest WRITE — gated behind
// `Platform:AccessReviewWriteEnabled` — is DIFFERENT: as of 2026-07-31 its flag is confirmed live
// and its TS tRPC procedure was deleted, so `useAccessReviewAttest` below always calls the C#
// endpoint unconditionally (no more tRPC fallback, no more gate check).
//
// UNTYPED RESPONSE BODIES — like audit-log, NONE of the 4 C# access-review endpoints
// (`GET /access-review`, `GET /access-review/export`, `GET /access-review/attestations`,
// `POST /access-review/attest`) has a `.Produces<T>()` on its minimal-API mapping, so the
// generated OpenAPI contract has no typed body for any of them. Every hook below uses the
// `platformGetRaw`/`platformPostRaw` escape hatches and hand-types the response.

import { useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGetRaw, platformPostRaw } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type AccessReviewReportOutput = RouterOutput['platform']['getAccessReview'];
type AccessReviewExportOutput = RouterOutput['platform']['exportAccessReviewCsv'];
type ListAttestationsOutput = RouterOutput['platform']['listAccessReviewAttestations'];
// `attestAccessReview` (the write) is gone from the router — deleted 2026-07-31 alongside its
// TS procedure. `AttestAccessReviewOutput` is now hand-declared (there is no tRPC procedure
// left to infer it from) right above `useAccessReviewAttest` below.
type AccessReviewRow = AccessReviewReportOutput['rows'][number];
type RoleGrantView = AccessReviewRow['roles'][number];

const ACCESS_REVIEW_READ_VIA_CSHARP = process.env.NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP === 'true';
// NOTE: NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP is no longer read here — the write hook
// (`useAccessReviewAttest` below) went C#-only 2026-07-31 and no longer branches on it.

// The C# `int` fields have no custom converter and serialize as plain JSON numbers, but every
// other domain in this migration defensively coerces numeric wire values the same way (in case a
// future field gains a string-shaped converter) — same `num` helper as every other wrapper.
const num = (v: number | string): number => Number(v);
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

interface RawRoleGrantView {
  slug: string;
  name: string;
  roleActive: boolean;
  assignedAt: string;
  assignedBy: string | null;
  companyScope: string | null;
  unitScope: string | null;
  expiresAt: string | null;
  grants: string[];
}

interface RawAccessReviewRow {
  userId: string;
  name: string;
  email: string;
  organizationId: string;
  orgName: string | null;
  status: string;
  isPlatformOwner: boolean;
  lastLoginAt: string | null;
  roles: RawRoleGrantView[];
  flags: {
    neverLoggedIn: boolean;
    stale: boolean;
    privileged: boolean;
    deprovisionGap: boolean;
    expiredGrant: boolean;
    crossOrgRole: boolean;
  };
}

interface RawAccessReviewReport {
  rows: RawAccessReviewRow[];
  summary: {
    userCount: number | string;
    privilegedCount: number | string;
    staleCount: number | string;
    deprovisionGapCount: number | string;
    expiredGapCount: number | string;
  };
  crossOrgRoleCount: number | string;
  truncated: boolean;
}

function mapRawRole(raw: RawRoleGrantView): RoleGrantView {
  return {
    slug: raw.slug,
    name: raw.name,
    roleActive: raw.roleActive,
    assignedAt: toDate(raw.assignedAt),
    assignedBy: raw.assignedBy,
    companyScope: raw.companyScope,
    unitScope: raw.unitScope,
    expiresAt: toDateOrNull(raw.expiresAt),
    grants: raw.grants,
  } as RoleGrantView;
}

function mapRawRow(raw: RawAccessReviewRow): AccessReviewRow {
  return {
    userId: raw.userId,
    name: raw.name,
    email: raw.email,
    organizationId: raw.organizationId,
    orgName: raw.orgName,
    status: raw.status as AccessReviewRow['status'],
    isPlatformOwner: raw.isPlatformOwner,
    lastLoginAt: toDateOrNull(raw.lastLoginAt),
    roles: raw.roles.map(mapRawRole),
    flags: raw.flags,
  } as AccessReviewRow;
}

function mapRawReport(raw: RawAccessReviewReport): AccessReviewReportOutput {
  return {
    rows: raw.rows.map(mapRawRow),
    summary: {
      userCount: num(raw.summary.userCount),
      privilegedCount: num(raw.summary.privilegedCount),
      staleCount: num(raw.summary.staleCount),
      deprovisionGapCount: num(raw.summary.deprovisionGapCount),
      expiredGapCount: num(raw.summary.expiredGapCount),
    },
    crossOrgRoleCount: num(raw.crossOrgRoleCount),
    truncated: raw.truncated,
  } as AccessReviewReportOutput;
}

/**
 * PLATFORM-OWNER: one org's full access-review report (users × roles × grants × risk flags).
 * Gate: `isPlatformApiEnabled() && NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /access-review?organizationId=... (dates rebuilt into Date objects, counts
 *            coerced, status/flags pass through).
 *  - false → trpc.platform.getAccessReview.useQuery({ organizationId }) (the DEFAULT).
 * Disabled until an organizationId is selected (mirrors the call site's `enabled: !!organizationId`).
 */
export function useAccessReview(organizationId: string) {
  const viaCSharp = isPlatformApiEnabled() && ACCESS_REVIEW_READ_VIA_CSHARP;
  const enabledId = !!organizationId;

  const trpcQuery = trpc.platform.getAccessReview.useQuery({ organizationId }, { enabled: !viaCSharp && enabledId });

  const csharpQuery = useQuery<AccessReviewReportOutput>({
    queryKey: ['platform-api', 'access-review', 'report', organizationId],
    enabled: viaCSharp && enabledId,
    queryFn: async () => {
      const raw = (await platformGetRaw('/access-review', { organizationId })) as RawAccessReviewReport;
      return mapRawReport(raw);
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * PLATFORM-OWNER: CSV export, invoked imperatively on a button click (not a `useQuery`) — same
 * shape as `useAuditLogsExport`. Gate as above.
 *  - true  → GET /access-review/export?organizationId=... (count coerced).
 *  - false → utils.platform.exportAccessReviewCsv.fetch({ organizationId }) (the DEFAULT).
 */
export function useAccessReviewExport() {
  const utils = trpc.useUtils();
  const viaCSharp = isPlatformApiEnabled() && ACCESS_REVIEW_READ_VIA_CSHARP;

  return async (organizationId: string): Promise<AccessReviewExportOutput> => {
    if (viaCSharp) {
      const raw = (await platformGetRaw('/access-review/export', { organizationId })) as {
        format: 'csv';
        data: string;
        count: number | string;
        truncated: boolean;
      };
      return {
        format: raw.format,
        data: raw.data,
        count: num(raw.count),
        truncated: raw.truncated,
      } as AccessReviewExportOutput;
    }
    return utils.platform.exportAccessReviewCsv.fetch({ organizationId });
  };
}

/**
 * PLATFORM-OWNER: the org's attestation (recertification) history, newest first. Gate as above
 * (the READ flag — attestations are a read, not the attest write itself).
 *  - true  → GET /access-review/attestations?organizationId=...&limit=... (reviewedAt rebuilt,
 *            counts coerced).
 *  - false → trpc.platform.listAccessReviewAttestations.useQuery({ organizationId, limit }).
 * Disabled until an organizationId is selected.
 */
export function useAccessReviewAttestations(organizationId: string, limit = 20) {
  const viaCSharp = isPlatformApiEnabled() && ACCESS_REVIEW_READ_VIA_CSHARP;
  const enabledId = !!organizationId;

  const trpcQuery = trpc.platform.listAccessReviewAttestations.useQuery(
    { organizationId, limit },
    { enabled: !viaCSharp && enabledId },
  );

  const csharpQuery = useQuery<ListAttestationsOutput>({
    queryKey: ['platform-api', 'access-review', 'attestations', organizationId, limit],
    enabled: viaCSharp && enabledId,
    queryFn: async () => {
      const raw = (await platformGetRaw('/access-review/attestations', {
        organizationId,
        limit,
      })) as Array<{
        id: string;
        reviewedAt: string;
        userCount: number | string;
        privilegedCount: number | string;
        staleCount: number | string;
        deprovisionGapCount: number | string;
        expiredGapCount: number | string;
        notes: string | null;
        reviewer: { firstName: string; lastName: string; email: string };
      }>;
      return raw.map((a) => ({
        id: a.id,
        reviewedAt: toDate(a.reviewedAt),
        userCount: num(a.userCount),
        privilegedCount: num(a.privilegedCount),
        staleCount: num(a.staleCount),
        deprovisionGapCount: num(a.deprovisionGapCount),
        expiredGapCount: num(a.expiredGapCount),
        notes: a.notes,
        reviewer: a.reviewer,
      })) as ListAttestationsOutput;
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

// ---------------------------------------------------------------------------
// Write (Phase-5 Slice 18) — was gated behind a SEPARATE flag from the reads above
// (`Platform:AccessReviewWriteEnabled`, independent of AccessReviewReadEnabled). That flag is
// now confirmed live and the TS side deleted (2026-07-31), so `useAccessReviewAttest` below is
// unconditionally C#-only — see its docstring.
// ---------------------------------------------------------------------------

interface MutationOptions<TData = void> {
  onSuccess?: (data: TData) => void;
  onError?: (err: { message: string }) => void;
  onSettled?: () => void;
}

function useCSharpMutation<TInput, TData>(
  mutationFn: (input: TInput) => Promise<TData>,
  options: MutationOptions<TData> | undefined,
) {
  return useMutation({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (err: unknown) => options?.onError?.(err instanceof Error ? err : { message: 'Unknown error' }),
    onSettled: options?.onSettled,
  });
}

interface AttestAccessReviewInputShape {
  organizationId: string;
  notes?: string;
}

// Hand-declared (there is no tRPC procedure left to infer from — `attestAccessReview` was
// deleted from the router 2026-07-31). Mirrors the C# `AccessReviewService.AttestAsync` response.
interface AttestAccessReviewOutput {
  id: string;
  organizationId: string;
  reviewerId: string;
  reviewedAt: Date;
  userCount: number;
  privilegedCount: number;
  staleCount: number;
  deprovisionGapCount: number;
  expiredGapCount: number;
  notes: string | null;
}

/**
 * PLATFORM-OWNER: record a quarterly recertification attestation.
 * C#-ONLY — the TS tRPC procedure `attestAccessReview` was deleted 2026-07-31
 * (`NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP` confirmed live, parity-verified 3/3 PASS via
 * `scripts/parity/cli.ts verify-write access-review`). No more tRPC fallback, no gate check.
 */
export function useAccessReviewAttest(options?: MutationOptions<AttestAccessReviewOutput>) {
  return useCSharpMutation(async (input: AttestAccessReviewInputShape) => {
    const raw = (await platformPostRaw('/access-review/attest', {
      organizationId: input.organizationId,
      notes: input.notes,
    })) as {
      id: string;
      organizationId: string;
      reviewerId: string;
      reviewedAt: string;
      userCount: number | string;
      privilegedCount: number | string;
      staleCount: number | string;
      deprovisionGapCount: number | string;
      expiredGapCount: number | string;
      notes: string | null;
    };
    return {
      id: raw.id,
      organizationId: raw.organizationId,
      reviewerId: raw.reviewerId,
      reviewedAt: toDate(raw.reviewedAt),
      userCount: num(raw.userCount),
      privilegedCount: num(raw.privilegedCount),
      staleCount: num(raw.staleCount),
      deprovisionGapCount: num(raw.deprovisionGapCount),
      expiredGapCount: num(raw.expiredGapCount),
      notes: raw.notes,
    } satisfies AttestAccessReviewOutput;
  }, options);
}
