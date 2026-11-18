// ---------------------------------------------------------------------------
// "Oferta aceptada" copy for the CANDIDATE (Pilot UX re-audit C-31)
// ---------------------------------------------------------------------------
// After "Aceptar Oferta" the candidate only saw an on-screen line; HR got an email, the candidate nothing. This
// is their record of the accepted terms and of what happens next. Candidate-facing: "usted" and Costa Rican
// contract labels (stored slugs unchanged). SECURITY: every dynamic value goes through esc(); the subject is
// plain text stripped of CR/LF.

import { emailLayout, formatZonedDateTime } from './email-templates.service';

const { esc, baseLayout, heading, paragraph, detailRow, detailsTable } = emailLayout;

/** Costa Rican labels for the stored contract-type slugs (apps/web es.json portal.contractTypes). */
const CONTRACT_TYPE_LABELS_ES: Readonly<Record<string, string>> = {
  indefinido: 'Plazo indefinido',
  termino_fijo: 'Plazo fijo',
  obra_labor: 'Por obra determinada',
  prestacion: 'Servicios profesionales',
  temporal: 'Temporal',
  practicas: 'Prácticas / Pasantía',
};

const ZERO_DECIMAL = new Set(['CRC', 'COP', 'CLP', 'JPY', 'KRW', 'PYG']);

export function contractTypeLabel(slug: string): string {
  return CONTRACT_TYPE_LABELS_ES[slug] ?? slug;
}

/** The number locale when the organization has none (the pilot tenant's). */
export const DEFAULT_OFFER_MONEY_LOCALE = 'es-CR';

/**
 * "CRC 850 000" in es-CR — or in the organization's own locale ("GTQ 8,500" in es-GT); a non-ISO stored
 * value is shown verbatim next to plain digits.
 */
export function formatOfferMoney(amount: number, currency: string, locale: string = DEFAULT_OFFER_MONEY_LOCALE): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    const digits = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount);
    return currency.trim() ? `${currency.trim()} ${digits}` : digits;
  }
  const fraction = ZERO_DECIMAL.has(code) || Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    currencyDisplay: 'code',
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(amount);
}

export type OfferAcceptedCopyInput = {
  candidateName: string;
  vacancyTitle: string;
  companyName: string;
  /** Annual base salary as stored on the offer. */
  annualSalary: number;
  currency: string;
  startDate: Date;
  contractType: string;
  signatureName: string | null;
  acceptedAt: Date;
  timeZone: string | null;
  /** The organization's candidate contact (services/candidate-contact.ts); the line is omitted without one. */
  contactEmail: string | null;
  /** The organization's number locale (settings.locale); es-CR when it has none. */
  locale?: string | null;
};

function formatStartDate(d: Date): string {
  // A calendar date stored at UTC midnight: render it in UTC so it never shifts a day.
  return new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export function renderOfferAcceptedCopy(p: OfferAcceptedCopyInput): { subject: string; html: string } {
  const monthly = p.annualSalary / 12;
  const moneyLocale = p.locale ?? DEFAULT_OFFER_MONEY_LOCALE;
  const salary = `${formatOfferMoney(monthly, p.currency, moneyLocale)} al mes (${formatOfferMoney(p.annualSalary, p.currency, moneyLocale)} al año)`;
  const contact = p.contactEmail
    ? paragraph(
        `Si tiene preguntas, escríbanos a <a href="mailto:${esc(p.contactEmail)}" style="color:#1F114C;text-decoration:underline;">${esc(p.contactEmail)}</a>.`,
      )
    : '';
  const content =
    heading('Su aceptación quedó registrada') +
    paragraph(`Estimado/a ${esc(p.candidateName)},`) +
    paragraph(
      `Gracias por aceptar la oferta para el cargo de <strong>${esc(p.vacancyTitle)}</strong> en ${esc(p.companyName)}. Este correo es su copia de los términos aceptados.`,
    ) +
    detailsTable(
      detailRow('Cargo', esc(p.vacancyTitle)) +
        detailRow('Salario base', esc(salary)) +
        detailRow('Fecha de inicio', esc(formatStartDate(p.startDate))) +
        detailRow('Tipo de contrato', esc(contractTypeLabel(p.contractType))) +
        (p.signatureName ? detailRow('Firmada por', esc(p.signatureName)) : '') +
        detailRow('Aceptada el', esc(formatZonedDateTime(p.acceptedAt, p.timeZone))),
    ) +
    paragraph(
      '<strong>Siguiente paso:</strong> el equipo de selección le contactará para coordinar su ingreso. Cuando se registre su contratación, recibirá un correo de bienvenida para activar su acceso a «Mi Onboarding».',
    ) +
    contact +
    paragraph('Cordialmente,<br>Equipo de Talento Humano');
  const title = p.vacancyTitle.replace(/[\r\n]+/g, ' ');
  const company = p.companyName.replace(/[\r\n]+/g, ' ');
  return { subject: `Oferta aceptada — ${title} en ${company}`, html: baseLayout(content, p.companyName) };
}
