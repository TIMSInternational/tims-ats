// Canonical public origin for the app, used to build links in outbound email
// (invitations, password resets, auth callbacks). Single source of truth so no
// caller hardcodes a fallback host — least of all one we don't control — and no
// caller derives an email link from the request Host header or window.location (#50).
export const DEFAULT_APP_URL = 'https://tims-ats.vercel.app';

// Hosts for which plain http is tolerated under NODE_ENV=production off Vercel (#351). Deliberately an
// exact list: the http exception stays narrow even though the loopback REJECTION below is broad.
const HTTP_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True for any hostname that resolves to the local machine, so it must never be the emailed origin on
 * a deployed host (#50). Broader than an exact list, because `new URL()` accepts many spellings of
 * loopback that an exact-match set lets through (tier-1 review): a trailing dot (`localhost.`),
 * the whole 127.0.0.0/8 block (`127.0.0.2`), `*.localhost` (RFC 6761), the unspecified addresses,
 * and IPv4-mapped / IPv4-compatible IPv6 (`[::ffff:127.0.0.1]`, which URL normalises to
 * `[::ffff:7f00:1]`). URL.hostname brackets IPv6; the bare form covers a caller that reports it
 * unbracketed (window.location.hostname does bracket it).
 */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.+$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  const v6 = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
  if (!v6.includes(':')) return false;
  if (v6 === '::1' || v6 === '::') return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d), in dotted or normalised hex form.
  const embedded = /^::(?:ffff:)?(?:(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}|([0-9a-f]{1,4}):[0-9a-f]{1,4})$/.exec(v6);
  if (!embedded) return false;
  if (embedded[1] !== undefined) return embedded[1] === '127' || /^::(?:ffff:)?0\.0\.0\.0$/.test(v6);
  const high = parseInt(embedded[2] ?? '', 16);
  return (high >> 8) === 0x7f || /^::(?:ffff:)?0:0$/.test(v6);
}

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

  const isLoopback = isLoopbackHostname(url.hostname);
  const isProductionBuild = env.NODE_ENV === 'production';
  const deployed = isDeployedVercelEnv(env);
  if (url.protocol === 'http:') {
    if (deployed) return fail('insecure_http');
    if (isProductionBuild && !HTTP_LOOPBACK_HOSTS.has(url.hostname)) return fail('insecure_http');
  }
  if (isLoopback) {
    if (deployed) return fail('loopback_on_deployed_host');
    const served = env.servedFromHost;
    if (isProductionBuild && typeof served === 'string' && served !== '' && !isLoopbackHostname(served)) {
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
 * The origin an auth email redirect is built on. Normally `getAppUrl()`. One exception, and only
 * outside a production build: with NEXT_PUBLIC_APP_URL unset, a BROWSER caller uses the origin the
 * page is served from. getAppUrl()'s development fallback is the prod origin, and a PKCE flow
 * started on localhost cannot complete there — its verifier cookie stays on localhost (#50 tier-1,
 * round 2). getCanonicalAuthFlowUrl() never moves an unset-origin page, so this keeps the flow and
 * the callback on one host. A production build with the value unset still throws `missing`, and
 * server callers (no `location`) are unchanged.
 */
function authFlowOrigin(): string {
  const env = runtimeOriginEnv();
  if (env.NODE_ENV !== 'production' && !process.env.NEXT_PUBLIC_APP_URL?.trim()) {
    const here = (globalThis as { location?: { origin?: unknown } }).location?.origin;
    if (typeof here === 'string' && here !== '') {
      const result = checkAppOrigin(here, env);
      if (result.ok) return result.origin;
    }
  }
  return getAppUrl();
}

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
  const origin = authFlowOrigin();
  const url = new URL(path, `${origin}/`);
  if (url.origin !== origin) throw new AuthRedirectPathError();
  if (params) {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** The parts of `window.location` that `getCanonicalAuthFlowUrl()` reads. */
export type AuthFlowLocation = { origin: string; pathname: string; search: string; hash: string };

/**
 * Browser only, for pages that START an emailed PKCE flow (password reset, sign-up confirmation,
 * portal magic link, invitation recovery). Returns the same path, query and fragment on the
 * configured app origin when the page is being served from a DIFFERENT origin, else null.
 *
 * Why (#50, tier-1 review): the emailed link always lands on the configured origin, but the
 * Supabase browser client stores the PKCE code verifier in a cookie on the host that started the
 * flow. A flow started on a deployment alias or preview host therefore fails at /auth/callback even
 * in the same browser. Moving the user to the configured origin BEFORE the flow starts keeps the
 * verifier and the callback on one host.
 *
 * Returns null (never moves the user) when NEXT_PUBLIC_APP_URL is unset: outside production that
 * means the canonical prod fallback, and bouncing local development to production would be worse
 * than the bug. In a production build an unset value already makes the flow fail closed via
 * getAuthRedirectUrl(). Returns null as well when the origin is invalid, for the same reason.
 * The result is always on the configured origin: the path is assigned, never parsed as a URL, so a
 * page served at `//evil.example/x` cannot turn this into an open redirect.
 */
export function getCanonicalAuthFlowUrl(location: AuthFlowLocation): string | null {
  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) return null;
  let origin: string;
  try {
    origin = getAppUrl();
  } catch {
    return null;
  }
  if (location.origin === origin) return null;
  const url = new URL(`${origin}/`);
  url.pathname = location.pathname || '/';
  url.search = location.search;
  url.hash = location.hash;
  if (url.origin !== origin) return null;
  return url.toString();
}
