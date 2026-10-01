import type es from '../../../../../lib/i18n/es.json';

type ConsentMessages = (typeof es)['candidateConsent'];

/** Translated label of a withdrawal channel (staff channels + the portal's self-service one). */
export function consentChannelLabel(channel: string, m: ConsentMessages): string {
  switch (channel) {
    case 'email':
      return m.channelEmail;
    case 'phone':
      return m.channelPhone;
    case 'in_person':
      return m.channelInPerson;
    case 'letter':
      return m.channelLetter;
    case 'portal':
      return m.channelPortal;
    default:
      return m.channelOther;
  }
}

/** Translated label of a deletion-request status. */
export function deletionStatusLabel(status: string, m: ConsentMessages): string {
  if (status === 'completed') return m.deletionCompleted;
  if (status === 'rejected') return m.deletionRejected;
  return m.deletionPending;
}
