import { sendEmail } from '../lib/ses';
import { emailTemplates } from './email-templates.service';

/**
 * Offer emails are awaited inside offer.generateSigningLink (#322): without a bound, a hung SES call
 * would hold the mutation until the function times out, after the link is already active. An abort
 * makes sendEmail return false, which the UI reports as "delivery unconfirmed".
 */
export const OFFER_EMAIL_SEND_TIMEOUT_MS = 4_000;

export const emailService = {
  async sendAssessmentReminder(params: {
    candidateEmail: string;
    candidateName: string;
    assessmentName: string;
    companyName: string;
    assessmentUrl: string;
    expiresAt: Date | null;
  }): Promise<boolean> {
    const { candidateEmail, ...rest } = params;
    const { subject, html } = emailTemplates.assessmentReminder(rest);
    return sendEmail({ to: candidateEmail, subject, html, abortSignal: AbortSignal.timeout(4_000) });
  },

  // Interview invitation / reschedule / cancellation mail now lives in
  // interview-email.service.ts (join link + .ics for candidate AND evaluators).

  async sendApplicationReceived(params: {
    candidateEmail: string;
    candidateName: string;
    vacancyTitle: string;
    companyName: string;
    locale: 'es' | 'en';
  }): Promise<boolean> {
    const { candidateEmail, ...rest } = params;
    const { subject, html } = emailTemplates.applicationReceived(rest);
    return sendEmail({ to: candidateEmail, subject, html, abortSignal: AbortSignal.timeout(4_000) });
  },

  async sendOfferToCandidate(params: {
    candidateEmail: string;
    candidateName: string;
    vacancyTitle: string;
    companyName: string;
    signingUrl: string;
    expiresAt: Date | null;
  }): Promise<boolean> {
    const { candidateEmail, ...rest } = params;
    const { subject, html } = emailTemplates.offerSent(rest);
    return sendEmail({ to: candidateEmail, subject, html, abortSignal: AbortSignal.timeout(OFFER_EMAIL_SEND_TIMEOUT_MS) });
  },

  async notifyOfferAccepted(params: {
    hrEmails: string[];
    recipientName: string;
    candidateName: string;
    vacancyTitle: string;
    companyName: string;
    acceptedAt: Date;
  }): Promise<boolean> {
    const { hrEmails, ...rest } = params;
    const { subject, html } = emailTemplates.offerAcceptedNotification(rest);
    return sendEmail({ to: hrEmails, subject, html });
  },

  async notifyOfferDeclined(params: {
    hrEmails: string[];
    recipientName: string;
    candidateName: string;
    vacancyTitle: string;
    companyName: string;
    declinedAt: Date;
  }): Promise<boolean> {
    const { hrEmails, ...rest } = params;
    const { subject, html } = emailTemplates.offerDeclinedNotification(rest);
    return sendEmail({ to: hrEmails, subject, html });
  },
};
