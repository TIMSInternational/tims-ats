import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Frame, type Page } from '@playwright/test';
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
// C is assigned after HR turns on lockdown + alert control (H4b): only C's sittings carry that proctoring.
const candC = { first: 'Carla', last: `Rojas X${run}`, email: `carla.${run}@cross-e2e.test` };
let vacancy: { id: string; title: string };
let candidateA = '';
let candidateB = '';
let candidateC = '';
let attemptsA: Record<string, string> = {};
let attemptsB: Record<string, string> = {};
let attemptsC: Record<string, string> = {};
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

// Walkthrough screenshots (ASSESSMENTS_CROSS_RECORD=<dir>, see playwright.config.ts): attached to the HTML report
// and written, numbered in story order, to <dir>/shots. A normal run takes none.
const shotsDir = process.env.ASSESSMENTS_CROSS_RECORD ? join(process.env.ASSESSMENTS_CROSS_RECORD, 'shots') : null;
let shotNo = 0;
async function shot(page: Page, name: string): Promise<void> {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.waitForTimeout(400);
  // The portal's assessment frame is a fixed full-screen dialog: a full-page capture would draw it mid-page.
  const framed = (await assessmentDialog(page).count()) > 0;
  const body = await page.screenshot({ fullPage: !framed });
  const file = `${String(++shotNo).padStart(2, '0')}-${name}.png`;
  writeFileSync(join(shotsDir, file), body);
  await test.info().attach(file, { body, contentType: 'image/png' });
}

/** The portal's full-screen test frame (its accessible name is the test's name). */
function assessmentDialog(page: Page) {
  return page.locator('[role="dialog"][aria-modal="true"]').filter({ has: page.locator('iframe') });
}

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
/** The validity the provider published for the attempt's result (valid | needs_review | voided), or ''. */
const resultValidity = (id: string) =>
  atsSql(
    st,
    `select coalesce(max(validity_status),'') from assessment_provider_results where attempt_id=${sqlStr(id)}`,
  );
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
  // A rerun on the same stack starts from the default assessment security (H4b turns it on for candidate C only).
  atsSql(st, `delete from assessment_provider_settings where organization_id=${sqlStr(orgId)}`);
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
    body: { organizationId: orgId, instruments: ['lia', 'english', 'personality', 'pca'], defaultLocale: 'es' },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const tenant = (r.body as { providerTenantId: string }).providerTenantId;
  expect(suiteSql(st, `select count(*) from v1_partner_tenants where company_id=${sqlStr(tenant)}`)).toBe('1');
  record('H1 binding', `200; provider tenant ${tenant} exists in suite v1_partner_tenants`);
});

test('H2 HR sets LIA (scored), English (gate), Personality and PCA (advisory) on the vacancy', async ({ browser }) => {
  const hr = await persona(browser);
  await staffSignIn(hr, 'hr@tims.co', st.staffPassword);
  await hr.goto(`/recruitment/vacancies/${vacancy.id}`);
  const card = hr.getByRole('region', { name: 'Assessments for this vacancy' });
  await expect(card).toBeVisible({ timeout: 60_000 });
  // A rerun on the same stack starts from an empty list (once the saved list has loaded).
  await expect(
    card.getByText('No assessments configured').or(card.getByRole('button', { name: 'Remove LIA' })),
  ).toBeVisible();
  for (const name of ['LIA', 'English', 'Personality', 'PCA']) {
    const remove = card.getByRole('button', { name: `Remove ${name}` });
    if ((await remove.count()) > 0) await remove.click();
  }
  for (const name of ['LIA', 'English', 'Personality', 'PCA']) {
    await card.getByLabel('Add a test').selectOption({ label: name });
    await card.getByRole('button', { name: 'Add' }).click();
  }
  const lia = card.getByRole('listitem').filter({ hasText: 'LIA' });
  const english = card.getByRole('listitem').filter({ hasText: 'English' });
  const personality = card.getByRole('listitem').filter({ hasText: 'Personality' });
  const pca = card.getByRole('listitem').filter({ hasText: 'PCA' });
  await lia.getByLabel('Minimum global percentile (0–100)').fill('40');
  await lia.getByLabel('Why this test is job-related').fill('Analyses data under time pressure');
  await english.getByLabel('Minimum CEFR level').selectOption('C2');
  await english.getByLabel('Why this test is job-related').fill('Serves customers in English');
  await personality.getByLabel('Why this test is job-related').fill('Interview guide');
  // TIMS 2026-11-12: PCA is scored on TIMS's own fit to the vacancy's TIMS position code (the stand-in knows 194225).
  await pca.getByLabel('How FIT uses it').selectOption('scored');
  await pca.getByLabel('TIMS position code (JCA)').fill('194225');
  await pca.getByLabel('Why this test is job-related').fill('Fit to the position as TIMS computes it (PCA vs JCA)');
  const save = card.getByRole('button', { name: 'Save assessments' });
  // A rerun that re-enters the saved list leaves nothing to save.
  if (await save.isEnabled()) {
    await save.click();
    await expect(hr.getByText('Assessments saved')).toBeVisible();
  }
  await card.scrollIntoViewIfNeeded();
  await shot(hr, 'hr-vacancy-assessments-saved');
  const stored = atsSql(st, `select fit_requirements::text from job_profiles where vacancy_id=${sqlStr(vacancy.id)}`);
  expect(stored).toContain('"lia"');
  expect(stored).toContain('"gate"');
  expect(stored).toContain('"pca"');
  expect(stored).toMatch(/"jobCode": ?"194225"/);
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

test('H3 three candidates apply on the careers page', async ({ browser }) => {
  await apply(await persona(browser, 'ES'), candA);
  await apply(await persona(browser, 'ES'), candB);
  await apply(await persona(browser, 'ES'), candC);
  candidateC = atsSql(st, `select id from candidates where email=${sqlStr(candC.email)}`);
  expect(candidateC).toMatch(/^[0-9a-f-]{36}$/);
  candidateA = atsSql(st, `select id from candidates where email=${sqlStr(candA.email)}`);
  candidateB = atsSql(st, `select id from candidates where email=${sqlStr(candB.email)}`);
  expect(candidateA).toMatch(/^[0-9a-f-]{36}$/);
  expect(candidateB).toMatch(/^[0-9a-f-]{36}$/);
  record('H3 apply', `candidates ${candidateA}, ${candidateB}, ${candidateC} created by the careers apply form`);
});

async function assignVacancyTests(hr: Page, candidateId: string, shots = false): Promise<void> {
  await hr.goto(`/recruitment/candidates/${candidateId}`);
  const card = hr.getByRole('region', { name: 'TIMS Assessments' });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.getByRole('button', { name: "Assign the vacancy's assessments" }).click();
  const dialog = hr.getByRole('dialog', { name: `Assign assessments: ${vacancy.title}` });
  await expect(dialog.getByTestId('assign-instruments').getByRole('listitem')).toHaveCount(4);
  await dialog.getByLabel('18 or older').check();
  if (shots) await shot(hr, 'hr-assign-dialog-four-tests');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByTestId('assessment-consent-notice')).toBeVisible();
  await dialog.getByLabel('I have reviewed this notice.', { exact: false }).check();
  if (shots) await shot(hr, 'hr-assign-dialog-notice');
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(hr.getByRole('dialog')).toHaveCount(0, { timeout: 60_000 });
  await expect(card.getByTestId('provider-status-chip')).toHaveCount(4, { timeout: 60_000 });
  if (shots) await shot(hr, 'hr-candidate-four-tests-awaiting-consent');
}

test('H4 HR assigns the vacancy tests; the ATS creates the subject and one /v1 assignment per test', async ({
  browser,
}) => {
  const hr = await persona(browser);
  await staffSignIn(hr, 'hr@tims.co', st.staffPassword);
  await assignVacancyTests(hr, candidateA, true);
  await assignVacancyTests(hr, candidateB);
  attemptsA = attemptsOf(candidateA);
  attemptsB = attemptsOf(candidateB);
  expect(Object.keys(attemptsA).sort()).toEqual(['english', 'lia', 'pca', 'personality']);
  for (const id of [...Object.values(attemptsA), ...Object.values(attemptsB)]) {
    const row = suiteSql(
      st,
      `select instrument||'|'||status||'|'||coalesce(age_band,'') from v1_assignments where external_ref=${sqlStr(id)}`,
    );
    expect(row, `suite assignment for ATS attempt ${id}`).toMatch(/\|created\|.*18_plus/);
  }
  record(
    'H4 assign',
    `8 ATS attempts (LIA, English, Personality, PCA for each candidate); each has a suite v1_assignments row (external_ref = attempt id, status created, age_attestation 18_plus)`,
  );
});

test('H4b HR turns on lockdown and alert control (warn at 3) in Assessment security, then assigns candidate C', async ({
  browser,
}) => {
  const hr = await persona(browser);
  await staffSignIn(hr, 'hr@tims.co', st.staffPassword);
  await hr.goto('/settings/assessment-security');
  const form = hr.getByRole('form', { name: 'Assessment security' });
  await expect(form).toBeVisible({ timeout: 60_000 });
  await shot(hr, 'hr-assessment-security-default');
  const lockdown = form.getByRole('switch', { name: 'Lockdown mode' });
  const alerts = form.getByRole('switch', { name: 'Alert control' });
  if (!(await lockdown.isChecked())) await lockdown.check();
  if (!(await alerts.isChecked())) await alerts.check();
  // The suite's default when alert control is first turned on is 3 alerts.
  await expect(form.getByRole('spinbutton').or(form.getByRole('textbox'))).toHaveValue('3');
  await form.getByRole('radio', { name: /Only warn/ }).check();
  await expect(form.getByRole('switch', { name: 'Identity check' })).toBeDisabled();
  await expect(form.getByTestId('identity-unavailable')).toBeVisible();
  const save = form.getByRole('button', { name: 'Save changes' });
  if (await save.isEnabled()) {
    await save.click();
    await expect(hr.getByText('Settings saved. They apply to the next tests you assign.')).toBeVisible();
  }
  await shot(hr, 'hr-assessment-security-lockdown-warn-3');
  const stored = atsSql(
    st,
    `select proctoring_lockdown||'|'||coalesce(anti_cheat_threshold::text,'')||'|'||coalesce(anti_cheat_consequence,'') from assessment_provider_settings where organization_id=${sqlStr(orgId)}`,
  );
  await assignVacancyTests(hr, candidateC);
  attemptsC = attemptsOf(candidateC);
  const proctoring = (id: string) =>
    suiteSql(st, `select coalesce(proctoring::text,'null') from v1_assignments where external_ref=${sqlStr(id)}`);
  const lia = suiteSql(
    st,
    `select (proctoring->>'lockdown')||'|'||(proctoring->'anti_cheat'->>'threshold')||'|'||(proctoring->'anti_cheat'->>'consequence') from v1_assignments where external_ref=${sqlStr(attemptsC.lia)}`,
  );
  expect(lia).toBe('true|3|warn');
  // Assigned before the change: A keeps the proctoring it was sent with.
  expect(proctoring(attemptsA.lia)).not.toContain('"lockdown": true');
  // A PCA never carries proctoring.
  expect(proctoring(attemptsC.pca)).toBe('null');
  record(
    'H4b assessment security',
    `saved through /settings/assessment-security (ATS row ${stored}); C's LIA at the suite: lockdown|threshold|consequence = ${lia}; A's LIA (assigned before) ${proctoring(attemptsA.lia)}; C's PCA ${proctoring(attemptsC.pca)}`,
  );
});

// ---- the candidate: portal sign-in, consent, the hosted player ------------------------------------

const PORTAL_NAME: Record<string, string> = {
  lia: 'Cognitive skills',
  english: 'English',
  personality: 'Personality',
  pca: 'Behavioral profile',
};

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

// The PCA stand-in provider's own site (stack/suite-up.ts PORTS.pcaSurvey).
const PCA_SURVEY = 'https://localhost:57480';

/** Embedded mode: the frame inside the portal's assessment dialog whose URL is on `origin`. */
async function frameOn(page: Page, origin: string): Promise<Frame> {
  const dialog = assessmentDialog(page);
  await expect(dialog.locator('iframe')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(origin)), { timeout: 60_000 }).toBe(true);
  const frame = page.frames().find((f) => f.url().startsWith(origin));
  if (!frame) throw new Error(`no frame on ${origin}`);
  return frame;
}

/** Embedded mode: leave the test through the frame's bar, which always asks first. */
async function leaveFrame(page: Page, shotName?: string): Promise<void> {
  await assessmentDialog(page).getByRole('button', { name: 'Salir', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: '¿Salir de la evaluación?' });
  await expect(confirm).toBeVisible();
  await expect(page.getByRole('button', { name: 'Seguir en la evaluación' })).toBeFocused();
  if (shotName) await shot(page, shotName);
  await confirm.getByRole('button', { name: 'Salir de la evaluación', exact: true }).click();
  await expect(assessmentDialog(page)).toHaveCount(0);
}

/** Where the sitting runs: the portal's frame (embedded) or the page itself (link-out). */
async function sittingSurface(page: Page, origin: string): Promise<Frame> {
  return st.embedded ? frameOn(page, origin) : page.mainFrame();
}

/** Consent (required texts, optional ones ticked or not), launch, and land on the hosted player. */
async function consentAndOpen(
  page: Page,
  instrument: string,
  optional: 'accept' | 'decline' | 'none',
  shots = false,
): Promise<void> {
  const item = portalItem(page, instrument);
  await expect(item).toBeVisible({ timeout: 60_000 });
  await item.getByRole('button', { name: 'Read the consent' }).click();
  if (shots) await shot(page, `candidate-${instrument}-consent`);
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
  // Embedded: the portal frames the player (or PCA's provider page, sandboxed). Link-out: the page itself goes there.
  if (st.embedded) await frameOn(page, instrument === 'pca' ? PCA_SURVEY : st.suite.playerOrigin);
  else if (instrument === 'pca') await page.waitForURL(/localhost:57480\/survey/, { timeout: 60_000 });
  else await page.waitForURL((u) => u.origin === st.suite.playerOrigin, { timeout: 60_000 });
}

// The distinct suite screens worth a walkthrough shot, per instrument (one shot per label, first time seen).
const SCREEN_SHOTS: Record<string, string[]> = {
  lia: [
    'subtest-intro',
    'practice-item',
    'practice-feedback-wrong',
    'practice-feedback-right',
    'practice-complete',
    'timed-item-omitir',
    'timed-item',
    'receipt',
  ],
  personality: ['item-page', 'receipt'],
  english: ['english-choice', 'english-reading', 'english-listening', 'section-break', 'english-speaking', 'receipt'],
};

async function sitAndReturn(page: Page, instrument: string, shots = false): Promise<string> {
  const surface = await sittingSurface(page, st.suite.playerOrigin);
  const start = surface.getByTestId('start-sitting');
  await start.waitFor({ timeout: 60_000 });
  // LIA: the general instructions; English: the welcome (sections + microphone check); Personality: its intro.
  if (shots) await shot(page, `player-${instrument}-start`);
  await start.click();
  const seen = new Set<string>();
  const wanted = SCREEN_SHOTS[instrument] ?? [];
  const report = await driveSitting(surface, {
    timeoutMs: 15 * 60_000,
    // Link-out: the player sends the candidate back. Embedded: the driver stops at the suite's receipt.
    leftPlayer: () => (st.embedded ? surface.isDetached() : page.url().startsWith(st.baseURL)),
    onScreen: async (label) => {
      if (!shots || seen.has(label)) return;
      const key = label.startsWith('item-') && instrument === 'personality' ? 'item-page' : label;
      if (!wanted.includes(key) || seen.has(key)) return;
      seen.add(label);
      seen.add(key);
      await shot(page, `player-${instrument}-${label}`);
    },
  });
  if (st.embedded) {
    // The frame stays open on the suite's receipt; its bar offers one way back, without a question.
    await expect(surface.getByTestId('sitting-ended')).toBeVisible();
    expect(report.screens).toContain('receipt');
    // The bar speaks the test's language (the assignment is es; the portal is en).
    const done = assessmentDialog(page).getByRole('button', { name: 'Volver a mis evaluaciones' });
    await expect(done).toBeVisible();
    await expect(assessmentDialog(page).getByRole('button', { name: 'Salir', exact: true })).toHaveCount(0);
    if (shots) await shot(page, `candidate-portal-receipt-done-button-${instrument}`);
    await done.click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(assessmentDialog(page)).toHaveCount(0);
  } else
    await page.waitForURL((u) => u.href.startsWith(`${st.baseURL}/careers/${st.orgSlug}/dashboard`), {
      timeout: 60_000,
    });
  // No reload or refocus: the dashboard re-reads until the result has arrived.
  await expect(portalItem(page, instrument).getByText('Completed', { exact: true })).toBeVisible({ timeout: 60_000 });
  if (shots && st.embedded) await shot(page, `candidate-portal-after-${instrument}`);
  if (shots && !st.embedded) await shot(page, `candidate-portal-after-${instrument}`);
  return JSON.stringify({ answers: report.answers, items: report.items, screens: report.screens });
}

test('H5 candidate A signs in (OTP), consents and completes LIA, Personality and English (no voice) in the hosted player, and PCA on the provider page', async ({
  browser,
}) => {
  const page = await persona(browser);
  await portalSignIn(page, candA.email);
  await expect(portalItem(page, 'pca')).toBeVisible({ timeout: 60_000 });
  await shot(page, 'candidate-portal-four-tests');
  const seen: string[] = [];
  for (const [instrument, optional] of [
    ['lia', 'none'],
    ['personality', 'none'],
    ['english', 'decline'],
  ] as const) {
    await consentAndOpen(page, instrument, optional, true);
    seen.push(`${instrument}: ${await sitAndReturn(page, instrument, true)}`);
  }
  // PCA: consent in the portal, then the provider's survey (link-out, same tab). The survey is created at the
  // provider on this launch (a billable AddSurvey in production), once per assignment.
  await consentAndOpen(page, 'pca', 'none', true);
  const survey = await sittingSurface(page, PCA_SURVEY);
  if (st.embedded) {
    // timssuite.com's PCA header over TIMS's own page, sandboxed (no popups).
    await expect(
      assessmentDialog(page).getByRole('heading', { name: 'Análisis de Competencias Personales (PCA)' }),
    ).toBeVisible();
    await expect(assessmentDialog(page).getByText('Completa el cuestionario a continuación')).toBeVisible();
    await expect(assessmentDialog(page).locator('iframe')).toHaveAttribute(
      'sandbox',
      'allow-forms allow-scripts allow-same-origin',
    );
  }
  await shot(page, 'pca-provider-survey');
  await survey.getByRole('button', { name: 'Completar el PCA' }).click();
  await expect(survey.getByText('PCA completado')).toBeVisible();
  await shot(page, 'pca-provider-completed');
  const sitting = suiteSql(
    st,
    `select status||'|'||coalesce(provider_sitting_status,'') from v1_assignments where external_ref=${sqlStr(attemptsA.pca)}`,
  );
  expect(sitting).toBe('in_progress|open');
  expect(
    suiteSql(
      st,
      `select count(*) from v1_provider_sittings where assignment_id=${sqlStr(providerAssignment(attemptsA.pca))}`,
    ),
  ).toBe('1');
  // TIMS's page sends no message (the dashboard polls it every 15 s): the candidate leaves, and the frame asks first.
  if (st.embedded) await leaveFrame(page, 'candidate-portal-leave-confirmation');
  else await page.goto(`/careers/${st.orgSlug}/dashboard`);
  await expect(portalItem(page, 'pca')).toBeVisible({ timeout: 60_000 });
  await shot(page, 'candidate-portal-after-pca');
  seen.push(
    `pca: suite assignment ${sitting} after the provider page (${st.embedded ? 'framed in the portal' : 'link-out'}; one provider sitting)`,
  );
  const consents = suiteSql(
    st,
    `select string_agg(distinct c.purpose, ',' order by c.purpose) from v1_consents c join v1_subjects s on s.id=c.subject_id where s.external_ref=${sqlStr(candidateA)} and c.withdrawn_at is null`,
  );
  expect(consents).toBe('assessment');
  for (const [instrument, id] of Object.entries(attemptsA))
    if (instrument !== 'pca')
      expect(suiteSql(st, `select status from v1_assignments where external_ref=${sqlStr(id)}`)).toBe('completed');
  expect(
    atsSql(
      st,
      `select declined_optional_consents::text from assessment_provider_attempts where id=${sqlStr(attemptsA.english)}`,
    ),
  ).toContain('voice');
  record(
    'H5 candidate sittings',
    `consents at the suite: ${consents}; the 3 native suite assignments completed, PCA open at the provider; each hosted sitting ended on the suite's receipt in the frame, "Back to my assessments" returned, and the dashboard showed Completed without a reload; ${seen.join(' | ')}`,
  );
});

test('H5b candidate C (lockdown + alert control): the LIA asks for full screen, and a tab switch draws the suite warning', async ({
  browser,
}) => {
  test.skip(!st.embedded, 'the lockdown overlay is checked in the embedded portal');
  const page = await persona(browser);
  await portalSignIn(page, candC.email);
  await consentAndOpen(page, 'lia', 'none');
  const surface = await sittingSurface(page, st.suite.playerOrigin);
  await surface.getByTestId('start-sitting').waitFor({ timeout: 60_000 });
  await surface.getByTestId('start-sitting').click();
  let overlayShot = false;
  const report = await driveSitting(surface, {
    timeoutMs: 10 * 60_000,
    leftPlayer: () => surface.isDetached(),
    onScreen: async (label) => {
      if (label !== 'lockdown-overlay' || overlayShot) return;
      overlayShot = true;
      await expect(surface.getByText('Pantalla Completa Requerida')).toBeVisible();
      await shot(page, 'player-lia-lockdown-overlay');
    },
    // Up to the first timed item: the suite draws its anti-cheat warning in the timed screen's notices.
    stopWhen: (_type, label) => label.startsWith('timed-item'),
  });
  expect(report.lockdownEntries, 'the candidate entered full screen at the suite overlay').toBeGreaterThan(0);
  expect(report.stoppedLabel).toMatch(/^timed-item/);
  expect(await surface.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await shot(page, 'player-lia-lockdown-timed-item');
  const assignment = providerAssignment(attemptsC.lia);
  const countable = () =>
    suiteSql(
      st,
      `select count(*) from v1_proctoring_events where assignment_id=${sqlStr(assignment)} and event_type='visibility_hidden'`,
    );
  const before = countable();
  // One tab switch. Headless Chromium never hides a page, so the frame's document reports the switch the way a
  // browser does (visibilityState hidden → visibilitychange, then visible again); the SDK reports it to the suite.
  await surface.evaluate(async () => {
    const set = (v: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    set('hidden');
    await new Promise((r) => setTimeout(r, 800));
    set('visible');
  });
  const warning = surface.getByTestId('anti-cheat-warning');
  await expect(warning).toBeVisible({ timeout: 30_000 });
  const warningText = (await warning.innerText()).trim();
  expect(warningText).not.toBe('');
  await shot(page, 'player-lia-anti-cheat-warning');
  await expect.poll(countable, { timeout: 30_000 }).not.toBe(before);
  const decision = suiteSql(
    st,
    `select status||'|'||coalesce(proctoring_decision,'none') from v1_assignments where id=${sqlStr(assignment)}`,
  );
  expect(decision).toBe('in_progress|none');
  // Out of full screen, the overlay asks again and the portal's bar is back; leaving asks first.
  await surface.evaluate(() => document.exitFullscreen());
  await expect(surface.locator('[data-testid="lockdown-overlay"]')).toBeVisible();
  await leaveFrame(page, 'candidate-portal-leave-confirmation-lockdown');
  await shot(page, 'candidate-c-portal-after-leaving');
  record(
    'H5b lockdown + alert control',
    `C's LIA: overlay entered ${report.lockdownEntries}x, ${report.synthetic} presses dispatched in full screen, screens ${report.screens.join('>')}; visibility_hidden events ${before} -> ${countable()}; warning shown: "${warningText.slice(0, 160)}"; suite assignment ${decision} (warn never ends the sitting)`,
  );
});

test('H6 the suite signs and delivers events (PCA: the scheduled poll finds it complete at the provider); the ATS verifies them and fetches every result', async () => {
  await expect
    .poll(
      async () => {
        // The scheduled run polls the provider for open PCA sittings (in production: the Vercel cron).
        await runSuiteCron(st);
        return atsSql(
          st,
          `select count(*) from assessment_provider_results where attempt_id in (${Object.values(attemptsA).map(sqlStr).join(',')})`,
        );
      },
      { timeout: 180_000, intervals: [5_000] },
    )
    .toBe('4');
  const pcaResult = suiteSql(
    st,
    `select a.status||'|'||coalesce(a.provider_sitting_status,'')||'|'||r.result_schema from v1_assignments a join v1_results r on r.assignment_id=a.id where a.external_ref=${sqlStr(attemptsA.pca)}`,
  );
  expect(pcaResult).toBe('completed|completed|PcaResultV1');
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
  record(
    'H6 events + results',
    `ATS inbox: ${inbox}; suite deliveries status: ${delivered}; attempts: ${states}; PCA at the suite: ${pcaResult}`,
  );
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
  // TIMS's job fit for 194225 (the stand-in answers Res 78), sent with the assignment and copied by the suite.
  // The PCA result is the last to arrive (the scheduled poll, H6); its recompute drains asynchronously.
  const pcaQuery = () => atsSql(
    st,
    `select (e->>'use')||'|'||(e->>'status')||'|'||coalesce(e->>'score','null')||'|'||coalesce(e->>'jobCode','null') from fit_scores f, jsonb_array_elements(f.breakdown->'assessments') e where f.candidate_id=${sqlStr(candidateA)} and f.vacancy_id=${sqlStr(vacancy.id)} and e->>'instrument'='pca'`,
  );
  await expect.poll(pcaQuery, { timeout: 120_000, intervals: [2_000] }).toBe('scored|completed|78|194225');
  const pcaEntry = pcaQuery();
  const suiteFit = suiteSql(
    st,
    `select a.vacancy_job_code||'|'||(p.job_fit->>'status')||'|'||(p.job_fit->>'fit') from v1_assignments a join v1_pca_results p on p.assignment_id=a.id where a.external_ref=${sqlStr(attemptsA.pca)}`,
  );
  expect(suiteFit).toBe('194225|computed|78');
  record(
    'H7 FIT v2',
    `${overall}; PCA (scored on TIMS's job fit) in the breakdown: ${pcaEntry}; at the suite: ${suiteFit}; breakdown (first 700 chars): ${breakdown.slice(0, 700)}`,
  );
});

test('H8 HR reads each result on the candidate (exact levels; PCA advisory)', async ({ browser }) => {
  const hr = await persona(browser);
  await staffSignIn(hr, 'hr@tims.co', st.staffPassword);
  await hr.goto(`/recruitment/candidates/${candidateA}`);
  const card = hr.getByRole('region', { name: 'TIMS Assessments' });
  const lia = card.getByTestId('provider-attempt').filter({ hasText: 'LIA' });
  const english = card.getByTestId('provider-attempt').filter({ hasText: 'English' });
  const pca = card.locator('[data-testid="provider-attempt"][data-instrument="pca"]');
  await expect(lia.getByTestId('provider-status-chip')).toHaveText(/Result ready|Needs review/, { timeout: 60_000 });
  await expect(pca.getByTestId('provider-status-chip')).toHaveText('Result ready', { timeout: 60_000 });
  await expect(pca.getByTestId('provider-result')).toBeVisible();
  await expect(lia.getByText(/Global percentile \d+/)).toBeVisible();
  await expect(english.getByText('Speaking not assessed (no voice consent).')).toBeVisible();
  await expect(english.getByTestId('provider-result-minimum')).toHaveText(/Below minimum|Minimum met|Minimum: unknown/);
  await card.scrollIntoViewIfNeeded();
  await shot(hr, 'hr-candidate-results');
  record(
    'H8 HR view',
    `LIA: ${await lia.innerText()} || English: ${await english.innerText()} || PCA: ${await pca.innerText()}`
      .replace(/\s+/g, ' ')
      .slice(0, 800),
  );
  // The results board (Assessments tab): every result drawn from the profile the C# read returns to HR.
  await hr.goto(`/recruitment/candidates/${candidateA}?tab=tabAssessments`);
  await expect(hr.getByRole('heading', { name: 'Results', level: 2 })).toBeVisible({ timeout: 60_000 });
  const board = (name: RegExp) => hr.getByRole('region', { name });
  await expect(board(/^LIA/).getByLabel(/^Pattern recognition: percentile/)).toBeVisible();
  // Locally the listening clips come from the suite's public fallback (no S3), so the suite publishes English as
  // needs_review (human_review_required, english-session.ts); the board then shows the review state, not the scores.
  if (resultValidity(attemptsA.english) === 'needs_review')
    await expect(
      board(/^English/).getByText('TIMS is reviewing this result. It is not shown until the review ends.'),
    ).toBeVisible();
  else await expect(board(/^English/).getByText(/% correct$/)).toBeVisible();
  await expect(board(/^Personality/).getByLabel(/^Energy: /)).toBeVisible();
  await expect(board(/^PCA/).getByText('Primary')).toBeVisible();
  // TIMS 2026-11-12: TIMS's fit to the vacancy's position (the stand-in answers 78 for 194225).
  const jobFit = board(/^PCA/).getByRole('region', { name: 'Fit to the position (TIMS)' });
  await expect(jobFit).toContainText('78%');
  await expect(jobFit).toContainText('Position code 194225');
  await expect(board(/^PCA/).getByLabel(/^Behavior Under Pressure: Dominance \d+/)).toBeVisible();
  await shot(hr, 'hr-candidate-results-board');
  // HR PDF reports (reports:read): the results report of a native test, rendered by the suite, and TIMS's own PCA
  // reports (the stand-in serves one PDF for every variant), each saved through the ATS relay.
  const saveReport = async (region: RegExp, item: string) => {
    const card = board(region);
    await card.getByRole('button', { name: 'PDF reports' }).click();
    const option = card.getByRole('button', { name: item });
    await expect(option).toBeVisible({ timeout: 30_000 });
    const [download] = await Promise.all([hr.waitForEvent('download', { timeout: 60_000 }), option.click()]);
    const saved = await download.path();
    return { name: download.suggestedFilename(), head: readFileSync(saved).subarray(0, 5).toString('latin1') };
  };
  const liaReport = await saveReport(/^LIA/, 'Results report');
  expect(liaReport).toEqual({ name: 'tims-lia.pdf', head: '%PDF-' });
  const pcaReport = await saveReport(/^PCA/, 'Informe PCA');
  expect(pcaReport).toEqual({ name: 'tims-pca-pca.pdf', head: '%PDF-' });
  const downloads = atsSql(
    st,
    `select count(*) from audit_logs where action='assessment_provider_report_downloaded' and entity_id in (${sqlStr(attemptsA.lia)}, ${sqlStr(attemptsA.pca)})`,
  );
  expect(downloads).toBe('2');
  record('H8 PDF reports', `${liaReport.name} (suite-rendered) and ${pcaReport.name} (TIMS variant via the stand-in), ${downloads} audit rows`);
  if (shotsDir) {
    await hr.goto(`/recruitment/candidates/${candidateA}?tab=tabFitGaps`);
    await hr.waitForLoadState('networkidle').catch(() => undefined);
    await shot(hr, 'hr-candidate-fit');
  }
});

test('H9 a team leader sees only "below minimum" for a gated result, never the level (D6)', async ({ browser }) => {
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
  // English is under review locally (see H8): then the D6 check runs on the LIA (scored, minimum 40), whose exact
  // percentile HR sees and a team leader must not.
  const gated = resultValidity(attemptsA.english) === 'needs_review' ? 'LIA' : 'English';
  const leader = await persona(browser);
  await staffSignIn(leader, 'leader@tims.co', st.staffPassword);
  await leader.goto(`/recruitment/candidates/${candidateA}`);
  const card = leader.getByRole('region', { name: 'TIMS Assessments' });
  const row = card.getByTestId('provider-attempt').filter({ hasText: gated });
  await expect(row.getByTestId('provider-result-minimum')).toHaveText('Below minimum', { timeout: 60_000 });
  await expect(row.getByTestId('provider-result-level')).toHaveCount(0);
  if (english) await expect(row.getByText(`CEFR ${english}`)).toHaveCount(0);
  await expect(row.getByText(/Global percentile/)).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  await shot(leader, 'leader-candidate-results');
  // D6: a report is the full interpretation, so the leader's board offers none.
  await leader.goto(`/recruitment/candidates/${candidateA}?tab=tabAssessments`);
  await expect(leader.getByRole('heading', { name: 'Results', level: 2 })).toBeVisible({ timeout: 60_000 });
  await expect(leader.getByRole('button', { name: 'PDF reports' })).toHaveCount(0);
  record(
    'H9 D6 team leader',
    `owner SQL leader_assessment_read.sql granted ${granted.split('\n').find((l) => l.includes('|')) ?? 'nothing'}; leader ${leaderId} sees "Below minimum" for ${gated} (HR's exact ${gated === 'LIA' ? 'global percentile' : `CEFR ${english || 'n/a'}`} hidden)`,
  );
});

// ---- candidate B: voice consent, cancel, expiry, withdrawal -----------------------------------------

test('H10 candidate B gives the optional voice consents for English; the sitting offers the speaking section', async ({
  browser,
}) => {
  const page = await persona(browser);
  await portalSignIn(page, candB.email);
  await consentAndOpen(page, 'english', 'accept');
  const surface = await sittingSurface(page, st.suite.playerOrigin);
  await surface.getByTestId('start-sitting').click({ timeout: 60_000 });
  const report = await driveSitting(surface, {
    timeoutMs: 15 * 60_000,
    leftPlayer: () => !st.embedded && page.url().startsWith(st.baseURL),
    stopWhen: (type) => type === 'audio_record',
  });
  const consents = suiteSql(
    st,
    `select string_agg(distinct c.purpose, ',' order by c.purpose) from v1_consents c join v1_subjects s on s.id=c.subject_id where s.external_ref=${sqlStr(candidateB)} and c.withdrawn_at is null`,
  );
  expect(consents).toBe('ai_scoring,assessment,voice');
  expect(report.stoppedAt, 'the English sitting reached its speaking item').toBe('audio_record');
  await shot(page, 'player-english-speaking-item');
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
  await card.scrollIntoViewIfNeeded();
  await shot(hr, 'hr-english-cancelled');
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
  await shot(page, 'candidate-consent-revoked');
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
  const pca = suiteSql(
    st,
    `select status||'|'||coalesce(provider_sitting_status,'none') from v1_assignments where external_ref=${sqlStr(attemptsB.pca)}`,
  );
  expect(pca).toMatch(/^(cancelled|voided)\|/);
  record(
    'H13 withdrawal',
    `every suite consent of B withdrawn; B's open LIA assignment ${lia}; B's unlaunched PCA ${pca}; ATS withdrawal_state ${atsSql(st, `select coalesce(withdrawal_state,'') from assessment_provider_attempts where id=${sqlStr(attemptsB.lia)}`)}`,
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
  // PCA has no provider deletion API: the erasure records the provider's reference for the manual deletion (runbook).
  const pcaDeletion = suiteSql(
    st,
    `select count(*) from v1_audit_log where action='provider_deletion_required' and target_id=${sqlStr(providerAssignment(attemptsA.pca))}`,
  );
  expect(pcaDeletion).toBe('1');
  const states = Object.values(attemptsA)
    .map((id) => attemptStatus(id))
    .join(',');
  record(
    'H14 DSAR',
    `export 200 (${text.length} bytes, includes the provider subject ${subject} and its assignments); erasure 202; suite erasure ${erasure} after the drain; subject.erased verified and processed by the ATS; PCA provider_deletion_required audited (${pcaDeletion}); ATS attempts now ${states}; provider results left at the ATS: ${atsSql(st, `select count(*) from assessment_provider_results where attempt_id in (${Object.values(attemptsA).map(sqlStr).join(',')})`)}`,
  );
});
