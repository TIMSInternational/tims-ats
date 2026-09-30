import { test, expect, type Page } from '@playwright/test';
import { loadJourney, type JourneyState } from '../../lib/journey';
import { newPersona, signIn, closePersona, type Persona } from '../../lib/persona';
import { waitForMail, linkContaining } from '../../lib/mail';
import { needs, supersededBy, PENDING } from '../../lib/pending';
import { tinyPdf } from '../../lib/files';

/**
 * Candidate journey: a person finds the vacancy the company journey published, applies, and is
 * taken through pipeline → interview → offer → signature → hire → onboarding by the company's staff.
 *
 * Runs after the `company` project (playwright.config.ts) and reuses its company, staff and vacancy.
 * No AI and no video: the interview is in person, AI buttons are never pressed.
 */
test.describe.configure({ mode: 'serial' });

let j: JourneyState;
let candidate: Persona;
let recruiter: Persona;
let admin: Persona;
let leader: Persona;
let profileUrl: string;
let signingLink: string;
let interviewId: string;
// Per-ATTEMPT candidate identity: a serial-mode retry re-runs beforeAll and the whole describe, and
// must not collide with the application/email the failed attempt already created (the company
// project suffixes its identities the same way — lib/journey.ts newJourney).
let candId: string;

const cand = () => ({
  firstName: 'Sofía',
  lastName: `Herrera E2E ${candId}`,
  email: `sofia.${candId}@e2e-candidata.test`,
});
const fullName = () => `${cand().firstName} ${cand().lastName}`;

test.beforeAll(async ({ browser }, testInfo) => {
  j = loadJourney();
  candId = testInfo.retry > 0 ? `${j.runId}c${testInfo.retry}` : j.runId;
  if (!j.vacancy) throw new Error('[e2e] the company journey did not publish a vacancy');
  candidate = await newPersona(browser);
  recruiter = await newPersona(browser);
  admin = await newPersona(browser);
  leader = await newPersona(browser);
  await signIn(recruiter.page, j.recruiter);
  await signIn(admin.page, j.admin);
  await signIn(leader.page, j.leader);
});

test.afterAll(async () => {
  await Promise.all([candidate, recruiter, admin, leader].map(closePersona));
});

test('careers page lists the published vacancy', async () => {
  const { page } = candidate;
  await page.goto(`/careers/${j.orgSlug}`);
  await page.getByText(j.vacancy!.title).first().click();
  await expect(page).toHaveURL(new RegExp(`/careers/${j.orgSlug}/${j.vacancy!.id}`));
  await expect(page.getByRole('heading', { name: j.vacancy!.title })).toBeVisible();
});

/** Fill the three-step apply form. `cv` attaches a PDF. */
async function apply(page: Page, { cv }: { cv: boolean }): Promise<void> {
  await page.goto(`/careers/${j.orgSlug}/${j.vacancy!.id}`);
  await page.getByRole('button', { name: 'Aplicar ahora' }).first().click();
  const form = page.getByRole('dialog', { name: `Aplicar a ${j.vacancy!.title}` });

  await form.getByPlaceholder('Maria', { exact: true }).fill(cand().firstName);
  await form.getByPlaceholder('Lopez Rodriguez').fill(cand().lastName);
  await form.getByPlaceholder('maria.lopez@gmail.com').fill(cand().email);
  await form.getByPlaceholder('+57 310 123 4567').fill('+57 300 555 0101');
  await form.getByPlaceholder('Bogotá, Colombia').fill('Envigado, Colombia');
  await form.getByRole('button', { name: 'Siguiente' }).click();

  await form.getByPlaceholder('Analista de Recursos Humanos').fill('Analista de Logística');
  await form.getByPlaceholder('Empresa ABC').fill('Transportes del Valle');
  await form.locator('textarea').fill('E2E — 5 años coordinando despachos e inventarios.');
  if (cv) {
    await form
      .locator('input[type=file]')
      .setInputFiles({ name: 'cv-sofia.pdf', mimeType: 'application/pdf', buffer: tinyPdf() });
  }
  await form.getByRole('button', { name: 'Siguiente' }).click();

  const submit = form.getByRole('button', { name: /enviar aplicaci[oó]n/i });
  if (PENDING.explicitConsent.merged) {
    // #302: explicit, unticked-by-default consent — no consent, no application.
    await expect(submit).toBeDisabled();
    await form.getByRole('checkbox').check();
  }
  await submit.click();
  await expect(page.getByText(/aplicaci[oó]n enviada/i)).toBeVisible({ timeout: 45_000 });
}

test('candidate applies with a CV upload and explicit consent', async () => {
  needs('cvUploadCsp', 'explicitConsent');
  await apply(candidate.page, { cv: true });
});

test('candidate applies without a CV (main-only path)', async () => {
  supersededBy('cvUploadCsp', 'explicitConsent');
  await apply(candidate.page, { cv: false });
});

test('candidate receives the "application received" email', async () => {
  needs('candidateEmails');
  const mail = await waitForMail(cand().email, /postulaci|aplicaci|recibid/i);
  expect(mail.text).toContain(j.vacancy!.title);
});

test('recruiter sees the application in the pipeline and opens the candidate', async () => {
  const { page } = recruiter;
  await page.goto('/recruitment/pipeline');
  await page.getByText(fullName()).first().click();
  await expect(page).toHaveURL(/\/recruitment\/candidates\/[0-9a-f-]{36}/);
  profileUrl = page.url();
  await expect(page.getByRole('heading', { name: fullName() })).toBeVisible();
});

/** On the candidate profile: move the (only) application to `stage`. */
async function moveStage(page: Page, stage: string): Promise<void> {
  await page.goto(profileUrl);
  await page.getByRole('button', { name: 'Mover Etapa' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Mover Etapa' });
  await dialog.getByLabel('Mover a etapa').selectOption({ label: stage });
  await dialog.getByRole('button', { name: 'Mover Etapa' }).click();
  await expect(dialog).toBeHidden();
}

test('recruiter moves the candidate through screening to the HR interview stage', async () => {
  await moveStage(recruiter.page, 'Screening');
  await moveStage(recruiter.page, 'Entrevista RRHH');
  await recruiter.page.reload();
  await expect(recruiter.page.getByText('Entrevista RRHH', { exact: true }).first()).toBeVisible();
});

/** Schedule an in-person interview (never video — no Daily in E2E) with the leader as evaluator. */
async function scheduleInterview(page: Page): Promise<void> {
  await page.goto('/recruitment/interviews');
  await page
    .getByRole('button', { name: /programar entrevista/i })
    .first()
    .click();
  const wizard = page.getByRole('dialog', { name: 'Agendar Entrevista' });
  await wizard.getByPlaceholder('Buscar por nombre o email...').fill(cand().lastName);
  await wizard
    .getByRole('button', { name: new RegExp(fullName()) })
    .first()
    .click();
  await wizard
    .getByRole('button', { name: new RegExp(j.vacancy!.title.replace(/[()]/g, '\\$&')) })
    .first()
    .click();
  await wizard.getByRole('button', { name: 'Siguiente' }).click();

  await wizard.getByRole('button', { name: /presencial/i }).click();
  const when = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  await wizard.locator('input[type=date]').fill(when);
  await wizard.locator('input[type=time]').fill('10:00');
  await wizard.getByPlaceholder('Oficina Bogota, Sala 3A').fill('Oficina Medellín, Sala 2');
  await wizard.getByRole('button', { name: 'Siguiente' }).click();

  await wizard.getByText(`${j.leader.firstName} ${j.leader.lastName}`).first().click();
  await wizard.getByRole('button', { name: 'Agendar Entrevista' }).click();
  await expect(wizard).toBeHidden();

  const row = page.getByRole('row', { name: new RegExp(fullName()) }).first();
  const room = await row.getByRole('link', { name: 'Unirse' }).getAttribute('href');
  interviewId = /\/recruitment\/interviews\/([0-9a-f-]{36})\/room/.exec(room ?? '')?.[1] ?? '';
  expect(interviewId, 'scheduled interview row links to its room').not.toBe('');
}

test('recruiter schedules an in-person interview with the hiring leader as evaluator', async () => {
  needs('peopleDirectory');
  await scheduleInterview(recruiter.page);
});

test('company admin schedules the interview (main-only path)', async () => {
  supersededBy('peopleDirectory');
  await scheduleInterview(admin.page);
});

test('candidate receives the interview invitation email', async () => {
  const mail = await waitForMail(cand().email, /entrevista/i);
  // The interview-specific location, not just the city — 'Medellín' alone is already in the vacancy.
  expect(mail.text).toContain('Sala 2');
});

test('hiring leader submits a scorecard from the interview room', async () => {
  needs('scorecards');
  const { page } = leader;
  // The merged room (#303, room/page.tsx) renders the scorecard ONLY in the in-call view, i.e. after
  // "Unirse a la entrevista" → interview.createVideoRoom succeeds — even for an in-person interview.
  // That procedure needs a Daily API key, which the E2E stack deliberately does not have (it answers
  // PRECONDITION_FAILED), so the scorecard would be unreachable. Stand in for Daily at exactly that
  // one boundary: answer createVideoRoom with a room URL on a daily.co host. Every browser request to
  // Daily is aborted (lib/persona.ts), so the call fails into the room's join-error panel while the
  // scorecard panel — the thing under test — renders and submits through the REAL
  // interview.submitScorecard. Everything else on the page is unstubbed.
  await page.route(
    (url) => url.pathname === '/api/trpc/interview.createVideoRoom',
    (route) =>
      route.fulfill({
        json: [
          {
            result: {
              data: { json: { url: 'https://e2e-stub.daily.co/e2e-room', token: 'e2e-stub', roomName: 'e2e-room' } },
            },
          },
        ],
      }),
  );
  await page.goto(`/recruitment/interviews/${interviewId}/room`);
  await page.getByRole('button', { name: 'Unirse a la entrevista' }).click();

  const panel = page.getByRole('tabpanel', { name: 'Scorecard' });
  const submit = panel.getByRole('button', { name: 'Enviar scorecard' });
  // The form shows skeletons until the job profile + any stored scorecard load; the submit button
  // only exists once it has, so the rating groups below are the final set.
  await expect(submit).toBeDisabled();
  const groups = await panel.getByRole('radiogroup').all();
  expect(groups.length, 'the scorecard lists at least one competency').toBeGreaterThan(0);
  for (const stars of groups) {
    await stars.getByRole('radio', { name: '4 de 5' }).click();
  }
  await expect(panel.getByText(`${groups.length} de ${groups.length} competencias evaluadas`)).toBeVisible();
  // RecommendationPicker: native radios (visually hidden) inside their <label>s.
  await panel.getByRole('group', { name: 'Recomendación' }).getByText('Contratar', { exact: true }).click();
  await expect(panel.getByRole('radio', { name: 'Contratar', exact: true })).toBeChecked();

  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('Scorecard enviado.')).toBeVisible();
  // Persisted, not just toasted: after the refetch the form reports the stored submission.
  await expect(panel.getByRole('status').filter({ hasText: /^Enviado el / })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Actualizar scorecard' })).toBeVisible();
});

test('recruiter moves the candidate to Oferta and drafts an offer', async () => {
  await moveStage(recruiter.page, 'Entrevista Final');
  await moveStage(recruiter.page, 'Oferta');
  const { page } = recruiter;
  await page.getByRole('button', { name: 'Crear borrador de oferta' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear borrador de oferta' });
  await dialog.getByLabel(/salario base/i).fill('96000000');
  const start = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  await dialog.getByLabel('Fecha Inicio').fill(start);
  await dialog.getByLabel('Tipo Contrato').fill('Término indefinido');
  await dialog.getByRole('button', { name: 'Crear borrador de oferta' }).click();
  await expect(dialog).toBeHidden();
});

/** Open this candidate's offer from the offers list. */
async function openOffer(page: Page): Promise<void> {
  await page.goto('/recruitment/offers');
  await page.getByText(fullName()).first().click();
  await expect(page.getByText(fullName()).first()).toBeVisible();
}

/** Request approval from `approverName`, then approve as `approverPage`. */
async function approveOffer(requester: Page, approverName: string, approverPage: Page): Promise<void> {
  await openOffer(requester);
  if (PENDING.peopleDirectory.merged) {
    // #304 replaces the approver <select> with a server-searched people picker.
    // The app header has its own 'Buscar...' box; the picker lives in the page's main region.
    await requester.getByRole('main').getByPlaceholder('Buscar...').fill(approverName.split(' ')[0]);
    await requester
      .getByRole('button', { name: new RegExp(approverName) })
      .first()
      .click();
  } else {
    await requester.getByLabel('Aprobador').selectOption({ label: approverName });
  }
  await requester.getByRole('button', { name: 'Solicitar aprobación' }).click();
  // Wait for the request to land (the offer leaves Borrador) before anyone navigates away —
  // otherwise a fast navigation can abort the mutation (seen when requester and approver are one page).
  await expect(requester.getByText('Pendiente', { exact: true }).first()).toBeVisible();
  await openOffer(approverPage);
  const approved = approverPage.getByText('Aprobada', { exact: true });
  await expect(approved).toHaveCount(0);
  await approverPage.getByRole('button', { name: 'Aprobar', exact: true }).click();
  await expect(approved.first()).toBeVisible();
}

test('recruiter requests offer approval; the hiring leader approves', async () => {
  needs('peopleDirectory', 'orgStructure');
  await approveOffer(recruiter.page, `${j.leader.firstName} ${j.leader.lastName}`, leader.page);
});

test('company admin requests and gives offer approval (main-only path)', async () => {
  supersededBy('peopleDirectory', 'orgStructure');
  await approveOffer(admin.page, `${j.admin.firstName} ${j.admin.lastName}`, admin.page);
});

test('the approved offer is sent for signature; the candidate receives the signing link', async () => {
  const { page } = admin;
  await openOffer(page);
  await page.getByRole('button', { name: 'Enviar para Firma' }).click();
  await expect(page.getByText('Enlace de firma activo')).toBeVisible();
  const mail = await waitForMail(cand().email, /oferta/i);
  signingLink = linkContaining(mail, '/offers/sign/');
  expect(new URL(signingLink).hostname).toBe('localhost');
});

test('candidate signs the offer on the public signing page', async () => {
  needs('offerSigningPublic');
  const { page } = candidate; // never signed in: the token in the link is the only credential
  await page.goto(signingLink);
  await page.getByRole('checkbox').check();
  await page.getByPlaceholder('Ingresa tu nombre completo').fill(fullName());
  await page.getByRole('button', { name: 'Aceptar Oferta' }).click();
  await expect(page.getByText(/oferta aceptada/i)).toBeVisible();
});

test('company admin authorizes the hire; the new employee has an onboarding plan', async () => {
  needs('offerSigningPublic');
  const { page } = admin;
  await openOffer(page);
  await page.getByRole('button', { name: /autorizar contrataci[oó]n/i }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirmar ingreso del colaborador' });
  await dialog.getByRole('button', { name: 'Crear colaborador y plan' }).click();
  await expect(page.getByText('Colaborador y plan de onboarding creados')).toBeVisible();
  await page.goto('/people/onboarding');
  await expect(page.getByText(fullName()).first()).toBeVisible();
});

test('the onboarding plan starts with the default task template', async () => {
  needs('offerSigningPublic', 'onboardingDefaults');
  // #309 seeds a 12-task default checklist (DEFAULT_ONBOARDING_TASKS) on hire handoff.
  const { page } = admin;
  await page.goto('/people/onboarding');
  await page
    .getByRole('row', { name: new RegExp(fullName()) })
    .getByRole('button', { name: 'Ver tareas' })
    .click();
  // The first task also appears in the row's "next task" summary; the expanded list renders each task as a
  // labelled checkbox, so assert on those.
  const task = (title: string) => page.getByRole('checkbox', { name: title, exact: true });
  await expect(task('Firmar contrato y documentos de ingreso')).toBeVisible();
  await expect(task('Revisión de objetivos de 90 días y cierre del onboarding')).toBeVisible();
});
