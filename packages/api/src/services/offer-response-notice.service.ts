import { runWithTenant } from '@tims/db';
import { getAppUrl, logger, orgSettingsTimeZone, resolveInterviewTimeZone } from '@tims/shared';
import { emailService } from './email.service';
import { offerResponseNoticeRepository } from '../repositories/offer-response-notice.repository';

// The staff email sent when a candidate accepts or declines an offer (Pilot UX audit B-18):
//  - it reaches the people who act on it: HR/super admins, the recruiter who created the offer and the
//    vacancy's hiring manager (before, only hr_admin/super_admin users);
//  - it links to the offer, where the next step ("Autorizar contratación") is;
//  - its date is shown in the organization's time zone with an explicit label (E-23), not in the server's.
// Built and sent AFTER the response (runAfterResponse), so it can neither delay nor fail the candidate's
// answer. Never throws; logs carry ids only.

export type OfferResponseNotice = {
  /** Every staff recipient (field name kept from the HR-only notice). */
  hrEmails: string[];
  recipientName: string;
  candidateName: string;
  vacancyTitle: string;
  companyName: string;
  offerUrl: string | null;
  timeZone: string;
};

/** Lower-cased, de-duplicated, non-empty addresses. */
export function uniqueEmails(emails: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const email of emails) {
    const value = email?.trim().toLowerCase();
    if (value) seen.add(value);
  }
  return [...seen];
}

/** Absolute, path-shaped link to one offer (survives the sign-in redirect), or null without an app URL. */
export function offerReviewUrl(offerId: string): string | null {
  try {
    return `${getAppUrl().replace(/\/+$/, '')}/recruitment/offers/${encodeURIComponent(offerId)}`;
  } catch {
    return null;
  }
}

export async function buildOfferResponseNotice(
  organizationId: string,
  offerId: string,
): Promise<OfferResponseNotice | null> {
  const offer = await offerResponseNoticeRepository.findOffer(organizationId, offerId);
  if (!offer) return null;
  const organization = await offerResponseNoticeRepository.findOrganization(organizationId);
  if (!organization) return null;

  const directIds = [offer.createdById, offer.vacancy?.assignedTo].filter((id): id is string => Boolean(id));
  const hrEmails = uniqueEmails(await offerResponseNoticeRepository.recipientEmails(organizationId, directIds));
  if (hrEmails.length === 0) return null;

  return {
    hrEmails,
    recipientName: 'equipo',
    candidateName: `${offer.candidate.firstName} ${offer.candidate.lastName}`,
    vacancyTitle: offer.vacancy?.title ?? '',
    companyName: organization.name,
    offerUrl: offerReviewUrl(offerId),
    timeZone: resolveInterviewTimeZone(orgSettingsTimeZone(organization.settings), offer.vacancy?.company?.timezone),
  };
}

/** Builds and sends the accepted/declined staff email. Runs after the response; never throws. */
export async function sendOfferResponseNotice(
  organizationId: string,
  offerId: string,
  response: { kind: 'accepted' | 'declined'; at: Date },
): Promise<void> {
  const log = { component: 'offer-response-email', offerId, kind: response.kind };
  try {
    const notice = await runWithTenant(organizationId, () => buildOfferResponseNotice(organizationId, offerId));
    if (!notice) {
      logger.warn(log, 'Offer response email skipped: no offer, organization or recipient');
      return;
    }
    const delivered =
      response.kind === 'accepted'
        ? await emailService.notifyOfferAccepted({ ...notice, acceptedAt: response.at })
        : await emailService.notifyOfferDeclined({ ...notice, declinedAt: response.at });
    if (!delivered) logger.warn({ ...log, recipients: notice.hrEmails.length }, 'Offer response email not accepted');
  } catch (error) {
    logger.error({ ...log, errName: error instanceof Error ? error.name : 'unknown' }, 'Offer response email failed');
  }
}
