// ---------------------------------------------------------------------------
// Email Templates Service — HTML email generation for TIMS ATS
// ---------------------------------------------------------------------------
// SECURITY: every dynamic value (candidate names, vacancy titles, reasons, URLs)
// MUST be passed through esc() / safeUrl() before interpolation. Names originate
// from the PUBLIC applyToVacancy endpoint, so unescaped values are a stored-XSS /
// phishing vector when a recruiter opens the email. Only the static template
// markup (<strong>, <br>, layout) is allowed to be raw HTML.

import { isValidTimeZone, timeZoneLabel, UTC_TIME_ZONE } from '@tims/shared';

const BRAND = { navy: '#1F114C', red: '#DD0C15', text: '#333333', secondary: '#585858', muted: '#8B8B8B', surface: '#F6F6F6', border: '#EDEDED', white: '#FFFFFF' } as const;
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

// A conservative personal-name shape: starts with a letter, then letters, combining marks,
// spaces, apostrophes, periods and hyphens only; 1–50 chars. No digits, slashes or colons,
// and a period may never be followed by a letter ("J. Pérez" ok, "evil.com" not), so no
// URL or domain can ride in a greeting.
const SAFE_GREETING_NAME = /^(?!.*\.\p{L})[\p{L}][\p{L}\p{M}' .-]{0,49}$/u;

// Escape HTML special chars so user/data values cannot inject markup or scripts.
function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only permit http/https URLs in href/src. z.string().url() accepts javascript:
// and data: URLs, so this is the real scheme guard. Returns '#' for anything else.
function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return esc(url);
  } catch {
    /* invalid URL */
  }
  return '#';
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

/**
 * "4 de noviembre de 2026, 4:51 p. m., hora de Costa Rica (GMT-6)": a date in the organization's zone with an
 * explicit label (Pilot UX audit E-23). An unusable zone falls back to UTC, labelled as such.
 */
export function formatZonedDateTime(d: Date, timeZone: string | null | undefined): string {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : UTC_TIME_ZONE;
  const formatted = new Intl.DateTimeFormat('es-CR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  }).format(d);
  const label = timeZoneLabel(zone, 'es', d);
  return label === 'UTC' ? `${formatted} (UTC)` : `${formatted}, ${label}`;
}

function baseLayout(content: string, companyName: string, locale: 'es' | 'en' = 'es'): string {
  const company = esc(companyName);
  const en = locale === 'en';
  return `<!DOCTYPE html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.surface};${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surface};padding:32px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:${BRAND.white};border-radius:8px;overflow:hidden;border:1px solid ${BRAND.border};">
<tr><td style="background:${BRAND.navy};padding:24px 32px;">
<span style="color:${BRAND.white};font-size:20px;font-weight:700;${FONT}">${company}</span>
</td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="padding:16px 32px;background:${BRAND.surface};border-top:1px solid ${BRAND.border};text-align:center;">
<p style="margin:0;font-size:12px;color:${BRAND.muted};${FONT}">&copy; ${new Date().getFullYear()} ${company}. ${en ? 'All rights reserved.' : 'Todos los derechos reservados.'}</p>
<p style="margin:4px 0 0;font-size:11px;color:${BRAND.muted};${FONT}">${en ? 'This email is confidential and intended solely for its recipient.' : 'Este correo es confidencial y dirigido exclusivamente a su destinatario.'}</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

function heading(text: string): string {
  return `<h2 style="margin:0 0 16px;font-size:20px;color:${BRAND.navy};${FONT}">${text}</h2>`;
}

// NOTE: `text` may contain intentional static markup from the templates below.
// Callers MUST esc() any dynamic value before passing it in.
function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${BRAND.text};${FONT}">${text}</p>`;
}

function detailRow(label: string, value: string): string {
  return `<tr><td style="padding:8px 12px;font-size:13px;color:${BRAND.muted};${FONT};border-bottom:1px solid ${BRAND.border};width:140px;">${label}</td><td style="padding:8px 12px;font-size:14px;color:${BRAND.text};${FONT};border-bottom:1px solid ${BRAND.border};font-weight:500;">${value}</td></tr>`;
}

function detailsTable(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid ${BRAND.border};border-radius:6px;overflow:hidden;">${rows}</table>`;
}

// `url` is always a dynamic URL — guarded with safeUrl. `label` is static template text.
function ctaButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:${BRAND.red};border-radius:6px;padding:12px 28px;"><a href="${safeUrl(url)}" style="color:${BRAND.white};font-size:14px;font-weight:600;text-decoration:none;${FONT}">${label}</a></td></tr></table>`;
}

function signOff(contactEmail: string): string {
  const email = esc(contactEmail);
  return paragraph(`Si tiene preguntas, no dude en escribirnos a <a href="mailto:${email}" style="color:${BRAND.navy};text-decoration:underline;">${email}</a>.`) + paragraph('Cordialmente,<br>Equipo de Talento Humano');
}

// Builds the "Enlace" detail row with a guarded, escaped meeting URL.
function meetingLinkRow(meetingUrl?: string): string {
  if (!meetingUrl) return '';
  return detailRow('Enlace', `<a href="${safeUrl(meetingUrl)}" style="color:${BRAND.navy};">${esc(meetingUrl)}</a>`);
}

// Shared building blocks for the localized interview emails (interview-email-templates.ts).
export const emailLayout = { esc, safeUrl, baseLayout, heading, paragraph, detailRow, detailsTable, ctaButton, SAFE_GREETING_NAME } as const;

type InterviewParams = { candidateName: string; vacancyTitle: string; companyName: string; interviewType: string; scheduledAt: Date; duration: number; location?: string; meetingUrl?: string; contactEmail: string };

export const emailTemplates = {
  assessmentReminder(p: { candidateName: string; assessmentName: string; companyName: string; assessmentUrl: string; expiresAt: Date | null }): { subject: string; html: string } {
    const expiration = p.expiresAt ? detailsTable(detailRow('Disponible hasta', formatDate(p.expiresAt))) : '';
    const content = heading('Evaluación pendiente') +
      paragraph(`Estimado/a ${esc(p.candidateName)},`) +
      paragraph(`Tiene pendiente la evaluación <strong>${esc(p.assessmentName)}</strong> de ${esc(p.companyName)}.`) +
      expiration +
      paragraph('Ingrese a su portal de candidato con el mismo correo electrónico para completar la evaluación.') +
      ctaButton(p.assessmentUrl, 'Ir a mis evaluaciones') +
      paragraph('Si ya completó esta evaluación, puede ignorar este recordatorio.') +
      paragraph('Cordialmente,<br>Equipo de Talento Humano');
    return { subject: `Recordatorio de evaluación — ${p.assessmentName}`, html: baseLayout(content, p.companyName) };
  },

  interviewInvitation(p: InterviewParams): { subject: string; html: string } {
    const locationRow = p.location ? detailRow('Lugar', esc(p.location)) : '';
    const content = heading(`Invitación a Entrevista`) +
      paragraph(`Estimado/a ${esc(p.candidateName)},`) +
      paragraph(`Nos complace informarle que ha sido seleccionado/a para una entrevista para el cargo de <strong>${esc(p.vacancyTitle)}</strong> en ${esc(p.companyName)}.`) +
      detailsTable(detailRow('Fecha y hora', formatDate(p.scheduledAt)) + detailRow('Tipo', esc(p.interviewType)) + detailRow('Duración', `${p.duration} minutos`) + locationRow + meetingLinkRow(p.meetingUrl)) +
      paragraph('<strong>Recomendaciones:</strong><br>• Ingrese 5 minutos antes de la hora programada<br>• Tenga a la mano una copia de su hoja de vida<br>• Prepare preguntas sobre el cargo y la empresa') +
      signOff(p.contactEmail);
    return { subject: `Invitación a entrevista — ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },

  interviewReschedule(p: InterviewParams & { newScheduledAt: Date; oldScheduledAt: Date }): { subject: string; html: string } {
    const locationRow = p.location ? detailRow('Lugar', esc(p.location)) : '';
    const content = heading('Reprogramación de Entrevista') +
      paragraph(`Estimado/a ${esc(p.candidateName)},`) +
      paragraph(`Le informamos que su entrevista para el cargo de <strong>${esc(p.vacancyTitle)}</strong> ha sido reprogramada.`) +
      detailsTable(detailRow('Fecha anterior', `<s style="color:${BRAND.muted};">${formatDate(p.oldScheduledAt)}</s>`) + detailRow('Nueva fecha', formatDate(p.newScheduledAt)) + detailRow('Tipo', esc(p.interviewType)) + detailRow('Duración', `${p.duration} minutos`) + locationRow + meetingLinkRow(p.meetingUrl)) +
      paragraph('Lamentamos cualquier inconveniente. Agradecemos su comprensión.') +
      signOff(p.contactEmail);
    return { subject: `Reprogramación de entrevista — ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },

  interviewCancellation(p: { candidateName: string; vacancyTitle: string; companyName: string; cancelReason: string; contactEmail: string }): { subject: string; html: string } {
    const content = heading('Cancelación de Entrevista') +
      paragraph(`Estimado/a ${esc(p.candidateName)},`) +
      paragraph(`Lamentamos informarle que la entrevista programada para el cargo de <strong>${esc(p.vacancyTitle)}</strong> ha sido cancelada.`) +
      detailsTable(detailRow('Motivo', esc(p.cancelReason))) +
      paragraph('Valoramos su interés en nuestra organización y le animamos a estar pendiente de futuras oportunidades.') +
      signOff(p.contactEmail);
    return { subject: `Cancelación de entrevista — ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },

  applicationReceived(p: { candidateName: string; vacancyTitle: string; companyName: string; locale: 'es' | 'en'; contactEmail?: string | null; portalUrl?: string }): { subject: string; html: string } {
    const en = p.locale === 'en';
    // The name comes from the UNAUTHENTICATED apply form and this email goes to an address
    // that form chose: only a plain personal name may reach the greeting (no URLs, digits
    // or markup-ish text a phisher could use); anything else gets the generic greeting.
    const name = p.candidateName.trim();
    const greeting = SAFE_GREETING_NAME.test(name)
      ? (en ? `Dear ${esc(name)},` : `Estimado/a ${esc(name)},`)
      : (en ? 'Dear candidate,' : 'Estimado/a candidato/a,');
    // The organization's own candidate contact (services/candidate-contact.ts); omitted when it has none.
    const contact = p.contactEmail
      ? paragraph(`${en ? 'If you have any questions, write to us at' : 'Si tiene preguntas, escríbanos a'} <a href="mailto:${esc(p.contactEmail)}" style="color:${BRAND.navy};text-decoration:underline;">${esc(p.contactEmail)}</a>.`)
      : '';
    // The candidate portal is where the application's status can be followed (sign-in with the same
    // email). Static label; the URL is built server-side from the org slug and guarded by safeUrl.
    const portal = p.portalUrl
      ? paragraph(en
        ? 'You can follow the status of your application at any time in the candidate portal, signing in with this same email address.'
        : 'Puede consultar el estado de su postulación en cualquier momento en el portal de candidatos, ingresando con este mismo correo electrónico.') +
        ctaButton(p.portalUrl, en ? 'View my applications' : 'Ver mis postulaciones')
      : '';
    const content = heading(en ? 'Application received' : 'Hemos recibido su postulación') +
      paragraph(greeting) +
      paragraph(en
        ? `Thank you for applying to <strong>${esc(p.vacancyTitle)}</strong> at ${esc(p.companyName)}. We have received your application.`
        : `Gracias por postularse al cargo de <strong>${esc(p.vacancyTitle)}</strong> en ${esc(p.companyName)}. Hemos recibido su postulación correctamente.`) +
      paragraph(en
        ? 'Our team will review your profile and contact you by email if it matches the position.'
        : 'Nuestro equipo revisará su perfil y le contactaremos por correo electrónico si se ajusta al cargo.') +
      portal +
      contact +
      paragraph(en ? 'Kind regards,<br>Talent Team' : 'Cordialmente,<br>Equipo de Talento Humano');
    const title = p.vacancyTitle.replace(/[\r\n]+/g, ' ');
    return { subject: en ? `Application received — ${title}` : `Postulación recibida — ${title}`, html: baseLayout(content, p.companyName, p.locale) };
  },

  offerSent(p: { candidateName: string; vacancyTitle: string; companyName: string; signingUrl: string; expiresAt?: Date | null; timeZone?: string | null; contactEmail?: string | null }): { subject: string; html: string } {
    // In the organization's time zone, labelled ("hora de Costa Rica (GMT-6)"), never a bare UTC slice.
    const expiry = p.expiresAt
      ? paragraph(`<strong>Vigencia:</strong> hasta el ${esc(formatZonedDateTime(p.expiresAt, p.timeZone))}.`)
      : '';
    // The organization's own candidate contact (services/candidate-contact.ts); omitted when it has none.
    const contact = p.contactEmail
      ? paragraph(`Si tiene preguntas sobre los términos, escríbanos a <a href="mailto:${esc(p.contactEmail)}" style="color:${BRAND.navy};text-decoration:underline;">${esc(p.contactEmail)}</a>.`)
      : '';
    const content = heading('¡Felicitaciones!') +
      paragraph(`Estimado/a ${esc(p.candidateName)},`) +
      paragraph(`Nos complace extenderle una oferta formal para el cargo de <strong>${esc(p.vacancyTitle)}</strong> en ${esc(p.companyName)}.`) +
      paragraph('Por favor revise los términos de la oferta y, de estar de acuerdo, proceda a firmarla electrónicamente.') +
      ctaButton(p.signingUrl, 'Revisar y Firmar Oferta') +
      expiry +
      contact +
      paragraph('Cordialmente,<br>Equipo de Talento Humano');
    return { subject: `Oferta laboral — ${p.vacancyTitle} en ${p.companyName}`, html: baseLayout(content, p.companyName) };
  },

  // Staff notices (B-18): sent to HR, the offer's recruiter and the hiring manager; link to the offer, where
  // the next step is; the date in the organization's time zone (E-23).
  offerAcceptedNotification(p: { candidateName: string; vacancyTitle: string; companyName: string; acceptedAt: Date; recipientName: string; offerUrl?: string | null; timeZone?: string | null }): { subject: string; html: string } {
    const content = heading('Oferta aceptada') +
      paragraph(`Hola ${esc(p.recipientName)},`) +
      paragraph(`<strong>${esc(p.candidateName)}</strong> aceptó la oferta para el cargo de <strong>${esc(p.vacancyTitle)}</strong>.`) +
      detailsTable(detailRow('Candidato', esc(p.candidateName)) + detailRow('Cargo', esc(p.vacancyTitle)) + detailRow('Aceptada el', esc(formatZonedDateTime(p.acceptedAt, p.timeZone)))) +
      paragraph('<strong>Siguiente paso en TIMS:</strong> abre la oferta y usa «Autorizar contratación» para registrar el ingreso. Así se crean la cuenta del colaborador y su plan de onboarding.') +
      (p.offerUrl ? ctaButton(p.offerUrl, 'Abrir la oferta en TIMS') : '') +
      paragraph('<strong>Otros pasos sugeridos:</strong><br>• Solicitar la documentación de ingreso<br>• Confirmar la fecha de inicio con el candidato<br>• Avisar al equipo que lo recibe') +
      paragraph('Este es un aviso automático de TIMS.');
    return { subject: `Oferta aceptada — ${p.candidateName} para ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },

  offerDeclinedNotification(p: { candidateName: string; vacancyTitle: string; companyName: string; declinedAt: Date; recipientName: string; offerUrl?: string | null; timeZone?: string | null }): { subject: string; html: string } {
    const content = heading('Oferta declinada') +
      paragraph(`Hola ${esc(p.recipientName)},`) +
      paragraph(`<strong>${esc(p.candidateName)}</strong> declinó la oferta para el cargo de <strong>${esc(p.vacancyTitle)}</strong>.`) +
      detailsTable(detailRow('Candidato', esc(p.candidateName)) + detailRow('Cargo', esc(p.vacancyTitle)) + detailRow('Declinada el', esc(formatZonedDateTime(p.declinedAt, p.timeZone)))) +
      (p.offerUrl ? ctaButton(p.offerUrl, 'Abrir la oferta en TIMS') : '') +
      paragraph('<strong>Acciones sugeridas:</strong><br>• Revisar a los otros candidatos finalistas<br>• Evaluar las condiciones de la oferta frente al mercado<br>• Si ya no hay candidatos, considerar reabrir la búsqueda') +
      paragraph('Este es un aviso automático de TIMS.');
    return { subject: `Oferta declinada — ${p.candidateName} para ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },
};
