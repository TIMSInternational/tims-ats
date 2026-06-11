// Canonical public origin for the app, used to build links in outbound email
// (invitations, password resets, auth callbacks). Single source of truth so no
// caller hardcodes a fallback host — least of all one we don't control.
export const DEFAULT_APP_URL = 'https://tims-ats.vercel.app';

/**
 * Returns the public app origin, with any trailing slash removed so
 * `${getAppUrl()}/path` is always well-formed. Prefers NEXT_PUBLIC_APP_URL;
 * falls back to the canonical prod URL when it is unset/blank — never to an
 * unowned domain.
 */
export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_APP_URL;
  return base.replace(/\/+$/, '');
}
