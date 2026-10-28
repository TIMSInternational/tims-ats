import { tenantDb as db } from '@tims/db';
import { candidateConsentRepository } from './candidate-consent.repository';

// Everything the interview invitation/update/cancel emails need, in one
// explicitly-selected, org-filtered read. Never selects the join-token hash.
export const interviewEmailRepository = {
  async findForNotification(orgId: string, interviewId: string) {
    const [interview, org] = await Promise.all([
      db.interview.findFirst({
        where: { id: interviewId, organizationId: orgId },
        select: {
          id: true,
          type: true,
          status: true,
          scheduledAt: true,
          duration: true,
          location: true,
          meetingUrl: true,
          cancelReason: true,
          updatedAt: true,
          candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
          vacancy: { select: { title: true, company: { select: { language: true, timezone: true } } } },
          evaluators: {
            select: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  locale: true,
                  timezone: true,
                  isActive: true,
                },
              },
            },
          },
        },
      }),
      db.organization.findFirst({
        where: { id: orgId },
        select: { name: true, billingEmail: true },
      }),
    ]);
    if (!interview || !org) return null;
    // #312: a candidate who revoked their data-processing authorization gets no further emails
    // (evaluators still do).
    const candidateConsentWithdrawn = await candidateConsentRepository.isRecruitmentConsentWithdrawn(
      orgId,
      interview.candidate.id,
    );
    return { interview, org, candidateConsentWithdrawn };
  },
};

type FoundNotification = NonNullable<Awaited<ReturnType<typeof interviewEmailRepository.findForNotification>>>;
export type InterviewNotificationData = Omit<FoundNotification, 'candidateConsentWithdrawn'> & {
  candidateConsentWithdrawn?: boolean;
};
