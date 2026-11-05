// One label map for offer statuses (Pilot UX audit B-02 / B-03): the list badge printed raw "rejected" and
// "converted", and the detail header fell back to "Borrador" for any status it did not know. Every surface
// now reads its label from i18n `offers.status*` through this module. Pure (no React).

import { displayOfferStatus, type OfferStatusSnapshot } from '@tims/shared';

export type OfferStatusLabels = {
  statusDraft: string;
  statusPending: string;
  statusApproved: string;
  statusSent: string;
  statusAccepted: string;
  statusConverted: string;
  statusRejected: string;
  statusDeclined: string;
  statusExpired: string;
  statusWithdrawn: string;
};

const LABEL_KEY: Readonly<Record<string, keyof OfferStatusLabels>> = {
  draft: 'statusDraft',
  pending_approval: 'statusPending',
  approved: 'statusApproved',
  sent: 'statusSent',
  accepted: 'statusAccepted',
  converted: 'statusConverted',
  rejected: 'statusRejected',
  declined: 'statusDeclined',
  expired: 'statusExpired',
  withdrawn: 'statusWithdrawn',
};

/** The label for a status value; an unknown value reads as words, never as `snake_case`. */
export function offerStatusLabel(status: string, labels: OfferStatusLabels): string {
  const key = Object.prototype.hasOwnProperty.call(LABEL_KEY, status) ? LABEL_KEY[status] : undefined;
  return key ? labels[key] : status.replaceAll('_', ' ');
}

/** The label staff should read for an offer (a sent offer past its expiry reads "Expirada"). */
export function offerDisplayLabel(offer: OfferStatusSnapshot, labels: OfferStatusLabels, now?: Date): string {
  return offerStatusLabel(displayOfferStatus(offer, now), labels);
}

/** The status filter options on the offers list, in lifecycle order (B-14). */
export const OFFER_FILTER_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'accepted',
  'converted',
  'rejected',
  'declined',
  'withdrawn',
] as const;

/** Filter value for "Pendientes de mi aprobación" (backed by offer.getPending). */
export const MINE_PENDING_FILTER = 'mine_pending';
