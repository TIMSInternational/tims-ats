import { tenantDb as db } from '@tims/db';

// Everything the "your approval is requested" emails need, in explicitly-selected, org-filtered
// reads. Only active, non-deleted approvers are returned: an email to a deactivated account is noise.

const APPROVER_SELECT = { id: true, email: true, firstName: true, locale: true } as const;

export type ApprovalRecipient = { id: string; email: string; firstName: string; locale: string };

export type ApprovalRequestContext = {
  companyName: string;
  requesterName: string;
  vacancyTitle: string;
  candidateName: string | null;
  approvers: ApprovalRecipient[];
};

async function loadCommon(orgId: string, approverIds: string[], requesterId: string) {
  const [org, requester, approvers] = await Promise.all([
    db.organization.findFirst({ where: { id: orgId }, select: { name: true } }),
    db.user.findFirst({
      where: { id: requesterId, organizationId: orgId },
      select: { firstName: true, lastName: true },
    }),
    db.user.findMany({
      where: { id: { in: approverIds }, organizationId: orgId, isActive: true, deletedAt: null },
      select: APPROVER_SELECT,
    }),
  ]);
  return {
    org,
    requesterName: requester ? `${requester.firstName} ${requester.lastName}`.trim() : '',
    approvers,
  };
}

export const approvalNotificationRepository = {
  async findVacancyRequest(
    orgId: string,
    vacancyId: string,
    approverIds: string[],
    requesterId: string,
  ): Promise<ApprovalRequestContext | null> {
    const [vacancy, common] = await Promise.all([
      db.vacancy.findFirst({
        where: { id: vacancyId, organizationId: orgId, deletedAt: null },
        select: { title: true },
      }),
      loadCommon(orgId, approverIds, requesterId),
    ]);
    if (!vacancy || !common.org) return null;
    return {
      companyName: common.org.name,
      requesterName: common.requesterName,
      vacancyTitle: vacancy.title,
      candidateName: null,
      approvers: common.approvers,
    };
  },

  async findOfferRequest(
    orgId: string,
    offerId: string,
    approverIds: string[],
    requesterId: string,
  ): Promise<ApprovalRequestContext | null> {
    const [offer, common] = await Promise.all([
      db.offer.findFirst({
        where: { id: offerId, organizationId: orgId },
        select: {
          candidate: { select: { firstName: true, lastName: true } },
          vacancy: { select: { title: true } },
        },
      }),
      loadCommon(orgId, approverIds, requesterId),
    ]);
    if (!offer || !common.org) return null;
    return {
      companyName: common.org.name,
      requesterName: common.requesterName,
      vacancyTitle: offer.vacancy?.title ?? '',
      candidateName: `${offer.candidate.firstName} ${offer.candidate.lastName}`.trim(),
      approvers: common.approvers,
    };
  },
};
