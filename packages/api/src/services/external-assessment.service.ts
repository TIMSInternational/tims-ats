import { TRPCError } from '@trpc/server';
import type { AccessContext } from '../access/types';
import { logDataAccess } from '../access/audit';
import { listExternalResults, getExternalResult } from '../repositories/external-assessment.repository';
import {
  toExternalAssessmentResultV1,
  type ExternalAssessmentResultV1,
  type ExternalResultRow,
} from '../dto/external-assessment';
import { isPlatformApiEnabled, platformGetWithAuth } from '../lib/platform-api-client';

export interface ExternalAuditMeta {
  organizationId: string;
  apiKeyId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Dark per-surface cutover flag (Phase-5 Slice 1) — SERVER-ONLY, deliberately NOT
// NEXT_PUBLIC_*: this decision is made entirely server-side (no browser is ever involved in the
// external-vendor surface), so there is nothing to inline into a client bundle. When both this
// AND NEXT_PUBLIC_TIMS_PLATFORM_API_URL are set, list()/getOne() below proxy the vendor's OWN
// bearer token to the C# service (services/Tims.Platform) instead of querying Prisma directly.
// DEFAULT false (dark) — TS remains the sole active reader until Federico flips this at canary,
// mirroring the C# side's own `Platform:ExternalVendorReadEnabled` flag (which independently
// gates whether the C# routes are even mapped — if the two flags are ever out of lockstep with
// this one on but that one off, the proxied request 404s).
const EXTERNAL_VENDOR_READ_VIA_CSHARP = process.env.EXTERNAL_VENDOR_READ_VIA_CSHARP === 'true';

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

// Audit one exported psychometric record FAIL-CLOSED. Awaited before the row is
// returned, so an audit-write failure aborts the export (TRPCError) — no unlogged
// psychometric data leaves the building.
async function auditExport(row: ExternalResultRow, meta: ExternalAuditMeta): Promise<void> {
  await logDataAccess(
    {
      organizationId: meta.organizationId,
      actorId: meta.apiKeyId,
      entity: 'assessmentResult',
      recordId: row.id,
      action: 'export',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
    { failClosed: true },
  );
}

export const externalAssessmentService = {
  async list(
    access: AccessContext,
    meta: ExternalAuditMeta,
    take: number,
    cursor: string | undefined,
    authorizationHeader: string,
  ): Promise<{ items: ExternalAssessmentResultV1[]; nextCursor?: string }> {
    if (isPlatformApiEnabled() && EXTERNAL_VENDOR_READ_VIA_CSHARP) {
      // The C# use case writes its OWN fail-closed audit row per exported item (mirroring
      // auditExport below) — do NOT also audit here, or every export would be double-logged.
      const { status, body } = await platformGetWithAuth('/external/assessment-results', authorizationHeader, {
        take,
        cursor,
      });
      if (status !== 200) throw mapProxyError(status);
      const raw = body as { items: RawExternalAssessmentResultV1[]; nextCursor: string | null };
      return { items: raw.items.map(mapRawResultV1), nextCursor: raw.nextCursor ?? undefined };
    }

    const { rows, nextCursor } = await listExternalResults(access, meta.organizationId, meta.apiKeyId, take, cursor);
    // Audit every record fail-closed BEFORE returning any data.
    for (const row of rows) await auditExport(row, meta);
    return { items: rows.map(toExternalAssessmentResultV1), nextCursor };
  },

  async getOne(
    access: AccessContext,
    meta: ExternalAuditMeta,
    assignmentId: string,
    authorizationHeader: string,
  ): Promise<ExternalAssessmentResultV1> {
    if (isPlatformApiEnabled() && EXTERNAL_VENDOR_READ_VIA_CSHARP) {
      // Same no-double-audit rationale as list() above.
      const { status, body } = await platformGetWithAuth(
        `/external/assessment-results/${encodeURIComponent(assignmentId)}`,
        authorizationHeader,
      );
      if (status === 404) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Resultado de evaluacion no encontrado' });
      }
      if (status !== 200) throw mapProxyError(status);
      return mapRawResultV1(body as RawExternalAssessmentResultV1);
    }

    const row = await getExternalResult(access, meta.organizationId, meta.apiKeyId, assignmentId);
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Resultado de evaluacion no encontrado' });
    }
    await auditExport(row, meta);
    return toExternalAssessmentResultV1(row);
  },
};
