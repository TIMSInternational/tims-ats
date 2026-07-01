/**
 * Offer DTO redaction.
 *
 * The candidate signing token is stored inside the Offer `settings` JSON (so the
 * public token→offer lookup in signing.ts can find it). Staff-facing offer reads
 * return the full row, which would leak that bearer token to any `offer:read`
 * user — who could then forge the candidate's acceptance/decline. Strip
 * `signingToken` from `settings` before returning an offer to staff, while
 * preserving the other legitimate settings (e.g. signatureName, acceptedAt).
 */
export function redactOfferSettings<T extends { settings?: unknown }>(offer: T): T;
export function redactOfferSettings<T extends { settings?: unknown }>(offer: T | null): T | null;
export function redactOfferSettings<T extends { settings?: unknown }>(offer: T | null): T | null {
  if (!offer) return offer;
  const { settings } = offer;
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const { signingToken: _omit, ...rest } = settings as Record<string, unknown>;
    return { ...offer, settings: rest };
  }
  return offer;
}
