import { sendEmail } from '../lib/ses';
import { emailTemplates } from './email-templates.service';

export const emailService = {
  async sendInterviewInvitation(params: {
    candidateEmail: string;
    candidateName: string;
    vacancyTitle: string;
    companyName: string;
    interviewType: string;
    scheduledAt: Date;
    duration: number;
    location?: string;
    meetingUrl?: string;
    contactEmail: string;
  }): Promise<boolean> {
    const { candidateEmail, ...rest } = params;
    const { subject, html } = emailTemplates.interviewInvitation(rest);
    return sendEmail({ to: candidateEmail, subject, html });
  },

  async sendInterviewReschedule(params: {
    candidateEmail: string;
    candidateName: string;
    vacancyTitle: string;
    companyName: string;
    interviewType: string;
    oldScheduledAt: Date;
    newScheduledAt: Date;
    scheduledAt: Date;
    duration: number;
    location?: string;
    meetingUrl?: string;
    contactEmail: string;
  }): Promise<boolean> {
    const { candidateEmail, ...rest } = params;
    const { subject, html } = emailTemplates.interviewReschedule(rest);
    return sendEmail({ to: candidateEmail, subject, html });
  },

  async sendInterviewCancellation(params: {
    candidateEmail: string;
    candidateName: string;
    vacancyTitle: string;
    companyName: string;
    cancelReason: string;
    contactEmail: string;
  }): Promise<boolean> {
    const { candidateEmail, ...rest } = params;
    const { subject, html } = emailTemplates.interviewCancellation(rest);
    return sendEmail({ to: candidateEmail, subject, html });
  },

  async sendOfferToCandidate(params: {
    candidateEmail: string;
    candidateName: string;
    vacancyTitle: string;
    companyName: string;
    signingUrl: string;
  }): Promise<boolean> {
    const { candidateEmail, ...rest } = params;
    const { subject, html } = emailTemplates.offerSent(rest);
    return sendEmail({ to: candidateEmail, subject, html });
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
