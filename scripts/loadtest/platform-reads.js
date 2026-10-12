// Scenario (c): C# Platform API (services/Tims.Platform) read endpoints, as the SAME synthetic
// staff user as scenario (b), authenticated with that session's Supabase access token (bearer).
//
// Two routes to the API, chosen by PLATFORM_BASE_URL:
//   - default: `${WEB_BASE_URL}/api/platform` — the same-origin relay the browser uses
//     (apps/web/app/api/platform/[...path]/route.ts), so the run exercises web + API together;
//   - or the C# service's own base URL, to isolate the API from the web tier.
//
// GET only. Endpoints come from PLATFORM_ENDPOINTS (comma-separated paths, query string allowed).
// Many C# read surfaces are behind per-surface flags and answer 404 while dark, so setup() probes
// each endpoint once and ABORTS on anything but 200 rather than timing a 404.
//
// Required: an access token (ACCESS_TOKEN, SESSIONS_FILE[].accessToken, or derived from SESSION_COOKIE).

import { sleep } from 'k6';
import {
  abort,
  assertTargetAllowed,
  baseUrl,
  env,
  plannedSeconds,
  stages,
  thinkSeconds,
  thresholds,
} from './lib/config.js';
import { assertSessionsOutlastRun, loadSessions, platformGet, sessionForVu } from './lib/http.js';

const WEB = baseUrl('WEB_BASE_URL', 'http://localhost:3000');
const PLATFORM = baseUrl('PLATFORM_BASE_URL', `${WEB}/api/platform`);
assertTargetAllowed([WEB, PLATFORM]);

const DEFAULT_ENDPOINTS = '/whoami,/reporting/kpis?period=30D,/reporting/funnel,/reporting/source-breakdown?period=30D';
const ENDPOINTS = env('PLATFORM_ENDPOINTS', DEFAULT_ENDPOINTS)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
ENDPOINTS.forEach((p) => {
  if (!/^\/[A-Za-z0-9/_.~-]+(\?[A-Za-z0-9=&_.~-]*)?$/.test(p))
    throw new Error(`PLATFORM_ENDPOINTS entry "${p}" is not a plain path`);
});
// Stable, low-cardinality metric names: "/reporting/kpis?period=30D" -> "platform_reporting_kpis".
const NAMES = ENDPOINTS.map(
  (p) =>
    'platform' +
    p
      .split('?')[0]
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/_+$/, ''),
);

const STAGES = stages();
const SESSIONS = loadSessions({ cookie: false, accessToken: true });

export const options = {
  scenarios: {
    platform_reads: { executor: 'ramping-vus', startVUs: 0, stages: STAGES, gracefulRampDown: '10s' },
  },
  thresholds: thresholds(['api']),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  try {
    assertSessionsOutlastRun(SESSIONS, plannedSeconds(STAGES));
  } catch (e) {
    abort(`Preflight: ${e.message}`);
  }
  const failures = [];
  ENDPOINTS.forEach((path, i) => {
    const res = platformGet(PLATFORM, path, `setup_${NAMES[i]}`, SESSIONS[0]);
    if (res.status !== 200) failures.push(`${path} -> HTTP ${res.status}`);
  });
  if (failures.length > 0) {
    abort(
      `Preflight failed: ${failures.join('; ')}. 401 = token invalid/expired; 403 = the synthetic user ` +
        'lacks the permission; 404 = surface not enabled on this deployment (drop it from PLATFORM_ENDPOINTS); ' +
        '429 = the user is already rate-limited (wait a minute).',
    );
  }
}

export default function () {
  const session = sessionForVu(SESSIONS);
  // Think time after EACH read keeps one VU near the per-user query budget (see README).
  ENDPOINTS.forEach((path, i) => {
    platformGet(PLATFORM, path, NAMES[i], session);
    sleep(thinkSeconds());
  });
}
