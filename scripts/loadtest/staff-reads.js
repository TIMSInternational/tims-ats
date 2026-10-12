// Scenario (b): an authenticated recruiter of a SYNTHETIC tenant reading the candidate list and the
// pipeline board — the two heaviest everyday staff reads.
//
// Per iteration, mirroring the browser: candidates page HTML -> candidate KPIs + list (one batch)
// -> pipeline page HTML -> published vacancies -> the board of one vacancy.
//
// AUTH: uses a PRE-ISSUED Supabase session cookie (SESSION_COOKIE or SESSIONS_FILE). This suite
// never logs in: automating login would hammer the auth provider's rate limits and lock the
// account. Queries only — no mutation, no write. See README.md.
//
// Required: WEB_BASE_URL and a session (SESSION_COOKIE, or SESSIONS_FILE for several users).
// Optional: STAFF_VACANCY_IDS (comma-separated; otherwise discovered in setup()).

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
import { assertSessionsOutlastRun, getPage, loadSessions, sessionForVu, trpcQuery } from './lib/http.js';

const WEB = baseUrl('WEB_BASE_URL', 'http://localhost:3000');
assertTargetAllowed([WEB]);

const STAGES = stages();
const SESSIONS = loadSessions({ cookie: true, accessToken: false });

export const options = {
  scenarios: {
    staff_reads: { executor: 'ramping-vus', startVUs: 0, stages: STAGES, gracefulRampDown: '10s' },
  },
  thresholds: thresholds(['page', 'api']),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const PUBLISHED_VACANCIES = { path: 'vacancy.list', input: { limit: 50, status: 'published' } };

export function setup() {
  try {
    assertSessionsOutlastRun(SESSIONS, plannedSeconds(STAGES));
  } catch (e) {
    abort(`Preflight: ${e.message}`);
  }
  // One authenticated read per session: fail fast on a dead session or a missing permission
  // instead of recording a run full of 401/403s as "latency".
  SESSIONS.forEach((session, i) => {
    const [list] = trpcQuery(WEB, [{ path: 'candidate.list', input: { limit: 1 } }], 'setup_session_check', session);
    if (list === undefined) {
      abort(
        `Preflight: session ${i} could not read candidate.list (expired session, MFA level, or missing ` +
          'candidate:read permission). Re-issue it — see README.',
      );
    }
  });

  const fromEnv = env('STAFF_VACANCY_IDS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    if (!fromEnv.every((id) => /^[0-9a-f-]{36}$/i.test(id))) abort('STAFF_VACANCY_IDS must be uuids');
    return { vacancyIds: fromEnv };
  }
  const [vacancies] = trpcQuery(WEB, [PUBLISHED_VACANCIES], 'setup_list_vacancies', SESSIONS[0]);
  const items = vacancies && Array.isArray(vacancies.items) ? vacancies.items : [];
  const ids = items.map((v) => v.id).filter(Boolean);
  if (ids.length === 0) abort('Preflight: no published vacancies visible to session 0 on the SYNTHETIC tenant.');
  return { vacancyIds: ids };
}

export default function (data) {
  const session = sessionForVu(SESSIONS);

  getPage(`${WEB}/recruitment/candidates`, 'staff_candidates_page', session);
  trpcQuery(
    WEB,
    [
      { path: 'candidate.getDashboardKpis', input: undefined },
      { path: 'candidate.list', input: { limit: 50 } },
    ],
    'staff_candidates_trpc',
    session,
  );
  sleep(thinkSeconds());

  getPage(`${WEB}/recruitment/pipeline`, 'staff_pipeline_page', session);
  trpcQuery(WEB, [PUBLISHED_VACANCIES], 'staff_pipeline_vacancies_trpc', session);
  const vacancyId = data.vacancyIds[Math.floor(Math.random() * data.vacancyIds.length)];
  trpcQuery(
    WEB,
    [{ path: 'pipeline.getBoard', input: { vacancyId, status: 'active' } }],
    'staff_pipeline_board_trpc',
    session,
  );
  sleep(thinkSeconds());
}
