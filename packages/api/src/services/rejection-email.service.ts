// ---------------------------------------------------------------------------
// Opt-in rejection notice delivery (C-11)
// ---------------------------------------------------------------------------
// Sent only when the recruiter ticks "Notificar al candidato" in the reject modal (default OFF), after the
// response (lib/after-response.ts). Never throws; logs carry no PII (no email, no name, no candidate id).
// The candidate copy replies to the organization's own candidate contact (services/candidate-contact.ts)
// — never to a vendor mailbox.

import { logger } from '@tims/shared';
import { sendEmail } from '../lib/ses';
import { rejectionEmailRepository } from '../repositories/rejection-email.repository';
import { candidateContactEmail } from './candidate-contact';
import { renderRejectionEmail, type RejectionEmailLocale } from './rejection-email-template';

const SEND_TIMEOUT_MS = 8_000;

/** What the reject mutation tells the UI about the requested notice (it is sent after the response). */
export type RejectionNotificationOutcome = 'queued' | 'consent_withdrawn' | 'not_requested' | 'failed';

function toLocale(language: string | null | undefined): RejectionEmailLocale {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export const rejectionEmailService = {
  /**
   * Whether a requested notice will be queued. A candidate who revoked the data-processing authorization
   * gets no further emails (#312), and staff are told so.
   */
  async notificationOutcome(orgId: string, candidateId: string | null): Promise<RejectionNotificationOutcome> {
    if (!candidateId) return 'failed';
    try {
      return (await rejectionEmailRepository.isConsentWithdrawn(orgId, candidateId)) ? 'consent_withdrawn' : 'queued';
    } catch {
      // The rejection already committed; a failed consent read must not fail it. Without proof the candidate
      // may be contacted, nothing is sent.
      logger.warn(
        { component: 'rejection-email', organizationId: orgId },
        'Consent lookup failed — rejection notice not sent',
      );
      return 'failed';
    }
  },

  /** Sends the notice for a rejected application. Returns whether SES accepted it. Never throws. */
  async send(orgId: string, applicationId: string): Promise<boolean> {
    try {
      const data = await rejectionEmailRepository.findForNotification(orgId, applicationId);
      if (!data) return false;
      const { application, org, candidateConsentWithdrawn } = data;
      // Re-checked at send time: only a still-rejected application, a live candidate record with an address,
      // and a candidate who did not revoke the authorization.
      if (
        application.status !== 'rejected' ||
        application.candidate.deletedAt ||
        !application.candidate.email ||
        candidateConsentWithdrawn
      ) {
        logger.info({ component: 'rejection-email', organizationId: orgId }, 'Rejection notice skipped');
        return false;
      }
      const contactEmail = candidateContactEmail(org);
      const { subject, html } = renderRejectionEmail({
        candidateName: application.candidate.firstName,
        vacancyTitle: application.vacancy.title,
        companyName: org.name,
        locale: toLocale(application.vacancy.company?.language),
        contactEmail,
      });
      const sent = await sendEmail({
        to: application.candidate.email,
        subject,
        html,
        abortSignal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        replyTo: contactEmail,
      });
      if (!sent) logger.warn({ component: 'rejection-email', organizationId: orgId }, 'Rejection notice not delivered');
      return sent;
    } catch (error) {
      logger.warn(
        {
          component: 'rejection-email',
          organizationId: orgId,
          errName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Rejection notice failed',
      );
      return false;
    }
  },
};
