// One offer is addressable by URL (Pilot UX audit B-27): `/recruitment/offers?offer=<id>` opens that
// offer's detail. Used by the offers page and the "Pendientes de mi aprobación" card.
//
// The approver email uses the PATH form `/recruitment/offers/<id>` instead (packages/api
// approval-notification.service builds it server-side): a signed-out approver is sent to
// /login?redirect=<pathname>, so a path survives the sign-in round trip where a query string may not.
// That route only redirects to the query form above.

export const OFFERS_PATH = '/recruitment/offers';
export const OFFER_QUERY_PARAM = 'offer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The offer id carried by the URL, or null when absent or not a UUID (a mangled link shows the list). */
export function readOfferIdParam(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return UUID_RE.test(trimmed) ? trimmed : null;
}

export function offerDetailHref(offerId: string): string {
  return `${OFFERS_PATH}?${OFFER_QUERY_PARAM}=${encodeURIComponent(offerId)}`;
}

/** Path-shaped link to one offer (for links opened from outside the app, e.g. the approver email). */
export function offerLinkPath(offerId: string): string {
  return `${OFFERS_PATH}/${encodeURIComponent(offerId)}`;
}

/** Where the path-shaped link sends the browser: the offer when the id is valid, otherwise the list. */
export function offerLinkTarget(rawId: string | null | undefined): string {
  const offerId = readOfferIdParam(rawId);
  return offerId ? offerDetailHref(offerId) : OFFERS_PATH;
}
