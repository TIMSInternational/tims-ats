import { TRPCError } from '@trpc/server';
import { tenantDb as db } from '@tims/db';

/**
 * Whether the data subject has an ACTIVE consent of the given type. A consent is
 * active iff a row exists with withdrawnAt = null. Withdrawal hides the data
 * (matrix §21 CONSENT ENFORCEMENT). 30-day anonymization of withdrawn subjects is
 * a follow-on job (tracked in REMAINING-WORK), not part of this read-time check.
 */
export async function hasConsent(
  organizationId: string,
  subjectUserId: string,
  consentType: string,
): Promise<boolean> {
  const row = await db.dataConsent.findFirst({
    where: { organizationId, subjectUserId, consentType, withdrawnAt: null },
    select: { id: true },
  });
  return row !== null;
}

/** Throw FORBIDDEN unless the subject has active consent. */
export async function assertConsent(
  organizationId: string,
  subjectUserId: string,
  consentType: string,
): Promise<void> {
  if (!(await hasConsent(organizationId, subjectUserId, consentType))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'El titular de los datos no ha otorgado consentimiento para este acceso',
    });
  }
}
