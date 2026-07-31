'use client';

// Per-surface cutover wrapper for the access-review surface (Phase-5 Slice 18) — the C# port
// of `platform.getAccessReview`/`exportAccessReviewCsv`/`attestAccessReview`/
// `listAccessReviewAttestations`. Mirrors lib/platform-api/audit-log.ts's untyped-response
// situation.
//
// READS ARE C#-ONLY (2026-07-31): NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP was confirmed live
// in prod, and the TS getAccessReview/exportAccessReviewCsv/listAccessReviewAttestations
// procedures (packages/api/src/routers/platform/access-review.ts) were deleted — there is no tRPC
// fallback left, so useAccessReview/useAccessReviewExport/useAccessReviewAttestations below call
// the C# service unconditionally and no longer read the READ flag (it is now DEAD). Their output
// types are hand-declared, mirroring what the deleted procedures returned, since there is no
// tRPC procedure left to infer them from.
//
// THE WRITE STAYS DUAL-PATH (out of scope for this cleanup): attestAccessReview lives behind a
// SEPARATE flag (`Platform:AccessReviewWriteEnabled` / NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP,
// also confirmed live in prod 2026-07-31) and its TS procedure is untouched — its own
// TS-deletion is tracked as a separate follow-up task.
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

// attestAccessReview (the write) still has a live tRPC procedure, so its type stays INFERRED
// from the router contract.
type RouterOutput = inferRouterOutputs<AppRouter>;
type AttestAccessReviewOutput = RouterOutput['platform']['attestAccessReview'];

// The 3 C#-only read hooks' output types are hand-declared — there is no tRPC procedure left to
// infer them from. Shapes mirror what the deleted procedures returned, so every call site
// (page.tsx, attest-modal.tsx) is unchanged.
export interface RoleGrantView {
  slug: string;
  name: string;
  roleActive: boolean;
  assignedAt: Date;
  assignedBy: string | null;
  companyScope: string | null;
  unitScope: string | null;
  expiresAt: Date | null;
  grants: string[];
}

export interface AccessReviewRow {
  userId: string;
  name: string;
  email: string;
  organizationId: string;
  orgName: string | null;
  status: 'active' | 'inactive' | 'deleted';
  isPlatformOwner: boolean;
  lastLoginAt: Date | null;
  roles: RoleGrantView[];
  flags: {
    neverLoggedIn: boolean;
    stale: boolean;
    privileged: boolean;
    deprovisionGap: boolean;
    expiredGrant: boolean;
    crossOrgRole: boolean;
  };
}

export interface AccessReviewReportOutput {
  rows: AccessReviewRow[];
  summary: {
    userCount: number;
    privilegedCount: number;
    staleCount: number;
    deprovisionGapCount: number;
    expiredGapCount: number;
  };
  crossOrgRoleCount: number;
  truncated: boolean;
}

export interface AccessReviewExportOutput {
  format: 'csv';
  data: string;
  count: number;
  truncated: boolean;
}

export interface AccessReviewAttestationRecord {
  id: string;
  reviewedAt: Date;
  userCount: number;
  privilegedCount: number;
  staleCount: number;
  deprovisionGapCount: number;
  expiredGapCount: number;
  notes: string | null;
  reviewer: { firstName: string; lastName: string; email: string };
}
type ListAttestationsOutput = AccessReviewAttestationRecord[];

const ACCESS_REVIEW_WRITE_VIA_CSHARP = process.env.NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP === 'true';

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
 * C#-ONLY (TS getAccessReview deleted) — GET /access-review?organizationId=... (dates rebuilt
 * into Date objects, counts coerced, status/flags pass through). Disabled until an
 * organizationId is selected (mirrors the call site's `enabled: !!organizationId`).
 */
export function useAccessReview(organizationId: string) {
  return useQuery<AccessReviewReportOutput>({
    queryKey: ['platform-api', 'access-review', 'report', organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const raw = (await platformGetRaw('/access-review', { organizationId })) as RawAccessReviewReport;
      return mapRawReport(raw);
    },
  });
}

/**
 * PLATFORM-OWNER: CSV export, invoked imperatively on a button click (not a `useQuery`) — same
 * shape as `useAuditLogsExport`. C#-ONLY (TS exportAccessReviewCsv deleted) — GET
 * /access-review/export?organizationId=... (count coerced).
 */
export function useAccessReviewExport() {
  return async (organizationId: string): Promise<AccessReviewExportOutput> => {
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
    };
  };
}

/**
 * PLATFORM-OWNER: the org's attestation (recertification) history, newest first. C#-ONLY (TS
 * listAccessReviewAttestations deleted) — GET /access-review/attestations?organizationId=...
 * &limit=... (reviewedAt rebuilt, counts coerced). Disabled until an organizationId is selected.
 */
export function useAccessReviewAttestations(organizationId: string, limit = 20) {
  return useQuery<ListAttestationsOutput>({
    queryKey: ['platform-api', 'access-review', 'attestations', organizationId, limit],
    enabled: !!organizationId,
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
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Write (Phase-5 Slice 18) — a SEPARATE flag from the reads above, mirroring backend
// `Platform:AccessReviewWriteEnabled` (independent of AccessReviewReadEnabled).
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

/** PLATFORM-OWNER: record a quarterly recertification attestation. */
export function useAccessReviewAttest(options?: MutationOptions<AttestAccessReviewOutput>) {
  const viaCSharp = isPlatformApiEnabled() && ACCESS_REVIEW_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.platform.attestAccessReview.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: AttestAccessReviewInputShape) => {
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
    } as AttestAccessReviewOutput;
  }, options);
  return viaCSharp ? csharpMutation : trpcMutation;
}
