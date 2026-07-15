import { tenantDb as db } from '@tims/db';
import {
  assertSubjectInScope,
  logDataAccess,
  selectFor,
  type AccessContext,
} from '../access';

/**
 * Shared field-auth + audited read of ONE employee's compensation.
 *
 * Single source of truth for both `compensation.getEmployeeComp` (HR/leader
 * reading a subject in their scope) and `compensation.myCompensation` (an
 * employee reading their OWN row, subject hard-pinned to the caller). Reusing
 * one helper guarantees BOTH callers get identical §21 guarantees:
 *   • assertSubjectInScope — caller must be authorized for `subjectUserId`
 *     (own scope passes trivially when subject === actor).
 *   • selectFor — currentSalary/currency reach super/hr/hrbp/leader/employee;
 *     compaRatio/variablePay/bandId (+ band bounds) reach only super/hr/hrbp.
 *     Unentitled fields are NEVER selected from the DB, not selected-then-nulled.
 *   • logDataAccess — employeeCompensation is restricted (FULL+AUDIT); every
 *     read is audited BEFORE the DTO is returned (fail-closed).
 *
 * Returns the field-gated DTO, or `null` when the subject has no compensation
 * row (callers decide whether absence is an error or a graceful empty).
 */
export interface CompAuditMeta {
  actorId: string; // ctx.user.impersonatorId ?? ctx.user.id
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface EmployeeCompDto {
  userId: string;
  currency?: string;
  currentSalary?: number;
  variablePay?: number;
  compaRatio?: number | null;
  band?: { level: string | null; title: string | null; min: number; mid: number; max: number; currency: string } | null;
}

export async function getEmployeeCompForSubject(
  access: AccessContext,
  organizationId: string,
  actorUserId: string,
  subjectUserId: string,
  audit: CompAuditMeta,
  notInScopeMessage: string,
): Promise<EmployeeCompDto | null> {
  // Scope gate: the actor must be authorized to view the subject's compensation.
  // For own-scope (subjectUserId === actorUserId) this passes trivially.
  await assertSubjectInScope(access, actorUserId, subjectUserId, notInScopeMessage);

  // §21 field-auth: build the Prisma select from the caller's role entitlements
  // so restricted analytics fields only LEAVE the DB for entitled roles.
  const sel = selectFor(access.roles, 'employeeCompensation');
  const canSeeVariablePay = sel.variablePay === true;
  const canSeeCompaRatio = sel.compaRatio === true;
  const canSeeBand = sel.bandId === true;

  const compensation = await db.employeeCompensation.findFirst({
    where: { userId: subjectUserId, organizationId },
    select: {
      id: true,
      userId: true,
      ...(sel.currentSalary ? { currentSalary: true } : {}),
      ...(sel.currency ? { currency: true } : {}),
      ...(canSeeVariablePay ? { variablePay: true } : {}),
      ...(canSeeCompaRatio ? { compaRatio: true } : {}),
      ...(canSeeBand ? { band: { select: { level: true, title: true, minSalary: true, midSalary: true, maxSalary: true, currency: true } } } : {}),
    },
  });

  // No compensation row → return null (the caller decides how to surface it).
  if (!compensation) return null;

  // §21 matrix: employeeCompensation is FULL+AUDIT (restricted). Audit the read
  // BEFORE returning so a fail-closed audit-write failure aborts pre-serialization.
  await logDataAccess({
    organizationId,
    actorId: audit.actorId,
    entity: 'employeeCompensation',
    recordId: compensation.id,
    action: 'read',
    ipAddress: audit.ipAddress,
    userAgent: audit.userAgent,
  });

  // DTO built ONLY from selected fields — unentitled fields are absent, not nulled.
  return {
    userId: compensation.userId,
    ...(sel.currency ? { currency: compensation.currency } : {}),
    ...(sel.currentSalary ? { currentSalary: Number(compensation.currentSalary) } : {}),
    ...(canSeeVariablePay ? { variablePay: Number(compensation.variablePay) || 0 } : {}),
    ...(canSeeCompaRatio ? { compaRatio: Number(compensation.compaRatio) || null } : {}),
    ...(canSeeBand
      ? {
          band: compensation.band
            ? {
                level: compensation.band.level,
                title: compensation.band.title,
                min: Number(compensation.band.minSalary),
                mid: Number(compensation.band.midSalary),
                max: Number(compensation.band.maxSalary),
                currency: compensation.band.currency,
              }
            : null,
        }
      : {}),
  };
}
