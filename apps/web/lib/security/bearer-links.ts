// Single source of truth for pages whose URL carries a bearer credential. Read by the middleware
// (no-referrer + no-store on those pages) and by the Sentry redactor (lib/sentry-redact.ts), so a new
// bearer-link route is protected in both places by adding it here once.

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
