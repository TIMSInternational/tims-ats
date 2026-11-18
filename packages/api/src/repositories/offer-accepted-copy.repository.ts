import { tenantDb } from '@tims/db';

// Data access for the candidate's "Oferta aceptada" copy (services/offer-accepted-copy.service.ts). Run inside
// runWithTenant(orgId): it executes after the response. Explicit selects; never the signing token.

export const offerAcceptedCopyRepository = {
  findOffer(organizationId: string, offerId: string) {
    return tenantDb.offer.findFirst({
      where: { id: offerId, organizationId, status: 'accepted' },
      select: {
        salary: true,
        currency: true,
        startDate: true,
        contractType: true,
        respondedAt: true,
        candidate: { select: { firstName: true, lastName: true, email: true } },
        vacancy: { select: { title: true, company: { select: { timezone: true } } } },
      },
    });
  },

  findOrganization(organizationId: string) {
    return tenantDb.organization.findFirst({
      where: { id: organizationId },
      select: { name: true, settings: true, billingEmail: true },
    });
  },
};
