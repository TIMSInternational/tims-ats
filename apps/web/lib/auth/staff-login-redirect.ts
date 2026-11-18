// Pure helpers for the staff sign-in round trip: where a signed-out request goes (/login), what it
// carries there (the page to return to, and whether the session had expired), and which return targets
// are safe to follow afterwards. No React / next imports so the repo-root vitest harness can test it.

const DUMMY_ORIGIN = 'https://staff.invalid';
const MAX_REDIRECT_LENGTH = 2048;

// Returning to one of these after signing in would loop or re-open a one-time link.
const NON_RETURNABLE_PREFIXES = ['/login', '/logout', '/register', '/forgot-password', '/reset-password', '/auth'];

/**
 * A same-origin path (+ query) that is safe to navigate to after sign-in, or null.
 * Rejects absolute and protocol-relative URLs, backslashes (browsers read `/\host` as `//host`),
 * control characters, over-long values, and the auth pages themselves. The NORMALISED path is
 * returned and re-checked, so dot segments cannot turn `/.//host` into `//host`.
 */
export function safeStaffRedirectPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_REDIRECT_LENGTH) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, DUMMY_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== DUMMY_ORIGIN || url.pathname.startsWith('//')) return null;
  if (NON_RETURNABLE_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return null;
  return `${url.pathname}${url.search}`;
}

/** True when the request carried a Supabase session cookie (`sb-<ref>-auth-token`, possibly chunked
 *  as `.0`, `.1`, …). Read BEFORE the session refresh, which blanks the cookie when it fails. The PKCE
 *  `-code-verifier` cookie is not a session and does not count. */
export function hasSupabaseSessionCookie(cookies: ReadonlyArray<{ name: string; value: string }>): boolean {
  return cookies.some((c) => /^sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?$/.test(c.name) && c.value.length > 0);
}

/** The /login URL for a signed-out request to a protected staff page: keeps the full path AND query
 *  so the user lands back where they were, and flags `reason=expired` when a session cookie was
 *  present but no longer valid (the login page then says the session expired). */
export function staffLoginUrl(requestUrl: string, pathWithQuery: string, sessionExpired: boolean): URL {
  const loginUrl = new URL('/login', requestUrl);
  const target = safeStaffRedirectPath(pathWithQuery);
  if (target) loginUrl.searchParams.set('redirect', target);
  if (sessionExpired) loginUrl.searchParams.set('reason', 'expired');
  return loginUrl;
}
