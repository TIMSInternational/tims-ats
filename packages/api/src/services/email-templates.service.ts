// ---------------------------------------------------------------------------
// Email Templates Service — HTML email generation for TIMS ATS
// ---------------------------------------------------------------------------
// SECURITY: every dynamic value (candidate names, vacancy titles, reasons, URLs)
// MUST be passed through esc() / safeUrl() before interpolation. Names originate
// from the PUBLIC applyToVacancy endpoint, so unescaped values are a stored-XSS /
// phishing vector when a recruiter opens the email. Only the static template
// markup (<strong>, <br>, layout) is allowed to be raw HTML.

const BRAND = { navy: '#1F114C', red: '#DD0C15', text: '#333333', secondary: '#585858', muted: '#8B8B8B', surface: '#F6F6F6', border: '#EDEDED', white: '#FFFFFF' } as const;
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

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

function baseLayout(content: string, companyName: string): string {
  const company = esc(companyName);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.surface};${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surface};padding:32px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:${BRAND.white};border-radius:8px;overflow:hidden;border:1px solid ${BRAND.border};">
<tr><td style="background:${BRAND.navy};padding:24px 32px;">
<span style="color:${BRAND.white};font-size:20px;font-weight:700;${FONT}">${company}</span>
</td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="padding:16px 32px;background:${BRAND.surface};border-top:1px solid ${BRAND.border};text-align:center;">
<p style="margin:0;font-size:12px;color:${BRAND.muted};${FONT}">&copy; ${new Date().getFullYear()} ${company}. Todos los derechos reservados.</p>
<p style="margin:4px 0 0;font-size:11px;color:${BRAND.muted};${FONT}">Este correo es confidencial y dirigido exclusivamente a su destinatario.</p>
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

type InterviewParams = { candidateName: string; vacancyTitle: string; companyName: string; interviewType: string; scheduledAt: Date; duration: number; location?: string; meetingUrl?: string; contactEmail: string };

export const emailTemplates = {
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

  offerSent(p: { candidateName: string; vacancyTitle: string; companyName: string; signingUrl: string; expiresInDays?: number }): { subject: string; html: string } {
    const days = p.expiresInDays ?? 5;
    const content = heading('¡Felicitaciones!') +
      paragraph(`Estimado/a ${esc(p.candidateName)},`) +
      paragraph(`Nos complace extenderle una oferta formal para el cargo de <strong>${esc(p.vacancyTitle)}</strong> en ${esc(p.companyName)}.`) +
      paragraph('Por favor revise los términos de la oferta y, de estar de acuerdo, proceda a firmarla electrónicamente.') +
      ctaButton(p.signingUrl, 'Revisar y Firmar Oferta') +
      paragraph(`<strong>Importante:</strong> Esta oferta tiene una vigencia de ${days} días calendario a partir de la fecha de envío.`) +
      paragraph(`Si tiene preguntas sobre los términos, no dude en comunicarse con nosotros.`) +
      paragraph('Cordialmente,<br>Equipo de Talento Humano');
    return { subject: `Oferta laboral — ${p.vacancyTitle} en ${p.companyName}`, html: baseLayout(content, p.companyName) };
  },

  offerAcceptedNotification(p: { candidateName: string; vacancyTitle: string; companyName: string; acceptedAt: Date; recipientName: string }): { subject: string; html: string } {
    const content = heading('Oferta Aceptada') +
      paragraph(`Hola ${esc(p.recipientName)},`) +
      paragraph(`Le informamos que <strong>${esc(p.candidateName)}</strong> ha aceptado la oferta para el cargo de <strong>${esc(p.vacancyTitle)}</strong>.`) +
      detailsTable(detailRow('Candidato', esc(p.candidateName)) + detailRow('Cargo', esc(p.vacancyTitle)) + detailRow('Aceptada el', formatDate(p.acceptedAt))) +
      paragraph('<strong>Próximos pasos sugeridos:</strong><br>• Iniciar proceso de onboarding<br>• Solicitar documentación de ingreso<br>• Coordinar fecha de inicio<br>• Notificar al equipo receptor') +
      paragraph('Cordialmente,<br>Sistema TIMS ATS');
    return { subject: `Oferta aceptada — ${p.candidateName} para ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },

  offerDeclinedNotification(p: { candidateName: string; vacancyTitle: string; companyName: string; declinedAt: Date; recipientName: string }): { subject: string; html: string } {
    const content = heading('Oferta Declinada') +
      paragraph(`Hola ${esc(p.recipientName)},`) +
      paragraph(`Le informamos que <strong>${esc(p.candidateName)}</strong> ha declinado la oferta para el cargo de <strong>${esc(p.vacancyTitle)}</strong>.`) +
      detailsTable(detailRow('Candidato', esc(p.candidateName)) + detailRow('Cargo', esc(p.vacancyTitle)) + detailRow('Declinada el', formatDate(p.declinedAt))) +
      paragraph('<strong>Acciones sugeridas:</strong><br>• Revisar candidatos finalistas alternativos<br>• Evaluar condiciones de la oferta frente al mercado<br>• Considerar reabrir la vacante si no hay más candidatos') +
      paragraph('Cordialmente,<br>Sistema TIMS ATS');
    return { subject: `Oferta declinada — ${p.candidateName} para ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },
};
