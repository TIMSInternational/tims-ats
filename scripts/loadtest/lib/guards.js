// Pure safety checks shared by the k6 scenarios. This file uses NO k6 module and NO environment
// access, so tests/loadtest/loadtest-guards.test.ts can import it under vitest and pin the behaviour.
// lib/config.js and the scenario scripts call these with values they read from __ENV.

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Parse and validate a base URL. Returns { url, host }: `url` without trailing slashes, `host` in
 * lower case (an IPv6 literal keeps its brackets, e.g. "[::1]").
 *
 * The authority is parsed strictly. Userinfo ("user:pass@host") is REJECTED: the target-host
 * interlock compares hostnames, and with userinfo a naive parser reads the text before "@" as the
 * host. "http://localhost:1@other-host" would then pass as loopback while k6 connects to
 * other-host.
 */
export function parseBaseUrl(name, raw) {
  const m = /^(https?):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/i.exec(raw);
  if (!m) throw new Error(`${name} is not an http(s) URL: "${raw}"`);
  const authority = m[2];
  if (authority.indexOf('@') !== -1) {
    throw new Error(
      `${name} must not contain userinfo ("user@host"); give the plain origin, e.g. http://localhost:3000`,
    );
  }
  let host;
  let rest;
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close === -1) throw new Error(`${name} has an unterminated IPv6 literal: "${raw}"`);
    host = authority.slice(0, close + 1);
    rest = authority.slice(close + 1);
    if (!/^\[[0-9A-Fa-f:.]+\]$/.test(host)) throw new Error(`${name} has an invalid IPv6 literal: "${raw}"`);
  } else {
    const hm = /^([A-Za-z0-9.-]+)(.*)$/.exec(authority);
    if (!hm) throw new Error(`${name} has an invalid host: "${raw}"`);
    host = hm[1];
    rest = hm[2];
  }
  if (rest !== '' && !/^:\d{1,5}$/.test(rest)) throw new Error(`${name} has an invalid port: "${raw}"`);
  return { url: raw.replace(/\/+$/, ''), host: host.toLowerCase() };
}

export function isLoopback(host) {
  return LOOPBACK_HOSTS.indexOf(host) !== -1;
}

/**
 * The first refusal message for `urls` given the allowlisted hostnames, or undefined when every
 * target is loopback or listed exactly.
 */
export function targetRefusal(urls, allowedHosts) {
  const allowed = allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  for (const url of urls) {
    const { host } = parseBaseUrl('target URL', url);
    if (isLoopback(host)) continue;
    if (allowed.indexOf(host) === -1) {
      return (
        `Refusing to target "${host}": not loopback and not listed in LOADTEST_ALLOW_HOSTS. ` +
        'Read scripts/loadtest/README.md before pointing load at a deployed environment.'
      );
    }
  }
  return undefined;
}

/** Peak VU count of a ramping-vus stage list. */
export function peakVus(stageList) {
  return stageList.reduce((max, s) => Math.max(max, s.target), 0);
}

/**
 * Authenticated scenarios need one synthetic user per VU: the application rate-limits per user
 * (about 100 query calls a minute), and one VU makes roughly 30-60 calls a minute. Sharing one
 * session across VUs measures the limiter, not the system. Returns a refusal message when there
 * are fewer sessions than peak VUs, unless sharing was explicitly allowed.
 */
export function sessionShortfall(sessionCount, vus, allowShared) {
  if (sessionCount >= vus || allowShared) return undefined;
  return (
    `Peak VUS=${vus} but only ${sessionCount} session(s). Each VU needs its own synthetic user, or the ` +
    'per-user rate limit is what gets measured. Put one entry per user in SESSIONS_FILE (at least VUS ' +
    'entries), lower VUS, or set LOADTEST_SHARED_SESSIONS=1 to share sessions knowingly (e.g. against ' +
    'the local mock). See README "Rate limits".'
  );
}

/**
 * One user per VU means one DISTINCT user, not one array entry: five copies of one cookie, or five sessions
 * of one account, share that user's rate-limit budget and measure the limiter (tier-1 review). `subjects`
 * holds each session's user id (JWT `sub`), or undefined when it could not be read. Returns a refusal
 * message, or undefined. Unreadable subjects are refused unless sharing was explicitly allowed.
 */
export function distinctUserShortfall(subjects, vus, allowShared) {
  if (allowShared) return undefined;
  const unknown = subjects.filter((s) => typeof s !== 'string' || s === '').length;
  if (unknown > 0) {
    return (
      `${unknown} session(s) carry no readable user id (JWT sub), so one-user-per-VU cannot be verified. ` +
      'Re-copy the sessions, or set LOADTEST_SHARED_SESSIONS=1 to share knowingly. See README "Rate limits".'
    );
  }
  const distinct = new Set(subjects).size;
  if (distinct >= vus) return undefined;
  return (
    `Peak VUS=${vus} but the sessions belong to only ${distinct} distinct user(s). Each VU needs its OWN ` +
    'synthetic user; duplicated sessions share one per-user rate limit. See README "Rate limits".'
  );
}
