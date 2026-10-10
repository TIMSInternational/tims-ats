import { TRPCError } from '@trpc/server';
import { candidateConsentRepository } from '../repositories/candidate-consent.repository';

/**
 * #312: no further recruitment processing (AI scoring, CV parsing, assessments, AI interviews, new
 * applications, candidate emails) for a candidate who revoked the data-processing authorization.
 * Error messages are stable codes the web maps to copy: `consent_withdrawn`, or `consent_withdrawn:<n>`
 * for a bulk action (n candidates withdrew).
 */
export const consentGuard = {
  async assertActive(organizationId: string, candidateId: string): Promise<void> {
    if (await candidateConsentRepository.isRecruitmentConsentWithdrawn(organizationId, candidateId)) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'consent_withdrawn' });
    }
  },

  async assertAllActive(organizationId: string, candidateIds: readonly string[]): Promise<void> {
    const withdrawn = await candidateConsentRepository.withdrawnCandidateIds(organizationId, candidateIds);
    if (withdrawn.size > 0) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `consent_withdrawn:${withdrawn.size}` });
    }
  },
};
