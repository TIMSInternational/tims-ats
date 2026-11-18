import { tenantDb as db } from '@tims/db';
import { candidateConsentRepository } from './candidate-consent.repository';

// Everything the opt-in rejection notice (C-11) needs, in one explicitly-selected, org-filtered read.
export const rejectionEmailRepository = {
  async findForNotification(orgId: string, applicationId: string) {
    const [application, org] = await Promise.all([
      db.application.findFirst({
        where: { id: applicationId, organizationId: orgId },
        select: {
          status: true,
          candidate: { select: { id: true, firstName: true, email: true, deletedAt: true } },
          vacancy: { select: { title: true, company: { select: { language: true } } } },
        },
      }),
      db.organization.findFirst({
        where: { id: orgId },
        select: { name: true, billingEmail: true, settings: true },
      }),
    ]);
    if (!application || !org) return null;
    // The notice is in the language the candidate applied in, when known (else the company's).
    const [candidateConsentWithdrawn, candidateLocale] = await Promise.all([
      candidateConsentRepository.isRecruitmentConsentWithdrawn(orgId, application.candidate.id),
      candidateConsentRepository.consentLocale(orgId, { applicationId, candidateId: application.candidate.id }),
    ]);
    return { application, org, candidateConsentWithdrawn, candidateLocale };
  },

  async isConsentWithdrawn(orgId: string, candidateId: string): Promise<boolean> {
    return candidateConsentRepository.isRecruitmentConsentWithdrawn(orgId, candidateId);
  },
};

export type RejectionNotificationData = NonNullable<
  Awaited<ReturnType<typeof rejectionEmailRepository.findForNotification>>
>;
