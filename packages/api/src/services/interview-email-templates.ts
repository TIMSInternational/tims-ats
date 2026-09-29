// ---------------------------------------------------------------------------
// Localized (es/en) interview invitation / update / cancellation emails
// ---------------------------------------------------------------------------
// One builder for both audiences:
//  - candidate: public join link (video) OR location (onsite) OR phone note
//  - evaluator: STAFF room link — never the candidate's join token
// SECURITY: every dynamic value goes through esc()/safeUrl() (HTML) — candidate
// names originate from the PUBLIC apply form.

import { emailLayout } from './email-templates.service';

const { esc, safeUrl, baseLayout, heading, paragraph, detailRow, detailsTable, ctaButton } = emailLayout;

export type EmailLocale = 'es' | 'en';
export type InterviewEmailKind = 'invite' | 'update' | 'cancel';

export type InterviewEmailInput = {
  kind: InterviewEmailKind;
  audience: 'candidate' | 'evaluator';
  locale: EmailLocale;
  timeZone: string;
  recipientName: string;
  candidateName: string;
  vacancyTitle: string;
  companyName: string;
  interviewType: string;
  scheduledAt: Date;
  duration: number;
  location?: string | null;
  /** External meeting URL entered by the recruiter (non-video types only). */
  meetingUrl?: string | null;
  /** Candidate: public join link. Evaluator: staff room link. Video only. */
  joinUrl?: string | null;
  oldScheduledAt?: Date | null;
  cancelReason?: string | null;
  contactEmail: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const TYPE_LABELS: Record<EmailLocale, Record<string, string>> = {
  es: {
    phone: 'Telefónica',
    video: 'Videoconferencia',
    technical: 'Técnica',
    cultural: 'Cultural',
    panel: 'Panel',
    onsite: 'Presencial',
    in_person: 'Presencial',
  },
  en: {
    phone: 'Phone',
    video: 'Video call',
    technical: 'Technical',
    cultural: 'Cultural fit',
    panel: 'Panel',
    onsite: 'In person',
    in_person: 'In person',
  },
};

const T = {
  es: {
    subject: { invite: 'Invitación a entrevista', update: 'Entrevista reprogramada', cancel: 'Entrevista cancelada' },
    evaluatorSubject: {
      invite: 'Nueva entrevista asignada',
      update: 'Entrevista reprogramada',
      cancel: 'Entrevista cancelada',
    },
    greeting: (n: string) => `Estimado/a ${n},`,
    candidateIntro: {
      invite: (v: string, c: string) =>
        `Nos complace invitarle a una entrevista para el cargo de <strong>${v}</strong> en ${c}.`,
      update: (v: string) =>
        `Su entrevista para el cargo de <strong>${v}</strong> ha sido reprogramada. Los nuevos detalles son:`,
      cancel: (v: string) =>
        `Lamentamos informarle que la entrevista para el cargo de <strong>${v}</strong> ha sido cancelada.`,
    },
    evaluatorIntro: {
      invite: (cand: string, v: string) =>
        `Ha sido asignado/a como evaluador/a de la entrevista de <strong>${cand}</strong> para el cargo de <strong>${v}</strong>.`,
      update: (cand: string, v: string) =>
        `La entrevista de <strong>${cand}</strong> para el cargo de <strong>${v}</strong> ha sido reprogramada.`,
      cancel: (cand: string, v: string) =>
        `La entrevista de <strong>${cand}</strong> para el cargo de <strong>${v}</strong> ha sido cancelada.`,
    },
    when: 'Fecha y hora',
    previous: 'Fecha anterior',
    type: 'Tipo',
    duration: 'Duración',
    minutes: 'minutos',
    place: 'Lugar',
    link: 'Enlace',
    reason: 'Motivo',
    candidate: 'Candidato/a',
    join: 'Unirse a la entrevista',
    room: 'Abrir sala de entrevista',
    joinNote:
      'El enlace es personal y se habilita 15 minutos antes de la hora programada. Si la entrevista se reprograma, recibirá un enlace nuevo y este dejará de funcionar.',
    phoneNote: 'Le contactaremos por teléfono al número registrado en su aplicación a la hora indicada.',
    calendarNote: 'Adjuntamos una invitación de calendario (.ics) para que la agregue a su agenda.',
    cancelCalendarNote: 'Adjuntamos la cancelación para actualizar su calendario.',
    questions: 'Si tiene preguntas, escríbanos a',
    regards: 'Cordialmente,<br>Equipo de Talento Humano',
    interview: 'Entrevista',
  },
  en: {
    subject: { invite: 'Interview invitation', update: 'Interview rescheduled', cancel: 'Interview cancelled' },
    evaluatorSubject: {
      invite: 'New interview assigned',
      update: 'Interview rescheduled',
      cancel: 'Interview cancelled',
    },
    greeting: (n: string) => `Dear ${n},`,
    candidateIntro: {
      invite: (v: string, c: string) =>
        `We are pleased to invite you to an interview for the <strong>${v}</strong> position at ${c}.`,
      update: (v: string) =>
        `Your interview for the <strong>${v}</strong> position has been rescheduled. The new details are:`,
      cancel: (v: string) =>
        `We regret to inform you that the interview for the <strong>${v}</strong> position has been cancelled.`,
    },
    evaluatorIntro: {
      invite: (cand: string, v: string) =>
        `You have been assigned as an evaluator for <strong>${cand}</strong>'s interview for the <strong>${v}</strong> position.`,
      update: (cand: string, v: string) =>
        `<strong>${cand}</strong>'s interview for the <strong>${v}</strong> position has been rescheduled.`,
      cancel: (cand: string, v: string) =>
        `<strong>${cand}</strong>'s interview for the <strong>${v}</strong> position has been cancelled.`,
    },
    when: 'Date and time',
    previous: 'Previous date',
    type: 'Type',
    duration: 'Duration',
    minutes: 'minutes',
    place: 'Location',
    link: 'Link',
    reason: 'Reason',
    candidate: 'Candidate',
    join: 'Join the interview',
    room: 'Open interview room',
    joinNote:
      'This link is personal and opens 15 minutes before the scheduled time. If the interview is rescheduled you will receive a new link and this one will stop working.',
    phoneNote: 'We will call you at the phone number in your application at the scheduled time.',
    calendarNote: 'A calendar invitation (.ics) is attached so you can add it to your calendar.',
    cancelCalendarNote: 'The cancellation is attached so your calendar is updated.',
    questions: 'If you have any questions, write to us at',
    regards: 'Kind regards,<br>Talent Team',
    interview: 'Interview',
  },
} as const;

export function interviewTypeLabel(type: string, locale: EmailLocale): string {
  return TYPE_LABELS[locale][type] ?? T[locale].interview;
}

export function formatInterviewDate(date: Date, locale: EmailLocale, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  const tag = locale === 'en' ? 'en-US' : 'es-CO';
  try {
    return new Intl.DateTimeFormat(tag, { ...opts, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(tag, { ...opts, timeZone: 'America/Bogota' }).format(date);
  }
}

function stripTags(html: string): string {
  return html.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');
}

export function renderInterviewEmail(p: InterviewEmailInput): RenderedEmail {
  const t = T[p.locale];
  const isCandidate = p.audience === 'candidate';
  const cancel = p.kind === 'cancel';
  const typeLabel = interviewTypeLabel(p.interviewType, p.locale);
  const when = formatInterviewDate(p.scheduledAt, p.locale, p.timeZone);
  const isPhone = p.interviewType === 'phone';

  const intro = isCandidate
    ? p.kind === 'invite'
      ? t.candidateIntro.invite(esc(p.vacancyTitle), esc(p.companyName))
      : t.candidateIntro[p.kind](esc(p.vacancyTitle))
    : t.evaluatorIntro[p.kind](esc(p.candidateName), esc(p.vacancyTitle));

  // [label, html value, text value]
  const rows: Array<[string, string, string]> = [];
  if (!isCandidate) rows.push([t.candidate, esc(p.candidateName), p.candidateName]);
  if (p.kind === 'update' && p.oldScheduledAt) {
    const old = formatInterviewDate(p.oldScheduledAt, p.locale, p.timeZone);
    rows.push([t.previous, `<s>${esc(old)}</s>`, old]);
  }
  rows.push(
    [t.when, esc(when), when],
    [t.type, esc(typeLabel), typeLabel],
    [t.duration, `${p.duration} ${t.minutes}`, `${p.duration} ${t.minutes}`],
  );
  if (!cancel && p.location) rows.push([t.place, esc(p.location), p.location]);
  if (!cancel && !p.joinUrl && p.meetingUrl) {
    rows.push([t.link, `<a href="${safeUrl(p.meetingUrl)}">${esc(p.meetingUrl)}</a>`, p.meetingUrl]);
  }
  if (cancel && p.cancelReason && isCandidate) rows.push([t.reason, esc(p.cancelReason), p.cancelReason]);

  const blocks: string[] = [
    heading(esc(isCandidate ? t.subject[p.kind] : t.evaluatorSubject[p.kind])),
    paragraph(t.greeting(esc(p.recipientName))),
    paragraph(intro),
  ];
  const text: string[] = [
    stripTags(t.greeting(p.recipientName)),
    '',
    stripTags(
      isCandidate
        ? p.kind === 'invite'
          ? t.candidateIntro.invite(p.vacancyTitle, p.companyName)
          : t.candidateIntro[p.kind](p.vacancyTitle)
        : t.evaluatorIntro[p.kind](p.candidateName, p.vacancyTitle),
    ),
    '',
  ];

  blocks.push(detailsTable(rows.map(([l, h]) => detailRow(esc(l), h)).join('')));
  for (const [l, , v] of rows) text.push(`${l}: ${v}`);
  text.push('');

  if (!cancel && p.joinUrl) {
    blocks.push(ctaButton(p.joinUrl, esc(isCandidate ? t.join : t.room)));
    blocks.push(paragraph(`<a href="${safeUrl(p.joinUrl)}">${esc(p.joinUrl)}</a>`));
    text.push(`${isCandidate ? t.join : t.room}: ${p.joinUrl}`);
    if (isCandidate) {
      blocks.push(paragraph(esc(t.joinNote)));
      text.push(t.joinNote);
    }
  } else if (!cancel && isCandidate && isPhone) {
    blocks.push(paragraph(esc(t.phoneNote)));
    text.push(t.phoneNote);
  }

  const calendarNote = cancel ? t.cancelCalendarNote : t.calendarNote;
  blocks.push(paragraph(esc(calendarNote)));
  text.push(calendarNote, '');

  if (isCandidate) {
    const email = esc(p.contactEmail);
    blocks.push(paragraph(`${esc(t.questions)} <a href="mailto:${email}">${email}</a>.`));
    text.push(`${t.questions} ${p.contactEmail}.`);
  }
  blocks.push(paragraph(t.regards));
  text.push(stripTags(t.regards));

  const subjectBase = isCandidate ? t.subject[p.kind] : t.evaluatorSubject[p.kind];
  return {
    // Collapse line breaks so a title can never break the Subject header.
    subject: `${subjectBase} — ${p.vacancyTitle.replace(/[\r\n]+/g, ' ')}`,
    html: baseLayout(blocks.join(''), p.companyName, p.locale),
    text: text.join('\n'),
  };
}
