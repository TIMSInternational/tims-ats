// ---------------------------------------------------------------------------
// The opt-in rejection notice to a candidate (C-11) — pure, no I/O
// ---------------------------------------------------------------------------
// Neutral by design: it tells the candidate the process continued with other profiles and thanks them.
// It NEVER carries the rejection reason or the recruiter's internal note. Candidate-facing copy uses
// "usted" and "postulación". Every dynamic value is escaped (emailLayout.esc); the greeting uses the
// candidate's name only when it is a plain personal name.

import { emailLayout } from './email-templates.service';

const { esc, baseLayout, heading, paragraph, SAFE_GREETING_NAME } = emailLayout;

export type RejectionEmailLocale = 'es' | 'en';

export interface RejectionEmailInput {
  candidateName: string;
  vacancyTitle: string;
  companyName: string;
  locale: RejectionEmailLocale;
  /** The organization's candidate contact (services/candidate-contact.ts); the line is omitted without it. */
  contactEmail: string | null;
}

const COPY = {
  es: {
    subject: 'Actualización de su postulación',
    heading: 'Actualización de su postulación',
    greeting: (name: string) => `Estimado/a ${name},`,
    genericGreeting: 'Estimado/a candidato/a,',
    thanks: (vacancy: string, company: string) =>
      `Gracias por su interés en el cargo de <strong>${vacancy}</strong> en ${company} y por el tiempo dedicado a su postulación.`,
    outcome: 'Le informamos que, en esta ocasión, el proceso de selección continuó con otros perfiles.',
    future: 'Le agradecemos su participación y le invitamos a postularse a futuras oportunidades.',
    contact: 'Si tiene preguntas, escríbanos a',
    signOff: 'Cordialmente,<br>Equipo de Talento Humano',
  },
  en: {
    subject: 'An update on your application',
    heading: 'An update on your application',
    greeting: (name: string) => `Dear ${name},`,
    genericGreeting: 'Dear candidate,',
    thanks: (vacancy: string, company: string) =>
      `Thank you for your interest in the <strong>${vacancy}</strong> position at ${company} and for the time you put into your application.`,
    outcome:
      'We would like to let you know that, on this occasion, the selection process continued with other profiles.',
    future: 'We appreciate your participation and invite you to apply for future opportunities.',
    contact: 'If you have any questions, write to us at',
    signOff: 'Kind regards,<br>Talent Team',
  },
} as const;

export function renderRejectionEmail(input: RejectionEmailInput): { subject: string; html: string } {
  const copy = COPY[input.locale];
  const name = input.candidateName.trim();
  const greeting = SAFE_GREETING_NAME.test(name) ? copy.greeting(esc(name)) : copy.genericGreeting;
  const contact = input.contactEmail
    ? paragraph(
        `${copy.contact} <a href="mailto:${esc(input.contactEmail)}" style="color:#1F114C;text-decoration:underline;">${esc(input.contactEmail)}</a>.`,
      )
    : '';
  const content =
    heading(copy.heading) +
    paragraph(greeting) +
    paragraph(copy.thanks(esc(input.vacancyTitle), esc(input.companyName))) +
    paragraph(copy.outcome) +
    paragraph(copy.future) +
    contact +
    paragraph(copy.signOff);
  // A subject is a header: no CR/LF from the vacancy title.
  const title = input.vacancyTitle.replace(/[\r\n]+/g, ' ').trim();
  return {
    subject: title ? `${copy.subject} — ${title}` : copy.subject,
    html: baseLayout(content, input.companyName, input.locale),
  };
}
