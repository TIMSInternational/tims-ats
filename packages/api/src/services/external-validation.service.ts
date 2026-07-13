import { TRPCError } from '@trpc/server';
import { logDataAccess } from '../access/audit';
import type { ExternalAuditMeta } from './external-assessment.service';
import { getValidationForSubmit, submitValidationResult } from '../repositories/external-validation.repository';
import {
  toExternalValidationResultV1,
  type ExternalValidationSubmitInput,
  type ExternalValidationResultV1,
} from '../dto/external-validation';

export const externalValidationService = {
  async submitResult(meta: ExternalAuditMeta, input: ExternalValidationSubmitInput): Promise<ExternalValidationResultV1> {
    const existing = await getValidationForSubmit(meta.organizationId, input.validationId);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Validacion no encontrada' });
    }
    const { count, completedAt } = await submitValidationResult(
      meta.organizationId, input.validationId, meta.apiKeyId,
      { status: input.status, result: input.result, notes: input.notes },
    );
    if (count === 0) {
      throw new TRPCError({ code: 'CONFLICT', message: 'La validacion no esta abierta para envio de resultados' });
    }
    // Fail-SOFT: the write is committed and is the source of truth; a lost audit
    // row must not abort a successful vendor submission (unlike a restricted READ).
    await logDataAccess(
      { organizationId: meta.organizationId, actorId: meta.apiKeyId, entity: 'preemploymentValidation', recordId: input.validationId, action: 'update', ipAddress: meta.ipAddress, userAgent: meta.userAgent },
      { failClosed: false },
    );
    return toExternalValidationResultV1({ id: input.validationId, status: input.status, completedAt });
  },
};
