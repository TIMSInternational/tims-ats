import { TRPCError } from '@trpc/server';
import { tenantDb as db } from '@tims/db';
import { dataClassOf, DATA_CLASS_RANK } from './classification';

export interface DataAccessEvent {
  organizationId: string;
  actorId: string; // ctx.user.impersonatorId ?? ctx.user.id
  entity: string; // → data_access_logs.dataType
  recordId: string;
  action: 'read' | 'export' | 'update';
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** confidential + restricted reads must be logged (matrix §21 +AUDIT). */
export function auditRequiredFor(entity: string): boolean {
  return DATA_CLASS_RANK[dataClassOf(entity)] >= DATA_CLASS_RANK.confidential;
}

/**
 * Append a data_access_logs row for a sensitive read/export.
 *
 * Failure policy keyed by data class:
 *   - RESTRICTED (salary, raw psychometrics): fail-CLOSED — if the audit write
 *     fails we THROW, so the caller aborts before returning the data. An
 *     unauditable restricted read must not happen.
 *   - confidential (demographics, survey answers): fail-SOFT — log-and-continue;
 *     losing one audit row is worse than denying access to org analytics.
 *
 * Callers MUST await this BEFORE returning restricted data (so the throw lands
 * before serialization). For confidential reads it may be awaited or fired in
 * parallel with the read.
 *
 * `opts.failClosed` OVERRIDES the data-class-derived policy. This matters for
 * tables that mix data classes per row: `assessmentResult` is `restricted`
 * HEADLINE (raw psychometrics), but a recruiter reading only the CONFIDENTIAL
 * score fields (no breakdown/rawScore) must be audited fail-SOFT — one lost
 * audit row must not abort their bulk read. Only a caller who actually receives
 * the restricted fields warrants fail-CLOSED. Pass `failClosed: true/false`
 * to force the policy; omit it to keep the dataClass-derived default.
 */
export async function logDataAccess(
  event: DataAccessEvent,
  opts?: { failClosed?: boolean },
): Promise<void> {
  const failClosed =
    opts?.failClosed ?? dataClassOf(event.entity) === 'restricted';
  try {
    await db.dataAccessLog.create({
      data: {
        organizationId: event.organizationId,
        actorId: event.actorId,
        dataType: event.entity,
        recordId: event.recordId,
        action: event.action,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ?? null,
      },
    });
  } catch (err) {
    if (failClosed) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'No se pudo registrar el acceso a datos restringidos; acceso abortado',
        cause: err,
      });
    }
    // fail-soft (do not block the read).
  }
}
