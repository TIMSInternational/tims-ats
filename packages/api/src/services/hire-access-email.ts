// ---------------------------------------------------------------------------
// Hire hand-off: "activate your access" email for a new employee (pure)
// ---------------------------------------------------------------------------
// Sent after "Confirmar ingreso" when the hired person ALREADY had a sign-in identity (every applicant
// who used the candidate portal's emailed code or link has one) — Supabase sends nothing in that case,
// so without this email the new employee has no password and no idea how to reach "Mi Onboarding".
// The message is the organization's to its new hire, so it uses "usted" like every candidate email.
//
// SECURITY: every dynamic value goes through esc() / safeUrl(); the greeting name is only used when it
// is a plain personal name (it originates from the public apply form).

import { emailLayout } from './email-templates.service';

const { esc, safeUrl, baseLayout, heading, paragraph, detailRow, detailsTable, ctaButton } = emailLayout;

const SAFE_GREETING_NAME = /^(?!.*\.\p{L})[\p{L}][\p{L}\p{M}' .-]{0,49}$/u;

export type HireAccessEmailLocale = 'es' | 'en';

export interface HireAccessEmailParams {
  firstName: string;
  organizationName: string;
  jobTitle: string;
  /** Calendar start date (stored at local noon); formatted as a date only, in the organization's zone. */
  startDate: Date | null;
  timeZone: string;
  /** Single-use Supabase link that lands on /reset-password?setup=1. */
  setupUrl: string;
  /** The app origin (getAppUrl()): /login and /forgot-password are printed from it. */
  appUrl: string;
  email: string;
  /** The organization's candidate contact (services/candidate-contact.ts); the line is omitted without it. */
  contactEmail: string | null;
  locale: HireAccessEmailLocale;
}

/** A link printed in the body: `href` already passed safeUrl(), `text` already passed esc(). */
type Link = { href: string; text: string };

function link(url: string): Link {
  return { href: safeUrl(url), text: esc(url) };
}

function anchor(l: Link): string {
  return `<a href="${l.href}" style="color:#1F114C;text-decoration:underline;">${l.text}</a>`;
}

const COPY = {
  es: {
    subject: (org: string) => `${org}: active su acceso a Mi Onboarding`,
    heading: (org: string) => `Le damos la bienvenida a ${org}`,
    greeting: (name: string | null) => (name ? `Estimado/a ${name}:` : 'Estimado/a:'),
    intro: (job: string) =>
      `Su ingreso como <strong>${job}</strong> quedó registrado y su plan de onboarding ya está listo.`,
    jobLabel: 'Cargo',
    startLabel: 'Fecha de inicio',
    setupIntro: 'Para entrar, cree su contraseña con este botón. El enlace es personal y funciona una sola vez.',
    setupCta: 'Crear mi contraseña',
    after: (login: Link, email: string) =>
      `Después, ingrese en ${anchor(login)} con este correo (${email}) y abra «Mi Onboarding» para ver sus tareas y su fecha de inicio.`,
    expired: (forgot: Link) =>
      `Si el enlace ya no funciona, solicite uno nuevo en ${anchor(forgot)} con este mismo correo.`,
    contact: 'Si tiene preguntas, escríbanos a',
    signOff: 'Cordialmente,<br>Equipo de Talento Humano',
    dateLocale: 'es-CR',
  },
  en: {
    subject: (org: string) => `${org}: activate your access to My Onboarding`,
    heading: (org: string) => `Welcome to ${org}`,
    greeting: (name: string | null) => (name ? `Dear ${name},` : 'Hello,'),
    intro: (job: string) => `Your hiring as <strong>${job}</strong> is confirmed and your onboarding plan is ready.`,
    jobLabel: 'Position',
    startLabel: 'Start date',
    setupIntro: 'To sign in, create your password with this button. The link is personal and works only once.',
    setupCta: 'Create my password',
    after: (login: Link, email: string) =>
      `Then sign in at ${anchor(login)} with this email address (${email}) and open "My Onboarding" to see your tasks and start date.`,
    expired: (forgot: Link) =>
      `If the link no longer works, request a new one at ${anchor(forgot)} with this same email address.`,
    contact: 'If you have any questions, write to us at',
    signOff: 'Kind regards,<br>Talent Team',
    dateLocale: 'en-US',
  },
} as const;

function formatStartDate(date: Date, timeZone: string, dateLocale: string): string {
  try {
    return new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(
      date,
    );
  } catch {
    return new Intl.DateTimeFormat(dateLocale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }
}

/** One line for a header: no CR/LF can reach the Subject. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function hireAccessEmail(p: HireAccessEmailParams): { subject: string; html: string } {
  const c = COPY[p.locale];
  const name = p.firstName.trim();
  const greetingName = SAFE_GREETING_NAME.test(name) ? esc(name) : null;
  const origin = p.appUrl.replace(/\/+$/, '');
  const loginUrl = link(`${origin}/login`);
  const forgotUrl = link(`${origin}/forgot-password`);
  const org = esc(p.organizationName);
  const job = esc(p.jobTitle);

  const details = detailsTable(
    detailRow(c.jobLabel, job) +
      (p.startDate ? detailRow(c.startLabel, esc(formatStartDate(p.startDate, p.timeZone, c.dateLocale))) : ''),
  );
  const contact = p.contactEmail
    ? paragraph(
        `${c.contact} <a href="mailto:${esc(p.contactEmail)}" style="color:#1F114C;text-decoration:underline;">${esc(p.contactEmail)}</a>.`,
      )
    : '';

  const content =
    heading(c.heading(org)) +
    paragraph(c.greeting(greetingName)) +
    paragraph(c.intro(job)) +
    details +
    paragraph(c.setupIntro) +
    ctaButton(p.setupUrl, c.setupCta) +
    paragraph(c.after(loginUrl, esc(p.email))) +
    paragraph(c.expired(forgotUrl)) +
    contact +
    paragraph(c.signOff);

  return {
    subject: c.subject(headerSafe(p.organizationName)),
    html: baseLayout(content, p.organizationName, p.locale),
  };
}
