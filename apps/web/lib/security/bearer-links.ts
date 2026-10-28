// Pages whose URL carries a bearer credential, as data for the Sentry redactor (lib/sentry-redact.ts).
// Mirrors `isBearerLinkPathname` in middleware.ts (no-referrer + no-store on those pages); a parity test
// (tests/security/csp-and-public-routes.test.ts) drives the REAL middleware with every route listed here,
// so adding a bearer-link route to one side without the other turns CI red.

/** Routes whose FIRST path segment after the prefix is the credential: `/offers/sign/<token>`. */
export const BEARER_TOKEN_PATH_PREFIXES = ['/offers/sign/', '/interview/join/', '/ai-interview/'] as const;

/** Routes that carry the credential in the query string (`?token=` / `?code=`). */
export const BEARER_QUERY_PATHS = ['/accept-invitation', '/reset-password'] as const;

/**
 * Query-parameter names whose values are credentials wherever they appear: link tokens, the Supabase auth
 * code / token hash / session tokens, the invitation token carried through the password-setup redirect
 * (`/reset-password?recovery=…&invitation=…`) and the one-time recovery / password-setup proofs.
 */
export const BEARER_QUERY_PARAMS = [
  'token',
  'code',
  'token_hash',
  'access_token',
  'refresh_token',
  'invitation',
  'recovery',
  'nonce',
] as const;

export function isBearerLinkPathname(pathname: string): boolean {
  return (
    (BEARER_QUERY_PATHS as readonly string[]).includes(pathname) ||
    BEARER_TOKEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
