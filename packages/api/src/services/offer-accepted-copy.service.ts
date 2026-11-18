import { runWithTenant } from '@tims/db';
import { logger, orgSettingsLocale, orgSettingsTimeZone, resolveInterviewTimeZone } from '@tims/shared';
import { sendEmail } from '../lib/ses';
import { sesOfferCircuit } from '../lib/circuit-breaker';
import { offerAcceptedCopyRepository } from '../repositories/offer-accepted-copy.repository';
import { candidateContactEmail } from './candidate-contact';
import { renderOfferAcceptedCopy } from './offer-accepted-copy-template';

// The candidate's copy of an accepted offer (Pilot UX re-audit C-31), sent AFTER the response next to the staff
// notice (offer-response-notice.service.ts), so it can neither delay nor fail the acceptance. Reply-To is the
// organization's candidate contact (settings.candidateContactEmail, then billing email, else none — never a
// vendor mailbox). Never throws; logs carry ids only.

const SEND_TIMEOUT_MS = 4_000;

export async function sendOfferAcceptedCopy(
  organizationId: string,
  offerId: string,
  acceptance: { at: Date; signatureName: string | null },
): Promise<void> {
  const log = { component: 'offer-accepted-copy', offerId };
  try {
    const loaded = await runWithTenant(organizationId, async () => ({
      offer: await offerAcceptedCopyRepository.findOffer(organizationId, offerId),
      organization: await offerAcceptedCopyRepository.findOrganization(organizationId),
    }));
    const { offer, organization } = loaded;
    const to = offer?.candidate.email?.trim();
    if (!offer || !organization || !to) {
      logger.warn(log, 'Offer accepted copy skipped: no accepted offer, organization or candidate email');
      return;
    }
    const contactEmail = candidateContactEmail(organization);
    const { subject, html } = renderOfferAcceptedCopy({
      candidateName: `${offer.candidate.firstName} ${offer.candidate.lastName}`.trim(),
      vacancyTitle: offer.vacancy?.title ?? '',
      companyName: organization.name,
      annualSalary: offer.salary,
      currency: offer.currency,
      startDate: offer.startDate,
      contractType: offer.contractType,
      signatureName: acceptance.signatureName,
      acceptedAt: offer.respondedAt ?? acceptance.at,
      timeZone: resolveInterviewTimeZone(orgSettingsTimeZone(organization.settings), offer.vacancy?.company?.timezone),
      contactEmail,
      locale: orgSettingsLocale(organization.settings),
    });
    const sent = await sendEmail({
      to,
      subject,
      html,
      abortSignal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      breaker: sesOfferCircuit,
      replyTo: contactEmail,
    });
    if (!sent) logger.warn(log, 'Offer accepted copy not sent');
  } catch (error) {
    logger.error({ ...log, errName: error instanceof Error ? error.name : 'unknown' }, 'Offer accepted copy failed');
  }
}
