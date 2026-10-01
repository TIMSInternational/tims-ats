import { db } from '@tims/db';
import { APPLICATION_CONSENT_TYPE } from '@tims/shared';

// Recruitment data-processing consent status (#312). A candidate who revoked the authorization
// (staff-recorded or self-service, both written by the C# consent surface) must receive no further
// processing emails. The privileged client with an EXPLICIT organization filter, not tenantDb: a
// suppression check must not silently read "not withdrawn" because a caller ran outside a tenant
// context (tenantDb with an unset org GUC sees no rows — it would fail OPEN here).
export const candidateConsentRepository = {
  async isRecruitmentConsentWithdrawn(organizationId: string, candidateId: string): Promise<boolean> {
    const row = await db.dataConsent.findFirst({
      where: {
        organizationId,
        subjectUserId: candidateId,
        consentType: APPLICATION_CONSENT_TYPE,
        withdrawnAt: { not: null },
      },
      select: { id: true },
    });
    return row !== null;
  },
};
