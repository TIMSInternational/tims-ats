import { TRPCError } from '@trpc/server';
import type { AccessContext } from '../access/types';
import { logDataAccess } from '../access/audit';
import {
  listExternalResults,
  getExternalResult,
} from '../repositories/external-assessment.repository';
import {
  toExternalAssessmentResultV1,
  type ExternalAssessmentResultV1,
  type ExternalResultRow,
} from '../dto/external-assessment';

export interface ExternalAuditMeta {
  organizationId: string;
  apiKeyId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
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
    cursor?: string,
  ): Promise<{ items: ExternalAssessmentResultV1[]; nextCursor?: string }> {
    const { rows, nextCursor } = await listExternalResults(access, meta.organizationId, meta.apiKeyId, take, cursor);
    // Audit every record fail-closed BEFORE returning any data.
    for (const row of rows) await auditExport(row, meta);
    return { items: rows.map(toExternalAssessmentResultV1), nextCursor };
  },

  async getOne(
    access: AccessContext,
    meta: ExternalAuditMeta,
    assignmentId: string,
  ): Promise<ExternalAssessmentResultV1> {
    const row = await getExternalResult(access, meta.organizationId, meta.apiKeyId, assignmentId);
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Resultado de evaluacion no encontrado' });
    }
    await auditExport(row, meta);
    return toExternalAssessmentResultV1(row);
  },
};
