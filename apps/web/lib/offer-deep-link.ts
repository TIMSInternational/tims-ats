// One offer is addressable by URL (Pilot UX audit B-27): `/recruitment/offers?offer=<id>` opens that
// offer's detail. Used by the offers page, the "Pendientes de mi aprobación" card and the approver
// email (packages/api approval-notification.service builds the same URL server-side).

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
