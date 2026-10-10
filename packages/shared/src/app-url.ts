// Canonical public origin for the app, used to build links in outbound email
// (invitations, password resets, auth callbacks). Single source of truth so no
// caller hardcodes a fallback host — least of all one we don't control.
export const DEFAULT_APP_URL = 'https://tims-ats.vercel.app';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Returns a validated public app origin for outbound links. A configured value
 * must be an origin without credentials, path, query, or fragment. Production
 * bearer links require HTTPS except on a loopback host for local `next start`.
 */
export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_APP_URL;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('Invalid public app origin');
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    (url.protocol === 'http:' && process.env.NODE_ENV === 'production' && !LOOPBACK_HOSTS.has(url.hostname)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid public app origin');
  }
  return url.origin;
}
