import { tenantDb as db } from '@tims/db';

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
          candidate: { select: { firstName: true, lastName: true, email: true } },
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
    return interview && org ? { interview, org } : null;
  },
};

export type InterviewNotificationData = NonNullable<
  Awaited<ReturnType<typeof interviewEmailRepository.findForNotification>>
>;
