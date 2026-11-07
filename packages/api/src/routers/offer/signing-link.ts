import { OFFER_LINK_VALIDITY_DAYS } from '@tims/shared';

// Pure helpers of offer.generateSigningLink (signing.ts), kept apart so that router stays under its size limit.

/** The address a signing token was issued to, compared on re-send (see generateSigningLink). */
export function normaliseRecipient(email: string): string {
  return email.trim().toLowerCase();
}

/** The expiry a first send stamps on an offer that has none (B-04: an emailed link used to live forever). */
export function defaultSigningExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OFFER_LINK_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
}
