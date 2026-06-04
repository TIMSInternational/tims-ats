// ---------------------------------------------------------------------------
// Email Templates Service — HTML email generation for TIMS ATS
// ---------------------------------------------------------------------------

const BRAND = { navy: '#1F114C', red: '#DD0C15', text: '#333333', secondary: '#585858', muted: '#8B8B8B', surface: '#F6F6F6', border: '#EDEDED', white: '#FFFFFF' } as const;
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

function baseLayout(content: string, companyName: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.surface};${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surface};padding:32px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:${BRAND.white};border-radius:8px;overflow:hidden;border:1px solid ${BRAND.border};">
<tr><td style="background:${BRAND.navy};padding:24px 32px;">
<span style="color:${BRAND.white};font-size:20px;font-weight:700;${FONT}">${companyName}</span>
</td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="padding:16px 32px;background:${BRAND.surface};border-top:1px solid ${BRAND.border};text-align:center;">
<p style="margin:0;font-size:12px;color:${BRAND.muted};${FONT}">&copy; ${new Date().getFullYear()} ${companyName}. Todos los derechos reservados.</p>
<p style="margin:4px 0 0;font-size:11px;color:${BRAND.muted};${FONT}">Este correo es confidencial y dirigido exclusivamente a su destinatario.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

function heading(text: string): string {
  return `<h2 style="margin:0 0 16px;font-size:20px;color:${BRAND.navy};${FONT}">${text}</h2>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${BRAND.text};${FONT}">${text}</p>`;
}

function detailRow(label: string, value: string): string {
  return `<tr><td style="padding:8px 12px;font-size:13px;color:${BRAND.muted};${FONT};border-bottom:1px solid ${BRAND.border};width:140px;">${label}</td><td style="padding:8px 12px;font-size:14px;color:${BRAND.text};${FONT};border-bottom:1px solid ${BRAND.border};font-weight:500;">${value}</td></tr>`;
}

function detailsTable(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid ${BRAND.border};border-radius:6px;overflow:hidden;">${rows}</table>`;
}

function ctaButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:${BRAND.red};border-radius:6px;padding:12px 28px;"><a href="${url}" style="color:${BRAND.white};font-size:14px;font-weight:600;text-decoration:none;${FONT}">${label}</a></td></tr></table>`;
}

function signOff(contactEmail: string): string {
  return paragraph(`Si tiene preguntas, no dude en escribirnos a <a href="mailto:${contactEmail}" style="color:${BRAND.navy};text-decoration:underline;">${contactEmail}</a>.`) + paragraph('Cordialmente,<br>Equipo de Talento Humano');
}

type InterviewParams = { candidateName: string; vacancyTitle: string; companyName: string; interviewType: string; scheduledAt: Date; duration: number; location?: string; meetingUrl?: string; contactEmail: string };

export const emailTemplates = {
  interviewInvitation(p: InterviewParams): { subject: string; html: string } {
    const locationRow = p.location ? detailRow('Lugar', p.location) : '';
    const linkRow = p.meetingUrl ? detailRow('Enlace', `<a href="${p.meetingUrl}" style="color:${BRAND.navy};">${p.meetingUrl}</a>`) : '';
    const content = heading(`Invitaci\u00f3n a Entrevista`) +
      paragraph(`Estimado/a ${p.candidateName},`) +
      paragraph(`Nos complace informarle que ha sido seleccionado/a para una entrevista para el cargo de <strong>${p.vacancyTitle}</strong> en ${p.companyName}.`) +
      detailsTable(detailRow('Fecha y hora', formatDate(p.scheduledAt)) + detailRow('Tipo', p.interviewType) + detailRow('Duraci\u00f3n', `${p.duration} minutos`) + locationRow + linkRow) +
      paragraph('<strong>Recomendaciones:</strong><br>• Ingrese 5 minutos antes de la hora programada<br>• Tenga a la mano una copia de su hoja de vida<br>• Prepare preguntas sobre el cargo y la empresa') +
      signOff(p.contactEmail);
    return { subject: `Invitaci\u00f3n a entrevista — ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },

  interviewReschedule(p: InterviewParams & { newScheduledAt: Date; oldScheduledAt: Date }): { subject: string; html: string } {
    const locationRow = p.location ? detailRow('Lugar', p.location) : '';
    const linkRow = p.meetingUrl ? detailRow('Enlace', `<a href="${p.meetingUrl}" style="color:${BRAND.navy};">${p.meetingUrl}</a>`) : '';
    const content = heading('Reprogramaci\u00f3n de Entrevista') +
      paragraph(`Estimado/a ${p.candidateName},`) +
      paragraph(`Le informamos que su entrevista para el cargo de <strong>${p.vacancyTitle}</strong> ha sido reprogramada.`) +
      detailsTable(detailRow('Fecha anterior', `<s style="color:${BRAND.muted};">${formatDate(p.oldScheduledAt)}</s>`) + detailRow('Nueva fecha', formatDate(p.newScheduledAt)) + detailRow('Tipo', p.interviewType) + detailRow('Duraci\u00f3n', `${p.duration} minutos`) + locationRow + linkRow) +
      paragraph('Lamentamos cualquier inconveniente. Agradecemos su comprensi\u00f3n.') +
      signOff(p.contactEmail);
    return { subject: `Reprogramaci\u00f3n de entrevista — ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },

  interviewCancellation(p: { candidateName: string; vacancyTitle: string; companyName: string; cancelReason: string; contactEmail: string }): { subject: string; html: string } {
    const content = heading('Cancelaci\u00f3n de Entrevista') +
      paragraph(`Estimado/a ${p.candidateName},`) +
      paragraph(`Lamentamos informarle que la entrevista programada para el cargo de <strong>${p.vacancyTitle}</strong> ha sido cancelada.`) +
      detailsTable(detailRow('Motivo', p.cancelReason)) +
      paragraph('Valoramos su inter\u00e9s en nuestra organizaci\u00f3n y le animamos a estar pendiente de futuras oportunidades.') +
      signOff(p.contactEmail);
    return { subject: `Cancelaci\u00f3n de entrevista — ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },

  offerSent(p: { candidateName: string; vacancyTitle: string; companyName: string; signingUrl: string; expiresInDays?: number }): { subject: string; html: string } {
    const days = p.expiresInDays ?? 5;
    const content = heading('\u00a1Felicitaciones!') +
      paragraph(`Estimado/a ${p.candidateName},`) +
      paragraph(`Nos complace extenderle una oferta formal para el cargo de <strong>${p.vacancyTitle}</strong> en ${p.companyName}.`) +
      paragraph('Por favor revise los t\u00e9rminos de la oferta y, de estar de acuerdo, proceda a firmarla electr\u00f3nicamente.') +
      ctaButton(p.signingUrl, 'Revisar y Firmar Oferta') +
      paragraph(`<strong>Importante:</strong> Esta oferta tiene una vigencia de ${days} d\u00edas calendario a partir de la fecha de env\u00edo.`) +
      paragraph(`Si tiene preguntas sobre los t\u00e9rminos, no dude en comunicarse con nosotros.`) +
      paragraph('Cordialmente,<br>Equipo de Talento Humano');
    return { subject: `Oferta laboral — ${p.vacancyTitle} en ${p.companyName}`, html: baseLayout(content, p.companyName) };
  },

  offerAcceptedNotification(p: { candidateName: string; vacancyTitle: string; companyName: string; acceptedAt: Date; recipientName: string }): { subject: string; html: string } {
    const content = heading('Oferta Aceptada') +
      paragraph(`Hola ${p.recipientName},`) +
      paragraph(`Le informamos que <strong>${p.candidateName}</strong> ha aceptado la oferta para el cargo de <strong>${p.vacancyTitle}</strong>.`) +
      detailsTable(detailRow('Candidato', p.candidateName) + detailRow('Cargo', p.vacancyTitle) + detailRow('Aceptada el', formatDate(p.acceptedAt))) +
      paragraph('<strong>Pr\u00f3ximos pasos sugeridos:</strong><br>• Iniciar proceso de onboarding<br>• Solicitar documentaci\u00f3n de ingreso<br>• Coordinar fecha de inicio<br>• Notificar al equipo receptor') +
      paragraph('Cordialmente,<br>Sistema TIMS ATS');
    return { subject: `Oferta aceptada — ${p.candidateName} para ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },

  offerDeclinedNotification(p: { candidateName: string; vacancyTitle: string; companyName: string; declinedAt: Date; recipientName: string }): { subject: string; html: string } {
    const content = heading('Oferta Declinada') +
      paragraph(`Hola ${p.recipientName},`) +
      paragraph(`Le informamos que <strong>${p.candidateName}</strong> ha declinado la oferta para el cargo de <strong>${p.vacancyTitle}</strong>.`) +
      detailsTable(detailRow('Candidato', p.candidateName) + detailRow('Cargo', p.vacancyTitle) + detailRow('Declinada el', formatDate(p.declinedAt))) +
      paragraph('<strong>Acciones sugeridas:</strong><br>• Revisar candidatos finalistas alternativos<br>• Evaluar condiciones de la oferta frente al mercado<br>• Considerar reabrir la vacante si no hay m\u00e1s candidatos') +
      paragraph('Cordialmente,<br>Sistema TIMS ATS');
    return { subject: `Oferta declinada — ${p.candidateName} para ${p.vacancyTitle}`, html: baseLayout(content, p.companyName) };
  },
};
