// ---------------------------------------------------------------------------
// Offer lifecycle rules shared by the API and the web app
// ---------------------------------------------------------------------------
// `offers.status` is a free string column; these are the values the app writes:
//   draft → pending_approval → approved → sent → accepted → converted (hired)
//   with the terminal exits rejected (by an approver), declined (by the candidate) and withdrawn (by staff).
// A sent offer whose signing link is past `expiresAt` keeps status 'sent' in the database (nothing rewrites
// it), but it can no longer be accepted, so every surface treats it as expired.

/** Statuses from which staff may withdraw an offer (offer.withdraw). */
export const WITHDRAWABLE_OFFER_STATUSES = ['draft', 'pending_approval', 'approved', 'sent'] as const;

/**
 * Offers that still occupy the candidate's application for a vacancy: while one exists, a second offer for
 * the same candidate and vacancy is refused (offer.create). An expired sent offer does not count.
 */
export const OPEN_OFFER_STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'accepted', 'converted'] as const;

/** Days a signing link stays valid when the offer has no explicit expiry; set at the first send. */
export const OFFER_LINK_VALIDITY_DAYS = 7;

export type OfferStatusSnapshot = { status: string; expiresAt?: Date | string | null };

/** True for a sent offer whose signing link has expired. */
export function isOfferLinkExpired(offer: OfferStatusSnapshot, now: Date = new Date()): boolean {
  if (offer.status !== 'sent' || !offer.expiresAt) return false;
  const expiresAt = new Date(offer.expiresAt);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < now.getTime();
}

/** The status staff should read: a sent offer past its expiry reads 'expired'. */
export function displayOfferStatus(offer: OfferStatusSnapshot, now: Date = new Date()): string {
  return isOfferLinkExpired(offer, now) ? 'expired' : offer.status;
}

/** True while the offer still occupies the application (see OPEN_OFFER_STATUSES). */
export function isOpenOffer(offer: OfferStatusSnapshot, now: Date = new Date()): boolean {
  return (OPEN_OFFER_STATUSES as readonly string[]).includes(offer.status) && !isOfferLinkExpired(offer, now);
}

/** True when staff may still withdraw the offer (an expired sent offer included: its link is dead anyway). */
export function isWithdrawableOffer(offer: OfferStatusSnapshot): boolean {
  return (WITHDRAWABLE_OFFER_STATUSES as readonly string[]).includes(offer.status);
}
