import { TRPCError } from '@trpc/server';
import type { AccessContext } from '../access/types';
import type { ExternalAssessmentResultV1 } from '../dto/external-assessment';
import { platformGetWithAuth } from '../lib/platform-api-client';

export interface ExternalAuditMeta {
  organizationId: string;
  apiKeyId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Phase-5 Slice 1 cutover: `EXTERNAL_VENDOR_READ_VIA_CSHARP` (server-only env var) is confirmed
// `true` in production (flipped 2026-07-31) — list()/getOne() below now proxy the vendor's OWN
// bearer token to the C# service (services/Tims.Platform) UNCONDITIONALLY. The Prisma-backed TS
// fallback (previously gated behind the flag) has been deleted as provably dead code; the C#
// side's own `Platform:ExternalVendorReadEnabled` flag is independently `true` on App Runner.
// `platformGetWithAuth` itself throws if `NEXT_PUBLIC_TIMS_PLATFORM_API_URL` is unset, so a
// misconfigured environment fails loudly rather than silently degrading to Prisma.

// The C# minimal-API JSON contract types every nullable double as `number | string | null` (a
// number-as-string wire artifact); restore the exact `number | null` the v1 DTO declares.
const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

// Raw wire shape of a single C# `ExternalAssessmentResultV1` (Tims.Domain.ExternalVendor) — Dates
// serialize as Node-ISO strings (NodeIsoDateTimeOffsetConverter), byte-identical to what `Date`
// round-trips through JSON on the TS side, so `new Date(...)` reconstructs the same instant.
interface RawExternalAssessmentResultV1 {
  schemaVersion: string;
  assignmentId: string;
  candidateId: string;
  vacancyId: string;
  assessmentType: string | null;
  status: string;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  scoredAt: string;
  rawScore: number | string | null;
  normalizedScore: number | string | null;
  percentile: number | string | null;
  interpretation: unknown;
  breakdown: unknown;
  modelVersion: string | null;
}

function mapRawResultV1(raw: RawExternalAssessmentResultV1): ExternalAssessmentResultV1 {
  return {
    schemaVersion: 'v1',
    assignmentId: raw.assignmentId,
    candidateId: raw.candidateId,
    vacancyId: raw.vacancyId,
    assessmentType: raw.assessmentType,
    status: raw.status,
    assignedAt: new Date(raw.assignedAt),
    startedAt: raw.startedAt == null ? null : new Date(raw.startedAt),
    completedAt: raw.completedAt == null ? null : new Date(raw.completedAt),
    expiresAt: raw.expiresAt == null ? null : new Date(raw.expiresAt),
    scoredAt: new Date(raw.scoredAt),
    rawScore: numOrNull(raw.rawScore),
    normalizedScore: numOrNull(raw.normalizedScore),
    percentile: numOrNull(raw.percentile),
    interpretation: raw.interpretation,
    breakdown: raw.breakdown,
    modelVersion: raw.modelVersion,
  };
}

// Maps a non-2xx, non-404 proxy response to a tRPC error. A 401/403 here means the SAME key that
// already passed this procedure's OWN TS-side grant/scope check was rejected independently by the
// C# service's gate — a real cross-stack authorization mismatch, not a normal vendor error path.
function mapProxyError(status: number): TRPCError {
  if (status === 401) return new TRPCError({ code: 'UNAUTHORIZED' });
  if (status === 403) return new TRPCError({ code: 'FORBIDDEN' });
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'External read via platform service failed' });
}

export const externalAssessmentService = {
  async list(
    _access: AccessContext,
    _meta: ExternalAuditMeta,
    take: number,
    cursor: string | undefined,
    authorizationHeader: string,
  ): Promise<{ items: ExternalAssessmentResultV1[]; nextCursor?: string }> {
    // `_access`/`_meta` are unused now that the Prisma fallback is gone — kept in the signature
    // so this still matches the router's call site (packages/api/src/routers/external.ts),
    // which is out of scope for this deletion. The C# use case writes its OWN fail-closed audit
    // row per exported item — do NOT also audit here, or every export would be double-logged.
    const { status, body } = await platformGetWithAuth('/external/assessment-results', authorizationHeader, {
      take,
      cursor,
    });
    if (status !== 200) throw mapProxyError(status);
    const raw = body as { items: RawExternalAssessmentResultV1[]; nextCursor: string | null };
    return { items: raw.items.map(mapRawResultV1), nextCursor: raw.nextCursor ?? undefined };
  },

  async getOne(
    _access: AccessContext,
    _meta: ExternalAuditMeta,
    assignmentId: string,
    authorizationHeader: string,
  ): Promise<ExternalAssessmentResultV1> {
    // Same unused-params + no-double-audit rationale as list() above.
    const { status, body } = await platformGetWithAuth(
      `/external/assessment-results/${encodeURIComponent(assignmentId)}`,
      authorizationHeader,
    );
    if (status === 404) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Resultado de evaluacion no encontrado' });
    }
    if (status !== 200) throw mapProxyError(status);
    return mapRawResultV1(body as RawExternalAssessmentResultV1);
  },
};
