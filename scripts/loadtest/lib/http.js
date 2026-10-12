// Read-only HTTP helpers for the k6 scenarios.
//
// READ-ONLY BY CONSTRUCTION: this module exposes GET only, and the scenarios import nothing else
// from k6/http. tests/loadtest/loadtest-read-only.test.ts fails the build if any file under
// scripts/loadtest/ calls a write verb (post/put/patch/del/request/batch) or names a write surface
// (public apply, Turnstile, mutations).

import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import encoding from 'k6/encoding';
import exec from 'k6/execution';
import { env } from './config.js';

/** Fraction of requests that failed for a reason other than rate limiting. */
export const errors = new Rate('tims_errors');
/** Fraction of requests answered 429 / TOO_MANY_REQUESTS. Non-zero means you measured the limiter. */
export const rateLimited = new Rate('tims_rate_limited');

const USER_AGENT = 'tims-loadtest/k6 (read-only; scripts/loadtest)';

// ---------------------------------------------------------------------------
// Sessions (pre-issued; this suite never logs in)
// ---------------------------------------------------------------------------

/**
 * Load pre-issued sessions. Call from the INIT context only (k6 `open()` is init-only).
 *  - SESSIONS_FILE: path to a JSON array of { "cookie": "...", "accessToken": "..." } — one entry per
 *    synthetic user; VUs are spread round-robin. Keep this file OUTSIDE the repository.
 *  - otherwise SESSION_COOKIE and/or ACCESS_TOKEN for a single synthetic user.
 * When only the cookie is given, the access token is read out of the Supabase session cookie.
 */
export function loadSessions(need) {
  let sessions;
  const file = env('SESSIONS_FILE', undefined);
  if (file) {
    let parsed;
    try {
      parsed = JSON.parse(open(file));
    } catch (e) {
      throw new Error(`SESSIONS_FILE could not be read as JSON: ${e.message}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('SESSIONS_FILE must be a non-empty JSON array');
    sessions = parsed.map((s, i) => {
      if (!s || typeof s !== 'object') throw new Error(`SESSIONS_FILE entry ${i} is not an object`);
      return { cookie: s.cookie || undefined, accessToken: s.accessToken || undefined };
    });
  } else {
    sessions = [{ cookie: env('SESSION_COOKIE', undefined), accessToken: env('ACCESS_TOKEN', undefined) }];
  }
  sessions.forEach((s, i) => {
    // The access token is inside the session cookie: derive it so the owner copies ONE value.
    if (!s.accessToken && s.cookie) {
      const fromCookie = decodeCookieSession(s.cookie);
      if (fromCookie && typeof fromCookie.access_token === 'string') s.accessToken = fromCookie.access_token;
    }
    if (need.cookie && !s.cookie)
      throw new Error(`Session ${i}: a Supabase session cookie is required (SESSION_COOKIE or SESSIONS_FILE[].cookie)`);
    if (need.accessToken && !s.accessToken)
      throw new Error(
        `Session ${i}: an access token is required (ACCESS_TOKEN, SESSIONS_FILE[].accessToken, or a SESSION_COOKIE ` +
          'containing the Supabase auth cookie)',
      );
    if (s.accessToken && !/^[A-Za-z0-9._~-]+$/.test(s.accessToken))
      throw new Error(`Session ${i}: access token has unexpected characters`);
  });
  return sessions;
}

/** The session this VU uses (round-robin by VU id, stable for the VU's lifetime). */
export function sessionForVu(sessions) {
  return sessions[(exec.vu.idInTest - 1) % sessions.length];
}

function decodeJwtExp(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(encoding.b64decode(parts[1], 'rawurl', 's'));
    return typeof payload.exp === 'number' ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort decode of the Supabase SSR session cookie (`sb-<ref>-auth-token`, possibly chunked as
 * `.0`, `.1`, ... and `base64-`-prefixed) out of a full Cookie header. Returns the session object
 * ({ access_token, expires_at, ... }) or undefined.
 */
function decodeCookieSession(cookie) {
  const chunks = [];
  for (const pair of cookie.split(';')) {
    const m = pair.trim().match(/^sb-[A-Za-z0-9]+-auth-token(?:\.(\d+))?=(.*)$/);
    if (m) chunks.push({ idx: m[1] === undefined ? 0 : Number(m[1]), value: m[2] });
  }
  if (chunks.length === 0) return undefined;
  chunks.sort((a, b) => a.idx - b.idx);
  let raw = chunks.map((c) => c.value).join('');
  try {
    raw = decodeURIComponent(raw);
    if (raw.startsWith('base64-')) raw = encoding.b64decode(raw.slice('base64-'.length), 'rawurl', 's');
    const session = JSON.parse(raw);
    return session && typeof session === 'object' ? session : undefined;
  } catch {
    return undefined;
  }
}

/** Expiry (unix seconds) of the session inside a Cookie header, if decodable. */
function decodeCookieExp(cookie) {
  const session = decodeCookieSession(cookie);
  if (!session) return undefined;
  if (typeof session.expires_at === 'number') return session.expires_at;
  if (typeof session.access_token === 'string') return decodeJwtExp(session.access_token);
  return undefined;
}

/**
 * Refuse to start if any session expires before the run ends (plus a margin). An expired access
 * token makes the auth middleware attempt a refresh-token rotation; many VUs doing that with the
 * SAME refresh token is exactly what refresh-token reuse detection revokes. Never let it get there.
 */
export function assertSessionsOutlastRun(sessions, runSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const margin = 120;
  sessions.forEach((s, i) => {
    const exps = [];
    if (s.accessToken) exps.push(decodeJwtExp(s.accessToken));
    if (s.cookie) exps.push(decodeCookieExp(s.cookie));
    const known = exps.filter((e) => typeof e === 'number');
    if (known.length === 0) {
      if (env('ALLOW_UNKNOWN_EXPIRY', '') === '1') return;
      throw new Error(
        `Session ${i}: cannot determine token expiry. Re-copy a fresh session, or set ALLOW_UNKNOWN_EXPIRY=1 ` +
          'only if you have confirmed the session outlives the run.',
      );
    }
    const exp = Math.min(...known);
    if (exp - now < runSeconds + margin) {
      throw new Error(
        `Session ${i} expires in ${exp - now}s but the run needs ${runSeconds}s + ${margin}s margin. ` +
          'Issue a fresh session immediately before running (see README).',
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function record(res, rateLimitedHit, ok) {
  rateLimited.add(rateLimitedHit);
  errors.add(!rateLimitedHit && !ok);
}

function headersFor(session, extra) {
  const h = Object.assign({ 'user-agent': USER_AGENT }, extra || {});
  if (session && session.cookie) h.cookie = session.cookie;
  return h;
}

/** GET a server-rendered page. */
export function getPage(url, name, session) {
  const params = { headers: headersFor(session, { accept: 'text/html' }), tags: { name, kind: 'page' } };
  // Authenticated requests carry the session cookie explicitly; a fresh jar per request stops a
  // refreshed Set-Cookie from leaking into later requests of this VU.
  if (session && session.cookie) {
    params.jar = new http.CookieJar();
    // A dead session redirects to /login, which would otherwise be followed and scored as a 200.
    params.redirects = 0;
  }
  const res = http.get(url, params);
  const isRateLimited = res.status === 429;
  const ok = check(res, {
    [`${name}: status 200`]: (r) => r.status === 200,
    [`${name}: html body`]: (r) => typeof r.body === 'string' && r.body.indexOf('<html') !== -1,
  });
  record(res, isRateLimited, ok);
  return res;
}

/**
 * tRPC httpBatchLink-compatible GET of one or more QUERY procedures in a single request, exactly as
 * the browser sends them (superjson envelope). Returns the per-call `json` data (or undefined).
 * `calls` = [{ path: 'portal.listVacancies', input: {...} | undefined }]
 */
export function trpcQuery(webBase, calls, name, session) {
  const paths = calls.map((c) => c.path).join(',');
  const input = {};
  calls.forEach((c, i) => {
    if (c.input !== undefined) input[String(i)] = { json: c.input };
  });
  const url = `${webBase}/api/trpc/${paths}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
  const params = {
    headers: headersFor(session, { accept: 'application/json', 'content-type': 'application/json' }),
    tags: { name, kind: 'api' },
  };
  if (session && session.cookie) params.jar = new http.CookieJar();
  const res = http.get(url, params);

  let body;
  try {
    body = res.json();
  } catch {
    body = undefined;
  }
  const items = Array.isArray(body) ? body : [];
  const itemErrors = items.filter((it) => it && it.error);
  const isRateLimited =
    res.status === 429 ||
    itemErrors.some((it) => {
      const e = it.error && it.error.json;
      return e && e.data && (e.data.code === 'TOO_MANY_REQUESTS' || e.data.httpStatus === 429);
    });
  const ok = check(res, {
    [`${name}: status 200`]: (r) => r.status === 200,
    [`${name}: ${calls.length} result(s), no tRPC error`]: () =>
      items.length === calls.length && itemErrors.length === 0,
  });
  record(res, isRateLimited, ok);
  return items.map((it) => (it && it.result && it.result.data ? it.result.data.json : undefined));
}

/** GET a C# Platform API read endpoint with the session's bearer token. */
export function platformGet(platformBase, path, name, session) {
  const params = {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json',
      authorization: `Bearer ${session.accessToken}`,
    },
    tags: { name, kind: 'api' },
    jar: new http.CookieJar(),
  };
  const res = http.get(`${platformBase}${path}`, params);
  const ok = check(res, {
    [`${name}: status 200`]: (r) => r.status === 200,
    [`${name}: json body`]: (r) => {
      try {
        r.json();
        return true;
      } catch {
        return false;
      }
    },
  });
  record(res, res.status === 429, ok);
  return res;
}
