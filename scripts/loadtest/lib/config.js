// Shared k6 configuration: environment parsing, the target-host safety interlock, load profile
// (ramping-vus stages) and pass/fail thresholds. Every knob is an environment variable so the
// same script runs as a 1-VU smoke on localhost and as a staged ramp against a synthetic tenant.
//
// This file runs inside k6 (goja), not Node: no npm imports, only k6 built-ins.

import exec from 'k6/execution';
import { parseBaseUrl, peakVus, sessionShortfall, targetRefusal } from './guards.js';

/** Read an env var; empty string counts as unset. */
export function env(name, fallback) {
  const value = __ENV[name];
  return value === undefined || value === '' ? fallback : value;
}

export function envInt(name, fallback) {
  const raw = env(name, undefined);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return n;
}

export function envFloat(name, fallback) {
  const raw = env(name, undefined);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

export function requireEnv(name, hint) {
  const value = env(name, undefined);
  if (value === undefined) throw new Error(`${name} is required. ${hint ?? ''}`.trim());
  return value;
}

/** Strip a trailing slash and validate the URL shape (no userinfo; see guards.js). */
export function baseUrl(name, fallback) {
  const raw = env(name, fallback);
  if (raw === undefined) throw new Error(`${name} is required (e.g. http://localhost:3000)`);
  return parseBaseUrl(name, raw).url;
}

/**
 * Safety interlock. Any non-loopback target must be named, exactly, in LOADTEST_ALLOW_HOSTS
 * (comma-separated hostnames). A copy-pasted command therefore cannot silently point load at a
 * host the operator did not explicitly opt into for THIS run. Hosts are parsed strictly
 * (guards.js): a URL with userinfo is refused outright rather than misread as loopback.
 */
export function assertTargetAllowed(urls) {
  const refusal = targetRefusal(urls, env('LOADTEST_ALLOW_HOSTS', '').split(','));
  if (refusal) throw new Error(refusal);
}

/**
 * Authenticated scenarios: refuse to start with fewer pre-issued sessions than peak VUs, unless
 * LOADTEST_SHARED_SESSIONS=1. One user per VU keeps the run under the per-user rate limit.
 */
export function assertSessionsCoverVus(sessionCount, stageList) {
  const refusal = sessionShortfall(sessionCount, peakVus(stageList), env('LOADTEST_SHARED_SESSIONS', '') === '1');
  if (refusal) throw new Error(refusal);
}

/**
 * VU ceiling. Above MAX_VUS_WITHOUT_OVERRIDE the run refuses to start unless LOADTEST_HIGH_LOAD=1,
 * so "start tiny" is the default rather than a convention.
 */
const MAX_VUS_WITHOUT_OVERRIDE = 50;

/**
 * Load profile. PROFILE=smoke (default) is 1 VU for a few seconds — a correctness check, not a
 * load test. PROFILE=ramp ramps to VUS over RAMP, holds for HOLD, ramps down over RAMP_DOWN.
 */
export function stages() {
  const profile = env('PROFILE', 'smoke');
  if (profile !== 'smoke' && profile !== 'ramp') {
    throw new Error(`PROFILE must be "smoke" or "ramp", got "${profile}"`);
  }
  const vus = envInt('VUS', profile === 'smoke' ? 1 : 5);
  if (vus < 1) throw new Error('VUS must be at least 1');
  if (vus > MAX_VUS_WITHOUT_OVERRIDE && env('LOADTEST_HIGH_LOAD', '') !== '1') {
    throw new Error(
      `VUS=${vus} exceeds ${MAX_VUS_WITHOUT_OVERRIDE}. Set LOADTEST_HIGH_LOAD=1 only after a smaller run passed.`,
    );
  }
  if (profile === 'smoke') {
    return [
      { duration: env('RAMP', '5s'), target: vus },
      { duration: env('HOLD', '20s'), target: vus },
      { duration: env('RAMP_DOWN', '5s'), target: 0 },
    ];
  }
  return [
    { duration: env('RAMP', '1m'), target: vus },
    { duration: env('HOLD', '3m'), target: vus },
    { duration: env('RAMP_DOWN', '30s'), target: 0 },
  ];
}

/** Total planned duration of the stages, in seconds (for the token-expiry preflight). */
export function plannedSeconds(stageList) {
  return stageList.reduce((sum, s) => sum + durationSeconds(s.duration), 0);
}

export function durationSeconds(value) {
  const parts = String(value).match(/(\d+(?:\.\d+)?)(ms|s|m|h)/g);
  if (!parts || parts.join('') !== String(value))
    throw new Error(`Unparseable duration "${value}" (use e.g. 30s, 2m, 1h30m)`);
  const unit = { ms: 0.001, s: 1, m: 60, h: 3600 };
  return parts.reduce((sum, p) => {
    const [, n, u] = p.match(/(\d+(?:\.\d+)?)(ms|s|m|h)/);
    return sum + Number(n) * unit[u];
  }, 0);
}

/**
 * Thresholds that fail the run (k6 exits non-zero). Latency targets are per request `kind` tag
 * (`page` = server-rendered HTML, `api` = tRPC / C# JSON) so a slow page does not hide behind a
 * fast API, and vice versa.
 *
 * tims_errors excludes HTTP 429: a rate-limited response is reported separately as
 * tims_rate_limited, because it means the test measured the limiter rather than the system.
 * A burst of real errors aborts the run early (abortOnFail) so a failing target is not hammered.
 */
export function thresholds(kinds) {
  const t = {
    tims_errors: [
      `rate<${envFloat('ERROR_RATE', 0.01)}`,
      { threshold: `rate<${envFloat('ABORT_ERROR_RATE', 0.1)}`, abortOnFail: true, delayAbortEval: '30s' },
    ],
    tims_rate_limited: [`rate<${envFloat('RATE_LIMITED_RATE', 0.01)}`],
    checks: [`rate>${envFloat('CHECK_PASS_RATE', 0.99)}`],
  };
  if (kinds.includes('page')) {
    t['http_req_duration{kind:page}'] = [`p(95)<${envInt('P95_PAGE_MS', 1500)}`];
  }
  if (kinds.includes('api')) {
    t['http_req_duration{kind:api}'] = [`p(95)<${envInt('P95_API_MS', 800)}`];
  }
  return t;
}

/** Random think time between user actions, THINK_MIN_MS..THINK_MAX_MS. */
export function thinkSeconds() {
  const min = envInt('THINK_MIN_MS', 1000);
  const max = Math.max(min, envInt('THINK_MAX_MS', 3000));
  return (min + Math.random() * (max - min)) / 1000;
}

/** Abort the whole test with a message (used by setup() preflights). */
export function abort(message) {
  exec.test.abort(message);
  throw new Error(message);
}
