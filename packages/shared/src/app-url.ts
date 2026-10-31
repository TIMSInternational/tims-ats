// Canonical public origin for the app, used to build links in outbound email
// (invitations, password resets, auth callbacks). Single source of truth so no
// caller hardcodes a fallback host — least of all one we don't control.
export const DEFAULT_APP_URL = 'https://tims-ats.vercel.app';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type AppOriginIssue =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'credentials'
  | 'path'
  | 'query_or_fragment'
  | 'insecure_http';

// Messages name the variable and the rule but never echo the configured value: the
// value may have been mistyped with a token/query in it, and these surface in logs.
const ISSUE_MESSAGES: Record<AppOriginIssue, string> = {
  invalid_url: 'NEXT_PUBLIC_APP_URL is not a valid absolute URL',
  unsupported_scheme: 'NEXT_PUBLIC_APP_URL must use https (or http only for local development)',
  credentials: 'NEXT_PUBLIC_APP_URL must not contain a username or password',
  path: 'NEXT_PUBLIC_APP_URL must be an origin only (scheme://host[:port]) — remove the path',
  query_or_fragment: 'NEXT_PUBLIC_APP_URL must be an origin only (scheme://host[:port]) — remove the query or fragment',
  insecure_http:
    'NEXT_PUBLIC_APP_URL must use https in production; plain http is allowed only for a loopback host outside Vercel production',
};

export class AppOriginConfigError extends Error {
  readonly issue: AppOriginIssue;
  constructor(issue: AppOriginIssue) {
    super(`Invalid public app origin: ${ISSUE_MESSAGES[issue]}`);
    this.name = 'AppOriginConfigError';
    this.issue = issue;
  }
}

/** The subset of the environment that decides whether plain http is tolerable. */
export type AppOriginEnv = { NODE_ENV?: string; VERCEL_ENV?: string };

export type AppOriginCheck = { ok: true; origin: string } | { ok: false; issue: AppOriginIssue; message: string };

/**
 * Pure validation of a configured app origin. Shared by `getAppUrl()` (runtime, before any
 * bearer link is built) and `apps/web/lib/env.ts` (boot-time env validation) so both enforce
 * one rule:
 *  - trailing slashes are normalised away (`https://host/` -> `https://host`);
 *  - only http/https, no credentials, no path, query or fragment;
 *  - https is mandatory on Vercel production (`VERCEL_ENV=production`) with no exception;
 *  - elsewhere under `NODE_ENV=production` (a local `next start`, CI builds) http is allowed
 *    only for a loopback host — a loopback link never leaves the machine;
 *  - in development/test http is allowed.
 */
export function checkAppOrigin(raw: string, env: AppOriginEnv = process.env): AppOriginCheck {
  const fail = (issue: AppOriginIssue): AppOriginCheck => ({ ok: false, issue, message: ISSUE_MESSAGES[issue] });
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/\/+$/, ''));
  } catch {
    return fail('invalid_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail('unsupported_scheme');
  if (url.username || url.password) return fail('credentials');
  if (url.pathname !== '/') return fail('path');
  if (url.search || url.hash) return fail('query_or_fragment');
  if (url.protocol === 'http:') {
    if (env.VERCEL_ENV === 'production') return fail('insecure_http');
    if (env.NODE_ENV === 'production' && !LOOPBACK_HOSTS.has(url.hostname)) return fail('insecure_http');
  }
  return { ok: true, origin: url.origin };
}

/**
 * Returns a validated public app origin for outbound links (no trailing slash, so
 * `${getAppUrl()}/path` is always well-formed). Prefers NEXT_PUBLIC_APP_URL; falls back to
 * the canonical prod URL when it is unset/blank — never to an unowned domain.
 *
 * Throws `AppOriginConfigError` on a misconfigured value. Callers that persist a bearer
 * token (invitation rows, interview sessions, reminder claims) MUST call this BEFORE the
 * write, so a misconfiguration fails the request cleanly instead of leaving an orphan row.
 */
export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_APP_URL;
  const result = checkAppOrigin(base);
  if (!result.ok) throw new AppOriginConfigError(result.issue);
  return result.origin;
}
