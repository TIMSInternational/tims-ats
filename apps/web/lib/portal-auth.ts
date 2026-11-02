// Pure helpers for the candidate (portal) auth flow. No React/next imports so it
// stays unit-testable from the repo-root vitest harness.

// Validate a `next` redirect target from /auth/callback for portal logins. Only a
// same-origin path UNDER /careers/ is allowed, so the value can be safely
// concatenated onto the request origin without enabling an open redirect or an
// escape into the staff app. Returns the path if safe, else null.
export function isSafePortalNext(next: string | null | undefined): string | null {
  if (!next) return null;
  // Reject protocol-relative ("//host"), backslashes, and control chars first.
  if (next.startsWith('//') || /[\\\x00-\x1f]/.test(next)) return null;
  if (!next.startsWith('/careers/')) return null;
  // Normalize against a dummy origin so traversal ("/careers/../dashboard") and any
  // host-injection collapse before we re-check: the result must stay same-origin AND
  // under /careers/. Return the normalized path, never the raw input.
  let url: URL;
  try {
    url = new URL(next, 'https://portal.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://portal.invalid') return null;
  if (!url.pathname.startsWith('/careers/')) return null;
  return url.pathname + url.search;
}

// For a failed portal sign-in: the login page of the portal that `next` points into
// (`/careers/<slug>/login`), or null when `next` is not a safe portal target. The slug is re-validated
// as a single URL-safe segment so nothing else from `next` is carried over.
export function portalLoginPathFor(next: string | null | undefined): string | null {
  const safe = isSafePortalNext(next);
  if (!safe) return null;
  const slug = safe.split('?')[0]!.split('/')[2];
  if (!slug || !/^[A-Za-z0-9_-]{1,100}$/.test(slug)) return null;
  return `/careers/${slug}/login`;
}

// Supabase reports some auth failures (e.g. an expired or already-used magic link: `otp_expired`) only in
// the URL FRAGMENT — `#error=access_denied&error_code=otp_expired&error_description=...` — which never
// reaches the server. True when `hash` (window.location.hash, with or without the leading '#') carries one.
export function hasAuthErrorFragment(hash: string | null | undefined): boolean {
  if (!hash) return false;
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return Boolean(params.get('error') || params.get('error_code'));
}
