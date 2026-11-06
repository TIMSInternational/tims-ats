import { tenantDb } from '@tims/db';

// Reads behind the tenant bell producers (services/bell-notification.service.ts). Org-scoped, explicit
// selects, active non-deleted recipients only (the notification writer refuses anyone else).

export type BellRecipient = { id: string; locale: string };

export const bellNotificationRepository = {
  /** The interview's candidate name and vacancy title, in this organization. */
  async interviewSummary(organizationId: string, interviewId: string) {
    return tenantDb.interview.findFirst({
      where: { id: interviewId, organizationId },
      select: { candidate: { select: { firstName: true, lastName: true } }, vacancy: { select: { title: true } } },
    });
  },

  /** The active members of this organization among `userIds`, with their locale. */
  async activeMembers(organizationId: string, userIds: readonly string[]): Promise<BellRecipient[]> {
    if (userIds.length === 0) return [];
    return tenantDb.user.findMany({
      where: { id: { in: [...userIds] }, organizationId, isActive: true, deletedAt: null },
      select: { id: true, locale: true },
    });
  },
};
