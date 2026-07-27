import { TRPCError } from '@trpc/server';
import { logDataAccess } from '../access/audit';
import type { ExternalAuditMeta } from './external-assessment.service';
import { getValidationForSubmit, submitValidationResult } from '../repositories/external-validation.repository';
import {
  toExternalValidationResultV1,
  type ExternalValidationSubmitInput,
  type ExternalValidationResultV1,
} from '../dto/external-validation';
import { isPlatformApiEnabled, platformPostWithAuth } from '../lib/platform-api-client';

// Dark per-surface cutover flag (Phase-5 Slice 2) — SERVER-ONLY, same rationale as
// EXTERNAL_VENDOR_READ_VIA_CSHARP in external-assessment.service.ts: this decision is made
// entirely server-side, no browser is ever involved. Mirrors the C# side's own
// `Platform:ExternalVendorWriteEnabled` flag. DEFAULT false (dark).
const EXTERNAL_VENDOR_WRITE_VIA_CSHARP = process.env.EXTERNAL_VENDOR_WRITE_VIA_CSHARP === 'true';

interface RawExternalValidationResultV1 {
  schemaVersion: string;
  id: string;
  status: string;
  completedAt: string;
}

export const externalValidationService = {
  async submitResult(
    meta: ExternalAuditMeta,
    input: ExternalValidationSubmitInput,
    authorizationHeader: string,
  ): Promise<ExternalValidationResultV1> {
    if (isPlatformApiEnabled() && EXTERNAL_VENDOR_WRITE_VIA_CSHARP) {
      // The C# use case writes its OWN fail-soft audit row — do NOT also audit here (mirrors
      // the no-double-audit rule in external-assessment.service.ts's read proxy).
      const { status, body } = await platformPostWithAuth(
        `/external/validations/${encodeURIComponent(input.validationId)}/result`,
        authorizationHeader,
        { status: input.status, result: input.result, notes: input.notes },
      );
      if (status === 404) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Validacion no encontrada' });
      }
      if (status === 409) {
        throw new TRPCError({ code: 'CONFLICT', message: 'La validacion no esta abierta para envio de resultados' });
      }
      if (status !== 200) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'External write via platform service failed' });
      }
      const raw = body as RawExternalValidationResultV1;
      return { schemaVersion: 'v1', id: raw.id, status: raw.status, completedAt: new Date(raw.completedAt) };
    }

    const existing = await getValidationForSubmit(meta.organizationId, input.validationId);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Validacion no encontrada' });
    }
    const { count, completedAt } = await submitValidationResult(
      meta.organizationId,
      input.validationId,
      meta.apiKeyId,
      { status: input.status, result: input.result, notes: input.notes },
    );
    if (count === 0) {
      throw new TRPCError({ code: 'CONFLICT', message: 'La validacion no esta abierta para envio de resultados' });
    }
    // Fail-SOFT: the write is committed and is the source of truth; a lost audit
    // row must not abort a successful vendor submission (unlike a restricted READ).
    await logDataAccess(
      {
        organizationId: meta.organizationId,
        actorId: meta.apiKeyId,
        entity: 'preemploymentValidation',
        recordId: input.validationId,
        action: 'update',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      { failClosed: false },
    );
    return toExternalValidationResultV1({ id: input.validationId, status: input.status, completedAt });
  },
};
