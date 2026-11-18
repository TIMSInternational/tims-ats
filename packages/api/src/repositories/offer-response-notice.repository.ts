import { tenantDb } from '@tims/db';

// Data access for the staff "Oferta aceptada / declinada" email (services/offer-response-notice.service.ts).
// Run inside runWithTenant(orgId): it executes after the response, outside the request's own scope.

export const OFFER_NOTICE_ROLE_SLUGS = ['hr_admin', 'super_admin'] as const;

export const offerResponseNoticeRepository = {
  findOffer(organizationId: string, offerId: string) {
    return tenantDb.offer.findFirst({
      where: { id: offerId, organizationId },
      select: {
        createdById: true,
        candidate: { select: { firstName: true, lastName: true } },
        vacancy: { select: { title: true, assignedTo: true, company: { select: { timezone: true } } } },
      },
    });
  },

  findOrganization(organizationId: string) {
    return tenantDb.organization.findFirst({
      where: { id: organizationId },
      select: { name: true, settings: true },
    });
  },

  /** Active staff to tell: HR/super admins, plus the given users (offer creator, hiring manager). */
  async recipientEmails(organizationId: string, directUserIds: string[]): Promise<string[]> {
    const users = await tenantDb.user.findMany({
      where: {
        organizationId,
        isActive: true,
        deletedAt: null,
        OR: [
          { userRoles: { some: { role: { slug: { in: [...OFFER_NOTICE_ROLE_SLUGS] } } } } },
          ...(directUserIds.length > 0 ? [{ id: { in: directUserIds } }] : []),
        ],
      },
      select: { email: true },
    });
    return users.map((user) => user.email);
  },
};
