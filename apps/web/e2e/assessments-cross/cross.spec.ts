import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  atsSql,
  callJson,
  evidence,
  latestOtp,
  passwordToken,
  readState,
  record,
  runSuiteCron,
  staffSignIn,
  suiteSql,
  type CrossState,
} from './lib';
import { driveSitting } from './player-driver';

/**
 * TIMS ATS ↔ TIMS Assessments (tims-suite /v1), for real, on one machine: both stacks running locally
 * (see README.md). Skipped unless ASSESSMENTS_CROSS_STATE names the state file stack/up.sh wrote, so it
 * never runs in CI by accident. Serial: every step builds on the one before.
 */
const s = readState();
test.skip(!s, 'needs both local stacks (apps/web/e2e/assessments-cross/README.md)');
test.describe.configure({ mode: 'serial' });

const st = s as CrossState;
const run = randomBytes(3).toString('hex');
const candA = { first: 'Ana', last: `Cruz X${run}`, email: `ana.${run}@cross-e2e.test` };
const candB = { first: 'Bruno', last: `Mora X${run}`, email: `bruno.${run}@cross-e2e.test` };
let vacancy: { id: string; title: string };
let candidateA = '';
let candidateB = '';
let attemptsA: Record<string, string> = {};
let attemptsB: Record<string, string> = {};
let ownerToken = '';
let orgId = '';
const contexts: BrowserContext[] = [];

async function persona(browser: Browser, locale: 'EN' | 'ES' = 'EN'): Promise<Page> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addInitScript((l) => window.localStorage.setItem('tims-locale', l), locale);
  contexts.push(context);
  return context.newPage();
}

const sqlStr = (v: string) => `'${v.replace(/'/g, "''")}'`;

function attemptsOf(candidateId: string): Record<string, string> {
  const rows = atsSql(
    st,
    `select instrument||'='||id from assessment_provider_attempts where candidate_id=${sqlStr(candidateId)}`,
  );
  return Object.fromEntries(
    rows
      .split('\n')
      .filter(Boolean)
      .map((r) => r.split('=')),
  );
}
const attemptStatus = (id: string) =>
  atsSql(st, `select state from assessment_provider_attempts where id=${sqlStr(id)}`);
const providerAssignment = (id: string) =>
  atsSql(st, `select provider_assignment_id from assessment_provider_attempts where id=${sqlStr(id)}`);

test.beforeAll(async () => {
  orgId = atsSql(st, `select id from organizations where slug=${sqlStr(st.orgSlug)}`);
  const v = atsSql(
    st,
    `select id||'|'||title from vacancies where organization_id=${sqlStr(orgId)} and status='published' and title='Data Scientist'`,
  );
  const [id, title] = v.split('|');
  vacancy = { id, title };
  ownerToken = await passwordToken(st, st.owner.email, st.owner.password);
});

test.afterAll(async () => {
  for (const c of contexts) await c.close().catch(() => undefined);
  const out = process.env.ASSESSMENTS_CROSS_REPORT;
  if (out) writeFileSync(out, JSON.stringify(evidence, null, 2));
});

test('H1 platform owner binds the org: the ATS gets a provider token, reads the catalog and creates the tenant', async () => {
  const r = await callJson(st, 'POST', `${st.apiURL}/platform/assessment-providers/bindings`, {
    token: ownerToken,
    headers: { Origin: st.baseURL },
    body: { organizationId: orgId, instruments: ['lia', 'english', 'personality'], defaultLocale: 'es' },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const tenant = (r.body as { providerTenantId: string }).providerTenantId;
  expect(suiteSql(st, `select count(*) from v1_partner_tenants where company_id=${sqlStr(tenant)}`)).toBe('1');
  record('H1 binding', `200; provider tenant ${tenant} exists in suite v1_partner_tenants`);
});

test('H2 HR sets LIA (scored), English (gate) and Personality (advisory) on the vacancy', async ({ browser }) => {
  const hr = await persona(browser);
  await staffSignIn(hr, 'hr@tims.co', st.staffPassword);
  await hr.goto(`/recruitment/vacancies/${vacancy.id}`);
  const card = hr.getByRole('region', { name: 'Assessments for this vacancy' });
  await expect(card).toBeVisible({ timeout: 60_000 });
  // A rerun on the same stack starts from an empty list (once the saved list has loaded).
  await expect(
    card.getByText('No assessments configured').or(card.getByRole('button', { name: 'Remove LIA' })),
  ).toBeVisible();
  for (const name of ['LIA', 'English', 'Personality']) {
    const remove = card.getByRole('button', { name: `Remove ${name}` });
    if ((await remove.count()) > 0) await remove.click();
  }
  for (const name of ['LIA', 'English', 'Personality']) {
    await card.getByLabel('Add a test').selectOption({ label: name });
    await card.getByRole('button', { name: 'Add' }).click();
  }
  const lia = card.getByRole('listitem').filter({ hasText: 'LIA' });
  const english = card.getByRole('listitem').filter({ hasText: 'English' });
  const personality = card.getByRole('listitem').filter({ hasText: 'Personality' });
  await lia.getByLabel('Minimum global percentile (0–100)').fill('40');
  await lia.getByLabel('Why this test is job-related').fill('Analyses data under time pressure');
  await english.getByLabel('Minimum CEFR level').selectOption('C2');
  await english.getByLabel('Why this test is job-related').fill('Serves customers in English');
  await personality.getByLabel('Why this test is job-related').fill('Interview guide');
  const save = card.getByRole('button', { name: 'Save assessments' });
  // A rerun that re-enters the saved list leaves nothing to save.
  if (await save.isEnabled()) {
    await save.click();
    await expect(hr.getByText('Assessments saved')).toBeVisible();
  }
  const stored = atsSql(st, `select fit_requirements::text from job_profiles where vacancy_id=${sqlStr(vacancy.id)}`);
  expect(stored).toContain('"lia"');
  expect(stored).toContain('"gate"');
  record('H2 vacancy assessments', `saved through the UI; job_profiles.fit_requirements = ${stored.slice(0, 300)}`);
});

async function apply(page: Page, c: typeof candA): Promise<void> {
  await page.goto(`/careers/${st.orgSlug}/${vacancy.id}`);
  await page
    .getByRole('button', { name: /^(postularse|apply)/i })
    .first()
    .click();
  const form = page.getByRole('dialog');
  await form.getByPlaceholder('María', { exact: true }).fill(c.first);
  await form.getByPlaceholder('López Rodríguez').fill(c.last);
  await form.getByPlaceholder('maria.lopez@gmail.com').fill(c.email);
  await form.getByPlaceholder('Código de país y número').fill('+506 8555 0101');
  await form.getByPlaceholder('Ciudad, país').fill('Heredia, Costa Rica');
  await form.getByRole('button', { name: /siguiente|next/i }).click();
  await form.getByPlaceholder('Analista de Recursos Humanos').fill('Analista de datos');
  await form.getByPlaceholder('Empresa ABC').fill('Datos del Valle');
  await form.locator('textarea').fill('Cross e2e — 4 años en análisis de datos.');
  await form.getByRole('button', { name: /siguiente|next/i }).click();
  const submit = form.getByRole('button', { name: /enviar postulaci[oó]n|submit application/i });
  const consent = form.getByRole('checkbox');
  if ((await consent.count()) > 0) await consent.first().check();
  await submit.click();
  await expect(page.getByText(/postulaci[oó]n enviada|application (sent|submitted)/i).first()).toBeVisible({
    timeout: 45_000,
  });
}

test('H3 two candidates apply on the careers page', async ({ browser }) => {
  await apply(await persona(browser, 'ES'), candA);
  await apply(await persona(browser, 'ES'), candB);
  candidateA = atsSql(st, `select id from candidates where email=${sqlStr(candA.email)}`);
  candidateB = atsSql(st, `select id from candidates where email=${sqlStr(candB.email)}`);
  expect(candidateA).toMatch(/^[0-9a-f-]{36}$/);
  expect(candidateB).toMatch(/^[0-9a-f-]{36}$/);
  record('H3 apply', `candidates ${candidateA}, ${candidateB} created by the careers apply form`);
});

async function assignVacancyTests(hr: Page, candidateId: string): Promise<void> {
  await hr.goto(`/recruitment/candidates/${candidateId}`);
  const card = hr.getByRole('region', { name: 'TIMS Assessments' });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.getByRole('button', { name: "Assign the vacancy's assessments" }).click();
  const dialog = hr.getByRole('dialog', { name: `Assign assessments: ${vacancy.title}` });
  await expect(dialog.getByTestId('assign-instruments').getByRole('listitem')).toHaveCount(3);
  await dialog.getByLabel('18 or older').check();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByTestId('assessment-consent-notice')).toBeVisible();
  await dialog.getByLabel('I have reviewed this notice.', { exact: false }).check();
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(hr.getByRole('dialog')).toHaveCount(0, { timeout: 60_000 });
  await expect(card.getByTestId('provider-status-chip')).toHaveCount(3, { timeout: 60_000 });
}

test('H4 HR assigns the vacancy tests; the ATS creates the subject and one /v1 assignment per test', async ({
  browser,
}) => {
  const hr = await persona(browser);
  await staffSignIn(hr, 'hr@tims.co', st.staffPassword);
  await assignVacancyTests(hr, candidateA);
  await assignVacancyTests(hr, candidateB);
  attemptsA = attemptsOf(candidateA);
  attemptsB = attemptsOf(candidateB);
  expect(Object.keys(attemptsA).sort()).toEqual(['english', 'lia', 'personality']);
  for (const id of [...Object.values(attemptsA), ...Object.values(attemptsB)]) {
    const row = suiteSql(
      st,
      `select instrument||'|'||status||'|'||coalesce(age_band,'') from v1_assignments where external_ref=${sqlStr(id)}`,
    );
    expect(row, `suite assignment for ATS attempt ${id}`).toMatch(/\|created\|.*18_plus/);
  }
  record(
    'H4 assign',
    `6 ATS attempts; each has a suite v1_assignments row (external_ref = attempt id, status created, age_attestation 18_plus)`,
  );
});

// ---- the candidate: portal sign-in, consent, the hosted player ------------------------------------

const PORTAL_NAME: Record<string, string> = { lia: 'Cognitive skills', english: 'English', personality: 'Personality' };

async function portalSignIn(page: Page, email: string): Promise<void> {
  const since = Date.now();
  await page.goto(`/careers/${st.orgSlug}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('form button[type="submit"]').click();
  const code = await latestOtp(st, email, since);
  await page.locator('form input').first().fill(code);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
}

function portalItem(page: Page, instrument: string) {
  return page.getByRole('listitem').filter({ has: page.getByText(PORTAL_NAME[instrument], { exact: true }) });
}

/** Consent (required texts, optional ones ticked or not), launch, and land on the hosted player. */
async function consentAndOpen(page: Page, instrument: string, optional: 'accept' | 'decline' | 'none'): Promise<void> {
  const item = portalItem(page, instrument);
  await expect(item).toBeVisible({ timeout: 60_000 });
  await item.getByRole('button', { name: 'Read the consent' }).click();
  await item.getByLabel('I have read this notice.').check();
  for (const box of await item.getByLabel('I have read this text and I accept it.').all()) await box.check();
  const optionalSection = item.getByTestId('provider-optional-consents');
  if (optional === 'none') await expect(optionalSection).toHaveCount(0);
  else {
    await expect(optionalSection).toBeVisible();
    if (optional === 'accept')
      for (const box of await optionalSection.getByLabel('I agree (optional).').all()) await box.check();
  }
  await item.getByRole('button', { name: 'Accept and start' }).click();
  await page.waitForURL((u) => u.origin === st.suite.playerOrigin, { timeout: 60_000 });
}

async function sitAndReturn(page: Page, instrument: string): Promise<string> {
  await page.getByTestId('start-sitting').click({ timeout: 60_000 });
  const report = await driveSitting(page.mainFrame(), {
    timeoutMs: 15 * 60_000,
    leftPlayer: () => page.url().startsWith(st.baseURL),
  });
  await page.waitForURL((u) => u.href.startsWith(`${st.baseURL}/careers/${st.orgSlug}/dashboard`), { timeout: 60_000 });
  await expect(portalItem(page, instrument).getByText('Completed', { exact: true })).toBeVisible({ timeout: 60_000 });
  return JSON.stringify({ answers: report.answers, items: report.items });
}

test('H5 candidate A signs in (OTP), consents and completes LIA, Personality and English (no voice) in the hosted player', async ({
  browser,
}) => {
  const page = await persona(browser);
  await portalSignIn(page, candA.email);
  const seen: string[] = [];
  for (const [instrument, optional] of [
    ['lia', 'none'],
    ['personality', 'none'],
    ['english', 'decline'],
  ] as const) {
    await consentAndOpen(page, instrument, optional);
    seen.push(`${instrument}: ${await sitAndReturn(page, instrument)}`);
  }
  const consents = suiteSql(
    st,
    `select string_agg(distinct c.purpose, ',' order by c.purpose) from v1_consents c join v1_subjects s on s.id=c.subject_id where s.external_ref=${sqlStr(candidateA)} and c.withdrawn_at is null`,
  );
  expect(consents).toBe('assessment');
  for (const id of Object.values(attemptsA))
    expect(suiteSql(st, `select status from v1_assignments where external_ref=${sqlStr(id)}`)).toBe('completed');
  expect(
    atsSql(
      st,
      `select declined_optional_consents::text from assessment_provider_attempts where id=${sqlStr(attemptsA.english)}`,
    ),
  ).toContain('voice');
  record(
    'H5 candidate sittings',
    `consents at the suite: ${consents}; all 3 suite assignments completed; ${seen.join(' | ')}`,
  );
});

test('H6 the suite signs and delivers events; the ATS verifies them and fetches every result', async () => {
  await expect
    .poll(
      () =>
        atsSql(
          st,
          `select count(*) from assessment_provider_results where attempt_id in (${Object.values(attemptsA).map(sqlStr).join(',')})`,
        ),
      {
        timeout: 120_000,
      },
    )
    .toBe('3');
  const inbox = atsSql(
    st,
    `select string_agg(event_type||':'||status, ',' order by event_type) from assessment_provider_webhook_inbox where data::text like any (array[${Object.values(
      attemptsA,
    )
      .map((id) => sqlStr(`%${providerAssignment(id)}%`))
      .join(',')}])`,
  );
  expect(inbox).toContain('result.ready');
  const delivered = suiteSql(st, `select string_agg(distinct status, ',') from v1_event_deliveries`);
  const states = Object.entries(attemptsA)
    .map(([k, id]) => `${k}=${attemptStatus(id)}`)
    .join(',');
  for (const id of Object.values(attemptsA)) expect(['result_ready', 'needs_review']).toContain(attemptStatus(id));
  record('H6 events + results', `ATS inbox: ${inbox}; suite deliveries status: ${delivered}; attempts: ${states}`);
});

test('H7 FIT v2 scores the candidate from the provider results, with no HR compute', async () => {
  // Round 11: a provider result creates the missing FIT v2 row for a candidate with an active application
  // (FitRecomputeHostedService drains the queue). Nobody clicks Compute Rankings anywhere in this spec, so the
  // row below can only come from the provider results.
  await expect
    .poll(
      () =>
        atsSql(
          st,
          `select count(*) from fit_scores where candidate_id=${sqlStr(candidateA)} and vacancy_id=${sqlStr(vacancy.id)}`,
        ),
      {
        timeout: 120_000,
      },
    )
    .toBe('1');
  const breakdown = atsSql(
    st,
    `select breakdown::text from fit_scores where candidate_id=${sqlStr(candidateA)} and vacancy_id=${sqlStr(vacancy.id)}`,
  );
  for (const instrument of ['lia', 'english', 'personality']) expect(breakdown).toContain(instrument);
  expect(breakdown).toContain('provider');
  const overall = atsSql(
    st,
    `select coalesce(overall_score::text,'null')||' restricted='||coalesce(restricted_overall_score::text,'null')||' partial='||is_partial from fit_scores where candidate_id=${sqlStr(candidateA)} and vacancy_id=${sqlStr(vacancy.id)}`,
  );
  record('H7 FIT v2', `${overall}; breakdown (first 700 chars): ${breakdown.slice(0, 700)}`);
});

test('H8 HR reads each result on the candidate (exact levels)', async ({ browser }) => {
  const hr = await persona(browser);
  await staffSignIn(hr, 'hr@tims.co', st.staffPassword);
  await hr.goto(`/recruitment/candidates/${candidateA}`);
  const card = hr.getByRole('region', { name: 'TIMS Assessments' });
  const lia = card.getByTestId('provider-attempt').filter({ hasText: 'LIA' });
  const english = card.getByTestId('provider-attempt').filter({ hasText: 'English' });
  await expect(lia.getByTestId('provider-status-chip')).toHaveText(/Result ready|Needs review/, { timeout: 60_000 });
  await expect(lia.getByText(/Global percentile \d+/)).toBeVisible();
  await expect(english.getByText('Speaking not assessed (no voice consent).')).toBeVisible();
  await expect(english.getByTestId('provider-result-minimum')).toHaveText(/Below minimum|Minimum met|Minimum: unknown/);
  record(
    'H8 HR view',
    `LIA: ${await lia.innerText()} || English: ${await english.innerText()}`.replace(/\s+/g, ' ').slice(0, 600),
  );
});

test('H9 a team leader sees only "below minimum" for English, never the level (D6)', async ({ browser }) => {
  // Local fixture: the vacancy belongs to the team the seeded leader leads. The leader's assessment:read at TEAM
  // scope comes from the round-11 owner step, applied verbatim (the seed grants the leader role none).
  const leaderId = atsSql(st, `select id from users where email='leader@tims.co'`);
  atsSql(
    st,
    `update vacancies set team_id=(select id from teams where leader_id=${sqlStr(leaderId)} limit 1) where id=${sqlStr(vacancy.id)}`,
  );
  const ownerSql = resolve(__dirname, '../../../../services/Tims.Platform/db/owner/leader_assessment_read.sql');
  const granted = execFileSync(
    'psql',
    [st.atsDatabaseUrl, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-v', `org_id=${orgId}`, '-f', ownerSql],
    { encoding: 'utf8' },
  ).trim();
  expect(granted).toContain('read|team');
  const english = atsSql(
    st,
    `select coalesce(cefr,'') from assessment_provider_results where attempt_id=${sqlStr(attemptsA.english)}`,
  );
  const leader = await persona(browser);
  await staffSignIn(leader, 'leader@tims.co', st.staffPassword);
  await leader.goto(`/recruitment/candidates/${candidateA}`);
  const card = leader.getByRole('region', { name: 'TIMS Assessments' });
  const row = card.getByTestId('provider-attempt').filter({ hasText: 'English' });
  await expect(row.getByTestId('provider-result-minimum')).toHaveText('Below minimum', { timeout: 60_000 });
  await expect(row.getByTestId('provider-result-level')).toHaveCount(0);
  if (english) await expect(row.getByText(`CEFR ${english}`)).toHaveCount(0);
  record(
    'H9 D6 team leader',
    `owner SQL leader_assessment_read.sql granted ${granted.split('\n').find((l) => l.includes('|')) ?? 'nothing'}; leader ${leaderId} sees "Below minimum" for English (HR's exact CEFR ${english || 'n/a'} hidden)`,
  );
});

// ---- candidate B: voice consent, cancel, expiry, withdrawal -----------------------------------------

test('H10 candidate B gives the optional voice consents for English; the sitting offers the speaking section', async ({
  browser,
}) => {
  const page = await persona(browser);
  await portalSignIn(page, candB.email);
  await consentAndOpen(page, 'english', 'accept');
  await page.getByTestId('start-sitting').click({ timeout: 60_000 });
  const report = await driveSitting(page.mainFrame(), {
    timeoutMs: 15 * 60_000,
    leftPlayer: () => page.url().startsWith(st.baseURL),
    stopWhen: (type) => type === 'audio_record',
  });
  const consents = suiteSql(
    st,
    `select string_agg(distinct c.purpose, ',' order by c.purpose) from v1_consents c join v1_subjects s on s.id=c.subject_id where s.external_ref=${sqlStr(candidateB)} and c.withdrawn_at is null`,
  );
  expect(consents).toBe('ai_scoring,assessment,voice');
  expect(report.stoppedAt, 'the English sitting reached its speaking item').toBe('audio_record');
  record(
    'H10 voice consent',
    `suite consents ${consents}; the sitting served a speaking (audio_record) item after ${report.answers} answers. Recording upload and AI scoring: SKIPPED locally (needs S3 + Bedrock)`,
  );
});

test('H11 HR cancels B’s English assignment; the suite cancels it', async ({ browser }) => {
  const hr = await persona(browser);
  await staffSignIn(hr, 'hr@tims.co', st.staffPassword);
  await hr.goto(`/recruitment/candidates/${candidateB}`);
  const card = hr.getByRole('region', { name: 'TIMS Assessments' });
  const english = card.getByTestId('provider-attempt').filter({ hasText: 'English' });
  await english.getByRole('button', { name: 'Cancel English' }).click();
  await expect(hr.getByText('Assessment cancelled')).toBeVisible();
  // Read the list fresh: one local run saw the post-mutation refetch answered with an empty-body 401 (see README).
  await hr.reload();
  await expect(english.getByTestId('provider-status-chip')).toHaveText('Cancelled', { timeout: 60_000 });
  const suite = suiteSql(
    st,
    `select status||'|'||coalesce(void_reason,'') from v1_assignments where external_ref=${sqlStr(attemptsB.english)}`,
  );
  expect(suite).toMatch(/^(cancelled|voided)/);
  record('H11 cancel', `ATS attempt ${attemptStatus(attemptsB.english)}; suite assignment ${suite}`);
});

test('H12 B’s Personality assignment expires at the suite (time travel); the ATS learns it', async () => {
  const assignment = providerAssignment(attemptsB.personality);
  suiteSql(st, `update v1_assignments set expires_at = now() - interval '1 minute' where id=${sqlStr(assignment)}`);
  expect(await runSuiteCron(st)).toBe(200);
  await expect
    .poll(() => suiteSql(st, `select status from v1_assignments where id=${sqlStr(assignment)}`), { timeout: 60_000 })
    .toBe('expired');
  await expect.poll(() => attemptStatus(attemptsB.personality), { timeout: 120_000 }).toBe('expired');
  record(
    'H12 expiry',
    `suite assignment ${assignment} expired by the scheduled run; ATS attempt expired via assignment.expired`,
  );
});

test('H13 B withdraws consent in the portal; the ATS cascades to the provider', async ({ browser }) => {
  const page = await persona(browser);
  await portalSignIn(page, candB.email);
  await page.getByRole('button', { name: 'Revoke authorization' }).click();
  await page.getByRole('button', { name: 'Yes, revoke' }).click();
  await expect(page.getByText('You revoked your authorization')).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      () =>
        suiteSql(
          st,
          `select count(*) from v1_consents c join v1_subjects s on s.id=c.subject_id where s.external_ref=${sqlStr(candidateB)} and c.withdrawn_at is null`,
        ),
      { timeout: 180_000, intervals: [5_000] },
    )
    .toBe('0');
  const lia = suiteSql(st, `select status from v1_assignments where external_ref=${sqlStr(attemptsB.lia)}`);
  expect(lia).toMatch(/cancelled|voided/);
  record(
    'H13 withdrawal',
    `every suite consent of B withdrawn; B's open LIA assignment ${lia}; ATS withdrawal_state ${atsSql(st, `select coalesce(withdrawal_state,'') from assessment_provider_attempts where id=${sqlStr(attemptsB.lia)}`)}`,
  );
});

// ---- DSAR (platform owner, C# only; no UI) -----------------------------------------------------------

test('H14 DSAR export then erasure of candidate A at the provider', async () => {
  const subject = suiteSql(st, `select id from v1_subjects where external_ref=${sqlStr(candidateA)}`);
  expect(subject).toMatch(/^[0-9a-f-]{36}$/);
  const base = `${st.apiURL}/platform/assessment-providers/organizations/${orgId}/candidates/${candidateA}`;
  const exp = await callJson(st, 'GET', `${base}/export`, { token: ownerToken, headers: { Origin: st.baseURL } });
  expect(exp.status, JSON.stringify(exp.body).slice(0, 300)).toBe(200);
  const text = JSON.stringify(exp.body);
  expect(text).toContain(providerAssignment(attemptsA.lia));
  expect(text).toContain(subject);
  const er = await callJson(st, 'POST', `${base}/erasure`, { token: ownerToken, headers: { Origin: st.baseURL } });
  expect(er.status, JSON.stringify(er.body)).toBe(202);
  // The suite completes an erasure on a scheduled run once the upload fence has drained (contract eraseSubject
  // "Drain": 600 s after the fence). Time travel: move THIS subject's fence back 11 minutes.
  suiteSql(
    st,
    `update v1_subject_erasures set fenced_at = fenced_at - interval '11 minutes' where subject_id=${sqlStr(subject)}`,
  );
  await expect
    .poll(
      async () => {
        await runSuiteCron(st);
        return atsSql(
          st,
          `select count(*) from assessment_provider_webhook_inbox where event_type='subject.erased' and data::text like ${sqlStr(`%${subject}%`)} and status='processed'`,
        );
      },
      { timeout: 120_000, intervals: [5_000] },
    )
    .toBe('1');
  const erasure = suiteSql(st, `select status from v1_subject_erasures where subject_id=${sqlStr(subject)}`);
  expect(erasure).toBe('completed');
  const states = Object.values(attemptsA)
    .map((id) => attemptStatus(id))
    .join(',');
  record(
    'H14 DSAR',
    `export 200 (${text.length} bytes, includes the provider subject ${subject} and its assignments); erasure 202; suite erasure ${erasure} after the drain; subject.erased verified and processed by the ATS; ATS attempts now ${states}; provider results left at the ATS: ${atsSql(st, `select count(*) from assessment_provider_results where attempt_id in (${Object.values(attemptsA).map(sqlStr).join(',')})`)}`,
  );
});
