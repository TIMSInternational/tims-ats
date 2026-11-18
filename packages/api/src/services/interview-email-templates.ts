// ---------------------------------------------------------------------------
// Localized (es/en) interview invitation / update / cancellation emails
// ---------------------------------------------------------------------------
// One builder for both audiences:
//  - candidate: public join link (video) OR external meeting link (Teams/Meet/Zoom, labelled "En línea")
//    OR location (onsite) OR phone note
//  - evaluator: STAFF room link (video) or the scorecard link (every other type) — never the candidate's
//    join token
// SECURITY: every dynamic value goes through esc()/safeUrl() (HTML) — candidate
// names originate from the PUBLIC apply form.

import { timeZoneLabel, UTC_TIME_ZONE } from '@tims/shared';
import { emailLayout } from './email-templates.service';
import {
  INTERVIEW_EMAIL_COPY as T,
  INTERVIEW_TYPE_LABELS as TYPE_LABELS,
  PLACE_TYPES,
  type EmailLocale,
} from './interview-email-copy';

export type { EmailLocale } from './interview-email-copy';

const { esc, safeUrl, baseLayout, heading, paragraph, detailRow, detailsTable, ctaButton } = emailLayout;

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
  /** Evaluator only: where to fill in the scorecard when there is no video room link. */
  scorecardUrl?: string | null;
  oldScheduledAt?: Date | null;
  cancelReason?: string | null;
  /** The organization's candidate contact (services/candidate-contact.ts); null omits the contact line. */
  contactEmail: string | null;
  /** False when this copy is sent without the .ics (plain fallback): no "we attach an invitation" line. */
  hasCalendarAttachment?: boolean;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export function interviewTypeLabel(type: string, locale: EmailLocale): string {
  return TYPE_LABELS[locale][type] ?? T[locale].interview;
}

/**
 * The type as the recipient should read it. A non-video interview with an external meeting link
 * (a pasted Teams/Meet/Zoom URL) is held online: "Presencial" + a link reads "En línea", and a
 * content type keeps its name with "(en línea)" — never "Presencial" for an online meeting.
 */
export function interviewModeLabel(type: string, meetingUrl: string | null | undefined, locale: EmailLocale): string {
  const label = interviewTypeLabel(type, locale);
  if (!meetingUrl || type === 'video') return label;
  if (PLACE_TYPES.has(type)) return TYPE_LABELS[locale].online ?? label;
  return `${label} (${T[locale].online})`;
}

/** Whether `location` is just the meeting link again (the schedule modal stores a pasted URL in both). */
export function isSameLink(location: string | null | undefined, meetingUrl: string | null | undefined): boolean {
  if (!location || !meetingUrl) return false;
  const value = location.trim();
  if (value === meetingUrl.trim()) return true;
  try {
    return new URL(value).toString() === new URL(meetingUrl).toString();
  } catch {
    return false;
  }
}

/** "martes, 10 de noviembre de 2026, 10:00 a. m., hora de Costa Rica (GMT-6)"; an unusable zone → UTC. */
export function formatInterviewDate(date: Date, locale: EmailLocale, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  const tag = locale === 'en' ? 'en-US' : 'es-CR';
  let zone = timeZone;
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat(tag, { ...opts, timeZone: zone }).format(date);
  } catch {
    zone = UTC_TIME_ZONE;
    formatted = new Intl.DateTimeFormat(tag, { ...opts, timeZone: zone }).format(date);
  }
  const label = timeZoneLabel(zone, locale, date);
  return label === 'UTC' ? `${formatted} (UTC)` : `${formatted}, ${label}`;
}

function stripTags(html: string): string {
  return html.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');
}

export function renderInterviewEmail(p: InterviewEmailInput): RenderedEmail {
  const t = T[p.locale];
  const isCandidate = p.audience === 'candidate';
  const cancel = p.kind === 'cancel';
  // The external link only counts when there is no tokenized join link (video).
  const externalUrl = !p.joinUrl && p.meetingUrl ? p.meetingUrl : null;
  const typeLabel = interviewModeLabel(p.interviewType, externalUrl, p.locale);
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
  // A pasted link is stored as both location and meetingUrl: show it once, as the link.
  if (!cancel && p.location && !isSameLink(p.location, externalUrl)) rows.push([t.place, esc(p.location), p.location]);
  if (!cancel && externalUrl) {
    rows.push([
      t.link,
      `<a href="${safeUrl(externalUrl)}" style="word-break:break-all;">${esc(externalUrl)}</a>`,
      externalUrl,
    ]);
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
    blocks.push(paragraph(`<a href="${safeUrl(p.joinUrl)}" style="word-break:break-all;">${esc(p.joinUrl)}</a>`));
    text.push(`${isCandidate ? t.join : t.room}: ${p.joinUrl}`);
    if (isCandidate) {
      blocks.push(paragraph(esc(t.joinNote)));
      text.push(t.joinNote);
    }
  } else if (!cancel && externalUrl) {
    blocks.push(ctaButton(externalUrl, esc(t.joinMeeting)));
    text.push(`${t.joinMeeting}: ${externalUrl}`);
  } else if (!cancel && isCandidate && isPhone) {
    blocks.push(paragraph(esc(t.phoneNote)));
    text.push(t.phoneNote);
  }

  // Evaluators score in TIMS whatever the meeting tool: without a video room link, link the scorecard.
  if (!cancel && !isCandidate && !p.joinUrl && p.scorecardUrl) {
    blocks.push(ctaButton(p.scorecardUrl, esc(t.scorecard)));
    blocks.push(paragraph(esc(t.scorecardNote)));
    text.push(`${t.scorecard}: ${p.scorecardUrl}`, t.scorecardNote);
  }

  if (cancel && isCandidate) {
    blocks.push(paragraph(esc(t.cancelNextStep)));
    text.push(t.cancelNextStep);
  }

  // Only the raw (MIME) copy carries the .ics; the plain fallback must not claim an attachment.
  if (p.hasCalendarAttachment !== false) {
    const calendarNote = cancel ? t.cancelCalendarNote : t.calendarNote;
    blocks.push(paragraph(esc(calendarNote)));
    text.push(calendarNote, '');
  } else {
    text.push('');
  }

  if (isCandidate && p.contactEmail) {
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
