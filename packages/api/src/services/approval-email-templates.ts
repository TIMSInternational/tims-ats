// ---------------------------------------------------------------------------
// Localized (es/en) "your approval is requested" email for vacancy and offer approvers
// ---------------------------------------------------------------------------
// Sent to every approver of a vacancy or offer when it is submitted for approval, with a deep link
// to the item. Staff-facing, so the Spanish copy uses "tú" like the staff UI.
// SECURITY: every dynamic value goes through esc()/safeUrl() (HTML). Candidate names originate from
// the PUBLIC apply form; subjects are plain text and are stripped of CR/LF.

import { emailLayout } from './email-templates.service';

const { esc, baseLayout, heading, paragraph, detailRow, detailsTable, ctaButton } = emailLayout;

export type ApprovalEmailLocale = 'es' | 'en';
export type ApprovalKind = 'vacancy' | 'offer';

export type ApprovalRequestEmailInput = {
  kind: ApprovalKind;
  locale: ApprovalEmailLocale;
  approverFirstName: string;
  requesterName: string;
  companyName: string;
  vacancyTitle: string;
  /** Offers only: the candidate the offer is for. */
  candidateName?: string | null;
  reviewUrl: string;
};

const COPY = {
  es: {
    vacancySubject: (title: string) => `Aprobación pendiente: vacante ${title}`,
    offerSubject: (candidate: string, title: string) => `Aprobación pendiente: oferta para ${candidate} (${title})`,
    vacancyHeading: 'Tienes una vacante por aprobar',
    offerHeading: 'Tienes una oferta por aprobar',
    greeting: (name: string) => `Hola ${name},`,
    greetingGeneric: 'Hola,',
    vacancyIntro: (requester: string, title: string, company: string) =>
      `${requester} te pidió aprobar la vacante <strong>${title}</strong> en ${company}.`,
    offerIntro: (requester: string, candidate: string, title: string) =>
      `${requester} te pidió aprobar la oferta para <strong>${candidate}</strong> en la vacante <strong>${title}</strong>.`,
    vacancyLabel: 'Vacante',
    candidateLabel: 'Candidato',
    requesterLabel: 'Solicitada por',
    vacancyCta: 'Revisar la vacante',
    offerCta: 'Revisar la oferta',
    vacancyWaiting: 'La vacante no se puede publicar hasta que la apruebes. Puedes aprobarla o rechazarla desde TIMS.',
    offerWaiting:
      'La oferta no se puede enviar al candidato hasta que la apruebes. Puedes aprobarla o rechazarla desde TIMS.',
    automatic: 'Este es un aviso automático de TIMS.',
    fallbackRequester: 'Tu equipo de reclutamiento',
  },
  en: {
    vacancySubject: (title: string) => `Approval needed: vacancy ${title}`,
    offerSubject: (candidate: string, title: string) => `Approval needed: offer for ${candidate} (${title})`,
    vacancyHeading: 'A vacancy is waiting for your approval',
    offerHeading: 'An offer is waiting for your approval',
    greeting: (name: string) => `Hi ${name},`,
    greetingGeneric: 'Hi,',
    vacancyIntro: (requester: string, title: string, company: string) =>
      `${requester} asked you to approve the vacancy <strong>${title}</strong> at ${company}.`,
    offerIntro: (requester: string, candidate: string, title: string) =>
      `${requester} asked you to approve the offer for <strong>${candidate}</strong> for the vacancy <strong>${title}</strong>.`,
    vacancyLabel: 'Vacancy',
    candidateLabel: 'Candidate',
    requesterLabel: 'Requested by',
    vacancyCta: 'Review the vacancy',
    offerCta: 'Review the offer',
    vacancyWaiting: 'The vacancy cannot be published until you approve it. You can approve or reject it in TIMS.',
    offerWaiting:
      'The offer cannot be sent to the candidate until you approve it. You can approve or reject it in TIMS.',
    automatic: 'This is an automatic notice from TIMS.',
    fallbackRequester: 'Your recruiting team',
  },
} as const;

const SUBJECT_MAX = 200;

/** A plain-text header value: no CR/LF (header injection), collapsed whitespace, bounded length. */
function subjectSafe(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, SUBJECT_MAX);
}

export function approvalEmailLocale(value: string | null | undefined): ApprovalEmailLocale {
  return value?.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** Pure: renders one approver's email. Every dynamic value is escaped here, nowhere else. */
export function renderApprovalRequestEmail(p: ApprovalRequestEmailInput): { subject: string; html: string } {
  const c = COPY[p.locale];
  const first = p.approverFirstName.trim();
  const requester = esc(p.requesterName.trim() || c.fallbackRequester);
  const title = esc(p.vacancyTitle);
  const candidate = esc(p.candidateName?.trim() ?? '');
  const isOffer = p.kind === 'offer';

  const rows = isOffer
    ? detailRow(c.candidateLabel, candidate) + detailRow(c.vacancyLabel, title) + detailRow(c.requesterLabel, requester)
    : detailRow(c.vacancyLabel, title) + detailRow(c.requesterLabel, requester);

  const content =
    heading(isOffer ? c.offerHeading : c.vacancyHeading) +
    paragraph(first ? c.greeting(esc(first)) : c.greetingGeneric) +
    paragraph(
      isOffer ? c.offerIntro(requester, candidate, title) : c.vacancyIntro(requester, title, esc(p.companyName)),
    ) +
    detailsTable(rows) +
    ctaButton(p.reviewUrl, isOffer ? c.offerCta : c.vacancyCta) +
    paragraph(isOffer ? c.offerWaiting : c.vacancyWaiting) +
    paragraph(c.automatic);

  const subject = subjectSafe(
    isOffer ? c.offerSubject(p.candidateName?.trim() ?? '', p.vacancyTitle) : c.vacancySubject(p.vacancyTitle),
  );
  return { subject, html: baseLayout(content, p.companyName, p.locale) };
}
