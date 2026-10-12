// Scenario (a): anonymous candidate browsing the public careers board.
//
// Per iteration, mirroring the browser: careers board HTML -> its tRPC reads (portal stats +
// first vacancy page) -> one vacancy detail HTML -> its tRPC reads (vacancy + sidebar list).
//
// EXCLUDED ON PURPOSE: the apply form, CV upload URL, Turnstile and every other write. This
// scenario never submits anything. See README.md.
//
// Required: WEB_BASE_URL, CAREERS_ORG_SLUG, CAREERS_ORG_ID (the synthetic tenant's org uuid).
// Optional: CAREERS_VACANCY_IDS (comma-separated; otherwise discovered once in setup()),
//           CAREERS_TRPC=0 to load only the server-rendered pages (see README "rate limits").

import { sleep } from 'k6';
import {
  abort,
  assertTargetAllowed,
  baseUrl,
  env,
  requireEnv,
  stages,
  thinkSeconds,
  thresholds,
} from './lib/config.js';
import { getPage, trpcQuery } from './lib/http.js';

const WEB = baseUrl('WEB_BASE_URL', 'http://localhost:3000');
const ORG_SLUG = requireEnv('CAREERS_ORG_SLUG', 'Slug of the SYNTHETIC tenant careers board.');
const ORG_ID = requireEnv('CAREERS_ORG_ID', 'Organization uuid of the SYNTHETIC tenant.');
const WITH_TRPC = env('CAREERS_TRPC', '1') !== '0';

if (!/^[a-z0-9-]{1,200}$/i.test(ORG_SLUG)) throw new Error('CAREERS_ORG_SLUG has unexpected characters');
if (!/^[0-9a-f-]{36}$/i.test(ORG_ID)) throw new Error('CAREERS_ORG_ID must be a uuid');
assertTargetAllowed([WEB]);

export const options = {
  scenarios: {
    careers: { executor: 'ramping-vus', startVUs: 0, stages: stages(), gracefulRampDown: '10s' },
  },
  thresholds: thresholds(['page', 'api']),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const LIST_INPUT = { organizationId: ORG_ID, take: 50 };

export function setup() {
  const fromEnv = env('CAREERS_VACANCY_IDS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    if (!fromEnv.every((id) => /^[0-9a-f-]{36}$/i.test(id))) abort('CAREERS_VACANCY_IDS must be uuids');
    return { vacancyIds: fromEnv };
  }
  const [list] = trpcQuery(WEB, [{ path: 'portal.listVacancies', input: LIST_INPUT }], 'setup_list_vacancies');
  const ids = list && Array.isArray(list.items) ? list.items.map((v) => v.id).filter(Boolean) : [];
  if (ids.length === 0) {
    abort('Preflight: the careers board returned no published vacancies. Publish some on the SYNTHETIC tenant first.');
  }
  return { vacancyIds: ids };
}

export default function (data) {
  getPage(`${WEB}/careers/${ORG_SLUG}`, 'careers_board');
  if (WITH_TRPC) {
    trpcQuery(
      WEB,
      [
        { path: 'portal.getPortalStats', input: { organizationId: ORG_ID } },
        { path: 'portal.listVacancies', input: LIST_INPUT },
      ],
      'careers_board_trpc',
    );
  }
  sleep(thinkSeconds());

  const vacancyId = data.vacancyIds[Math.floor(Math.random() * data.vacancyIds.length)];
  getPage(`${WEB}/careers/${ORG_SLUG}/${vacancyId}`, 'careers_vacancy');
  if (WITH_TRPC) {
    trpcQuery(
      WEB,
      [{ path: 'portal.getVacancy', input: { id: vacancyId, orgSlug: ORG_SLUG } }],
      'careers_vacancy_trpc',
    );
    trpcQuery(
      WEB,
      [{ path: 'portal.listVacancies', input: { organizationId: ORG_ID, take: 20 } }],
      'careers_vacancy_sidebar_trpc',
    );
  }
  sleep(thinkSeconds());
}
