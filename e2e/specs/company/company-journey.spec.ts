import { test, expect, type Page } from '@playwright/test';
import { provisionRunOwner, runOwnerCredentials } from '../../lib/owner';
import { readStack } from '../../lib/stack';
import { newJourney, saveJourney, type JourneyState } from '../../lib/journey';
import { newPersona, signIn, closePersona, type Persona } from '../../lib/persona';
import { waitForMail, linkContaining } from '../../lib/mail';
import { needs, supersededBy, PENDING } from '../../lib/pending';

/**
 * Company journey: a platform owner onboards a new company, the company staffs itself, and a
 * recruiter's vacancy goes through approval to publication on the careers site.
 *
 * Serial: each step builds on the previous one, exactly like the real onboarding. Everything is
 * created through the UI under test; emails are read from LocalStack SES.
 */
test.describe.configure({ mode: 'serial' });

let j: JourneyState;
let owner: Persona;
let admin: Persona;
let recruiter: Persona;
let leader: Persona;

const UNIT = 'Operaciones';
const TEAM = 'Logística';

test.beforeAll(async ({ browser }, testInfo) => {
  j = newJourney(testInfo.retry);
  saveJourney(j);
  // Precondition, not under test: this attempt's own platform owner (lib/owner.ts explains why).
  await provisionRunOwner(readStack(), j.runId);
  owner = await newPersona(browser);
  admin = await newPersona(browser);
  recruiter = await newPersona(browser);
  leader = await newPersona(browser);
});

test.afterAll(async () => {
  await Promise.all([owner, admin, recruiter, leader].map(closePersona));
});

/** Platform owner: invite `email` into the journey's company with the given role label. */
async function platformInvite(page: Page, email: string, roleLabel: RegExp): Promise<void> {
  await page.goto('/platform/invitations');
  await page.getByRole('button', { name: /^invitar usuario$/i }).click();
  const form = page.locator('form').filter({ has: page.getByPlaceholder('usuario@empresa.com') });
  await form.getByPlaceholder('usuario@empresa.com').fill(email);
  await form.getByPlaceholder(/buscar organizaci[oó]n/i).fill(j.orgSlug);
  await form.getByRole('button', { name: new RegExp(j.orgSlug) }).click();
  const role = form.locator('select');
  await expect(role.locator('option', { hasText: roleLabel })).toHaveCount(1);
  const value = await role.locator('option', { hasText: roleLabel }).getAttribute('value');
  await role.selectOption(value!);
  await form.getByRole('button', { name: /^enviar invitaci[oó]n$/i }).click();
  await expect(form).toBeHidden();
}

/** Invitee: open the emailed link, create the account, land in the app. */
async function acceptInvitation(page: Page, who: JourneyState['admin']): Promise<void> {
  const mail = await waitForMail(who.email, /invitaci/i);
  await page.goto(linkContaining(mail, '/accept-invitation'));
  await page.getByLabel('Nombre', { exact: true }).fill(who.firstName);
  await page.getByLabel('Apellido', { exact: true }).fill(who.lastName);
  await page.getByLabel('Contraseña', { exact: true }).fill(who.password);
  await page.getByLabel('Confirmar contraseña', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Crear cuenta y unirme' }).click();
  await expect(page.getByRole('heading', { name: 'Tu acceso está listo' })).toBeVisible({ timeout: 45_000 });
}

test('platform owner creates the company', async () => {
  const { page } = owner;
  await signIn(page, runOwnerCredentials(j.runId));
  await page.goto('/platform/organizations');
  await page.getByRole('button', { name: /nueva organizaci[oó]n/i }).click();
  const form = page.locator('form').filter({ has: page.getByPlaceholder('constructora-bolivar') });
  await form.getByPlaceholder(/constructora bol[ií]var/i).fill(j.orgName);
  await form.getByPlaceholder('constructora-bolivar').fill(j.orgSlug);
  await form.locator('select').selectOption('professional');
  // #307: this field is the billing email only; the admin is invited separately (next test).
  await form.getByLabel('Email de Facturación').fill(j.admin.email);
  await form.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(form).toBeHidden();

  await page.getByPlaceholder(/buscar organizaci[oó]n/i).fill(j.orgSlug);
  await expect(page.getByText(j.orgName).first()).toBeVisible();
});

test('platform owner invites the company admin; the invitation arrives by email', async () => {
  await platformInvite(owner.page, j.admin.email, /super administrador/i);
  const mail = await waitForMail(j.admin.email, /invitaci/i);
  expect(mail.text).toContain(j.orgName);
  expect(linkContaining(mail, '/accept-invitation')).toMatch(/^https:\/\/localhost:\d+\/accept-invitation/);
});

test('company admin accepts the invitation, sets a password and can sign in with it', async () => {
  const { page } = admin;
  await acceptInvitation(page, j.admin);
  await page.getByRole('link', { name: 'Ir a TIMS ATS' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // The password chosen during setup is the one that works from now on.
  await admin.context.clearCookies();
  await signIn(page, j.admin);
  await expect(page).not.toHaveURL(/\/login/);
});

test('company admin invites the recruiter and the hiring leader from the team page', async () => {
  needs('tenantInvitations');
  // Written against #307's Equipo page (settings/users/invite-form.tsx on feat/tenant-team-invitations).
  const { page } = admin;
  await page.goto('/settings/users');
  for (const [who, role] of [
    [j.recruiter, 'Reclutador'],
    [j.leader, 'Lider'],
  ] as const) {
    await page.getByLabel('Email', { exact: true }).fill(who.email);
    await page.getByLabel('Rol', { exact: true }).selectOption({ label: role });
    await page.getByRole('button', { name: 'Enviar invitación' }).click();
    await expect(page.getByText('Invitación enviada.').first()).toBeVisible();
  }
});

test('platform owner invites the recruiter and the hiring leader (main-only path)', async () => {
  supersededBy('tenantInvitations');
  await platformInvite(owner.page, j.recruiter.email, /reclutador/i);
  await platformInvite(owner.page, j.leader.email, /l[ií]der/i);
});

test('recruiter and hiring leader accept their invitations', async () => {
  // Accepting signs the invitee in, so each lands in the app with a live session.
  for (const [p, who] of [
    [recruiter, j.recruiter],
    [leader, j.leader],
  ] as const) {
    await acceptInvitation(p.page, who);
    await p.page.getByRole('link', { name: 'Ir a TIMS ATS' }).click();
    await expect(p.page).toHaveURL(/\/dashboard/);
  }
});

test('company admin sets up a business unit whose team is led by the hiring leader', async () => {
  needs('orgStructure');
  // Written against #310's /settings/business-units manager. A team leader is who approves the team's
  // vacancies and offers (leader grants are team-scoped), so this is what makes the leader an approver.
  const { page } = admin;
  await page.goto('/settings/business-units');
  await page.getByRole('button', { name: 'Nueva unidad' }).click();
  const unit = page.getByRole('dialog', { name: 'Nueva unidad' });
  await unit.getByLabel('Nombre', { exact: true }).fill(UNIT);
  await unit.getByRole('button', { name: 'Guardar' }).click();
  await expect(unit).toBeHidden();

  await page.getByRole('button', { name: 'Nuevo equipo' }).first().click();
  const team = page.getByRole('dialog', { name: 'Nuevo equipo' });
  await team.getByLabel('Nombre', { exact: true }).fill(TEAM);
  await team.getByRole('button', { name: 'Guardar' }).click();
  await expect(team).toBeHidden();

  await page.getByRole('button', { name: 'Asignar líder' }).first().click();
  const picker = page.getByRole('dialog');
  await picker.getByPlaceholder('Buscar por nombre o email...').fill(j.leader.firstName);
  await picker
    .getByRole('button', { name: new RegExp(`${j.leader.firstName} ${j.leader.lastName}`) })
    .first()
    .click();
  await expect(page.getByText(`${j.leader.firstName} ${j.leader.lastName}`).first()).toBeVisible();
});

test('recruiter creates a vacancy with the wizard (no AI)', async () => {
  const { page } = recruiter;
  const title = `Coordinador(a) de Logística E2E ${j.runId}`;
  await page.goto('/recruitment/vacancies');
  await page.getByRole('button', { name: /nueva vacante/i }).click();
  const wizard = page.getByRole('dialog', { name: 'Crear nueva vacante' });

  // Step 1 — basic info
  await wizard.getByPlaceholder('Ej: Senior Software Engineer').fill(title);
  await wizard.getByPlaceholder('Bogotá, Colombia').fill('Medellín, Colombia');
  await wizard.getByRole('button', { name: 'Presencial' }).click();
  if (PENDING.orgStructure.merged) {
    // #310: the vacancy is placed in the team whose leader approves it.
    await wizard.getByLabel('Unidad de negocio').selectOption({ label: UNIT });
    await wizard.getByLabel('Equipo', { exact: true }).selectOption({ label: TEAM });
  }
  await wizard.getByRole('button', { name: 'Siguiente' }).click();

  // Step 2 — description, typed by hand (the "Generar con IA" button is never pressed: no Bedrock in E2E)
  const areas = wizard.locator('textarea');
  await areas.nth(0).fill('E2E — Coordinarás la operación logística regional: inventarios, despachos y transporte.');
  await areas.nth(1).fill('- Planear rutas y despachos diarios\n- Gestionar inventario en bodega');
  await areas.nth(2).fill('- 3+ años en logística o cadena de suministro\n- Excel avanzado');
  await wizard.getByRole('button', { name: 'Siguiente' }).click();

  // Step 3 — compensation; approval required, not auto-published
  await wizard.getByPlaceholder('8,000,000').fill('6500000');
  await wizard.getByPlaceholder('14,000,000').fill('9000000');
  await wizard.getByRole('button', { name: 'Crear vacante' }).click();
  await expect(wizard).toBeHidden();

  await page.getByRole('link', { name: title }).first().click();
  await expect(page).toHaveURL(/\/recruitment\/vacancies\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  j.vacancy = { id, title };
  saveJourney(j);
  await expect(page.getByText('Borrador', { exact: true }).first()).toBeVisible();
});

/** Open the vacancy and submit it for approval to `approverName`. */
async function submitForApproval(page: Page, approverName: string): Promise<void> {
  await page.goto(`/recruitment/vacancies/${j.vacancy!.id}`);
  await page.getByRole('button', { name: 'Enviar para aprobación' }).click();
  const dialog = page.getByRole('dialog', { name: 'Enviar para aprobación' });
  await dialog.getByPlaceholder('Buscar usuario...').fill(approverName.split(' ')[0]);
  await dialog
    .getByRole('button', { name: new RegExp(approverName) })
    .first()
    .click();
  await dialog.getByRole('button', { name: 'Enviar para aprobación' }).click();
  await expect(dialog).toBeHidden();
}

test('recruiter submits the vacancy for approval to the hiring leader', async () => {
  needs('peopleDirectory', 'orgStructure');
  await submitForApproval(recruiter.page, `${j.leader.firstName} ${j.leader.lastName}`);
});

test('hiring leader approves the vacancy', async () => {
  needs('peopleDirectory', 'orgStructure');
  const { page } = leader;
  await page.goto(`/recruitment/vacancies/${j.vacancy!.id}`);
  await expect(page.getByText('Aprobada', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aprobar', exact: true }).click();
  await expect(page.getByText('Aprobada', { exact: true }).first()).toBeVisible();
});

test('company admin submits the vacancy for approval and approves it (main-only path)', async () => {
  supersededBy('peopleDirectory', 'orgStructure');
  const { page } = admin;
  await submitForApproval(page, `${j.admin.firstName} ${j.admin.lastName}`);
  await expect(page.getByText('Aprobada', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aprobar', exact: true }).click();
  await expect(page.getByText('Aprobada', { exact: true }).first()).toBeVisible();
});

test('recruiter publishes the approved vacancy to the careers site', async () => {
  const { page } = recruiter;
  await page.goto(`/recruitment/vacancies/${j.vacancy!.id}`);
  await expect(page.getByText('Publicada', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /agregar canal/i }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar canal de publicación' });
  await dialog.getByPlaceholder(/linkedin, portal de empleo/i).fill('Portal de carreras');
  await dialog.locator('select').selectOption({ label: 'Sitio web' });
  await dialog.getByRole('button', { name: 'Agregar Canal' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Publicada', { exact: true }).first()).toBeVisible();
});
