// Canonical public origin for the app, used to build links in outbound email
// (invitations, password resets, auth callbacks). Single source of truth so no
// caller hardcodes a fallback host — least of all one we don't control — and no
// caller derives an email link from the request Host header or window.location (#50).
export const DEFAULT_APP_URL = 'https://tims-ats.vercel.app';

// Hosts for which plain http is tolerated under NODE_ENV=production off Vercel (#351).
const HTTP_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// Hosts that must never be the emailed origin on a deployed host (#50). A superset of the above:
// 0.0.0.0 is not an http exception, but it is never a valid public origin either. URL.hostname
// brackets IPv6 ('[::1]'); the bare form covers a caller that reports it unbracketed.
const LOOPBACK_HOSTS = new Set([...HTTP_LOOPBACK_HOSTS, '0.0.0.0', '::1']);

export type AppOriginIssue =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'credentials'
  | 'path'
  | 'query_or_fragment'
  | 'insecure_http'
  | 'missing'
  | 'loopback_on_deployed_host';

// Messages name the variable and the rule but never echo the configured value: the
// value may have been mistyped with a token/query in it, and these surface in logs.
const ISSUE_MESSAGES: Record<AppOriginIssue, string> = {
  invalid_url: 'NEXT_PUBLIC_APP_URL is not a valid absolute URL',
  unsupported_scheme: 'NEXT_PUBLIC_APP_URL must use https (or http only for local development)',
  credentials: 'NEXT_PUBLIC_APP_URL must not contain a username or password',
  path: 'NEXT_PUBLIC_APP_URL must be an origin only (scheme://host[:port]) — remove the path',
  query_or_fragment: 'NEXT_PUBLIC_APP_URL must be an origin only (scheme://host[:port]) — remove the query or fragment',
  insecure_http:
    'NEXT_PUBLIC_APP_URL must use https in production; plain http is allowed only for a loopback host outside a Vercel deployment',
  missing: 'NEXT_PUBLIC_APP_URL must be set in production: auth and invitation email links are built from it',
  loopback_on_deployed_host:
    'NEXT_PUBLIC_APP_URL must not point at a loopback host on a deployed environment or when the app is served from a real host',
};

export class AppOriginConfigError extends Error {
  readonly issue: AppOriginIssue;
  constructor(issue: AppOriginIssue) {
    super(`Invalid public app origin: ${ISSUE_MESSAGES[issue]}`);
    this.name = 'AppOriginConfigError';
    this.issue = issue;
  }
}

/** Thrown by `getAuthRedirectUrl()` for a path that is not app-relative (a caller bug, not config). */
export class AuthRedirectPathError extends Error {
  constructor() {
    super('Auth redirect path must be app-relative');
    this.name = 'AuthRedirectPathError';
  }
}

/**
 * The subset of the environment that decides which origins are tolerable.
 * - `VERCEL_ENV` is server-only; `NEXT_PUBLIC_VERCEL_ENV` is its client-bundle mirror
 *   (apps/web/next.config.ts sets it; Vercel can also auto-expose it).
 * - `servedFromHost` is the hostname the current page was served from (browser only).
 *   It is used ONLY to validate the configured origin, never to build a link.
 */
export type AppOriginEnv = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  NEXT_PUBLIC_VERCEL_ENV?: string;
  servedFromHost?: string;
};

export type AppOriginCheck = { ok: true; origin: string } | { ok: false; issue: AppOriginIssue; message: string };

function isDeployedVercelEnv(env: AppOriginEnv): boolean {
  const vercelEnv = env.VERCEL_ENV || env.NEXT_PUBLIC_VERCEL_ENV;
  return vercelEnv === 'production' || vercelEnv === 'preview';
}

/**
 * Pure validation of a configured app origin. Shared by `getAppUrl()` (runtime, before any
 * bearer or auth-email link is built) and `apps/web/lib/env.ts` (boot-time env validation) so
 * both enforce one rule:
 *  - trailing slashes are normalised away (`https://host/` -> `https://host`);
 *  - only http/https, no credentials, no path, query or fragment;
 *  - on a Vercel deployment (production or preview) https is mandatory with no exception, and a
 *    loopback host is rejected (#50: reset emails pointing at localhost);
 *  - elsewhere under `NODE_ENV=production` (a local `next start`, CI builds) http is allowed
 *    only for a loopback host — a loopback link never leaves the machine — and a loopback
 *    origin is rejected when the page itself was served from a real (non-loopback) host, so the
 *    #50 guard holds in a browser bundle even when no VERCEL_ENV value reached it;
 *  - in development/test http is allowed.
 * An unset value is not judged here (see `getAppUrl()`).
 */
export function checkAppOrigin(
  raw: string,
  env: AppOriginEnv = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  },
): AppOriginCheck {
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

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  const isProductionBuild = env.NODE_ENV === 'production';
  const deployed = isDeployedVercelEnv(env);
  if (url.protocol === 'http:') {
    if (deployed) return fail('insecure_http');
    if (isProductionBuild && !HTTP_LOOPBACK_HOSTS.has(url.hostname)) return fail('insecure_http');
  }
  if (isLoopback) {
    if (deployed) return fail('loopback_on_deployed_host');
    const served = env.servedFromHost;
    if (isProductionBuild && typeof served === 'string' && served !== '' && !LOOPBACK_HOSTS.has(served)) {
      return fail('loopback_on_deployed_host');
    }
  }
  return { ok: true, origin: url.origin };
}

// Browser only: the hostname the current page was served from, or undefined on the server.
function servedFromHost(): string | undefined {
  const location = (globalThis as { location?: { hostname?: unknown } }).location;
  const hostname = location?.hostname;
  return typeof hostname === 'string' && hostname !== '' ? hostname : undefined;
}

// Literal `process.env.X` reads so Next.js inlines NODE_ENV and the NEXT_PUBLIC_* values into
// client bundles. Passing `process.env` itself (dynamic access) is NOT inlined, so in a browser
// every rule keyed on NODE_ENV/VERCEL_ENV would silently switch off.
function runtimeOriginEnv(): AppOriginEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    servedFromHost: servedFromHost(),
  };
}

/**
 * Returns a validated public app origin for outbound links (no trailing slash, so
 * `${getAppUrl()}/path` is always well-formed).
 *
 * - NEXT_PUBLIC_APP_URL set: validated by `checkAppOrigin()`.
 * - Unset/blank in a production build: throws (`missing`) — an email link silently built
 *   against a guessed host is exactly the #50 bug.
 * - Unset/blank in development/test: falls back to the canonical prod URL — never to an
 *   unowned domain, and never to the request Host header.
 *
 * Throws `AppOriginConfigError`. Callers that persist a bearer token (invitation rows,
 * interview sessions, reminder claims) MUST call this BEFORE the write, so a misconfiguration
 * fails the request cleanly instead of leaving an orphan row.
 */
export function getAppUrl(): string {
  const env = runtimeOriginEnv();
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) {
    if (env.NODE_ENV === 'production') throw new AppOriginConfigError('missing');
    return DEFAULT_APP_URL;
  }
  const result = checkAppOrigin(raw, env);
  if (!result.ok) throw new AppOriginConfigError(result.issue);
  return result.origin;
}

// C0 control characters and DEL. WHATWG URL parsing strips ASCII tab/LF/CR anywhere in the input
// (so '/\t/evil.example' parses as '//evil.example'), and trims other leading/trailing C0 controls.
// No legitimate app path contains one.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Absolute URL on the configured app origin for an auth email redirect (`redirectTo` /
 * `emailRedirectTo`). `path` must be an app-relative path ("/auth/callback"). Rejected with
 * `AuthRedirectPathError`: protocol-relative or absolute inputs, backslashes, and control
 * characters; and, as a final check that does not depend on enumerating parser quirks, any
 * result whose origin is not the configured app origin.
 */
export function getAuthRedirectUrl(path: string, params?: Record<string, string>): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || CONTROL_CHARS.test(path)) {
    throw new AuthRedirectPathError();
  }
  const origin = getAppUrl();
  const url = new URL(path, `${origin}/`);
  if (url.origin !== origin) throw new AuthRedirectPathError();
  if (params) {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }
  return url.toString();
}
