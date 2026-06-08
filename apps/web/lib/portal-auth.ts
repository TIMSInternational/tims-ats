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
