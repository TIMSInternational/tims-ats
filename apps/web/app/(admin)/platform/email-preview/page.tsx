'use client';

import { useState } from 'react';

const TEMPLATES = [
  'interviewInvitation',
  'interviewReschedule',
  'interviewCancellation',
  'offerSent',
  'offerAcceptedNotification',
  'offerDeclinedNotification',
] as const;

type TemplateName = (typeof TEMPLATES)[number];

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

function generatePreview(template: TemplateName): string {
  const company = 'TIMS International';
  const candidate = 'Maria Fernanda Lopez';
  const vacancy = 'Gerente de Operaciones';
  const date = new Date(2026, 5, 10, 10, 0);
  const contact = 'rrhh@timsinternational.com';

  switch (template) {
    case 'interviewInvitation': {
      const content = heading('Invitacion a Entrevista') +
        paragraph(`Estimado/a ${candidate},`) +
        paragraph(`Nos complace informarle que ha sido seleccionado/a para una entrevista para el cargo de <strong>${vacancy}</strong> en ${company}.`) +
        detailsTable(
          detailRow('Fecha y hora', formatDate(date)) +
          detailRow('Tipo', 'Entrevista tecnica') +
          detailRow('Duracion', '60 minutos') +
          detailRow('Enlace', `<a href="#" style="color:${BRAND.navy};">https://meet.daily.co/tims-interview-abc123</a>`)
        ) +
        paragraph('<strong>Recomendaciones:</strong><br>&#8226; Ingrese 5 minutos antes de la hora programada<br>&#8226; Tenga a la mano una copia de su hoja de vida<br>&#8226; Prepare preguntas sobre el cargo y la empresa') +
        signOff(contact);
      return baseLayout(content, company);
    }
    case 'interviewReschedule': {
      const oldDate = new Date(2026, 5, 8, 14, 0);
      const content = heading('Reprogramacion de Entrevista') +
        paragraph(`Estimado/a ${candidate},`) +
        paragraph(`Le informamos que su entrevista para el cargo de <strong>${vacancy}</strong> ha sido reprogramada.`) +
        detailsTable(
          detailRow('Fecha anterior', `<s style="color:${BRAND.muted};">${formatDate(oldDate)}</s>`) +
          detailRow('Nueva fecha', formatDate(date)) +
          detailRow('Tipo', 'Entrevista tecnica') +
          detailRow('Duracion', '60 minutos') +
          detailRow('Enlace', `<a href="#" style="color:${BRAND.navy};">https://meet.daily.co/tims-interview-abc123</a>`)
        ) +
        paragraph('Lamentamos cualquier inconveniente. Agradecemos su comprension.') +
        signOff(contact);
      return baseLayout(content, company);
    }
    case 'interviewCancellation': {
      const content = heading('Cancelacion de Entrevista') +
        paragraph(`Estimado/a ${candidate},`) +
        paragraph(`Lamentamos informarle que la entrevista programada para el cargo de <strong>${vacancy}</strong> ha sido cancelada.`) +
        detailsTable(detailRow('Motivo', 'La posicion ha sido cubierta internamente')) +
        paragraph('Valoramos su interes en nuestra organizacion y le animamos a estar pendiente de futuras oportunidades.') +
        signOff(contact);
      return baseLayout(content, company);
    }
    case 'offerSent': {
      const content = heading('\u00a1Felicitaciones!') +
        paragraph(`Estimado/a ${candidate},`) +
        paragraph(`Nos complace extenderle una oferta formal para el cargo de <strong>${vacancy}</strong> en ${company}.`) +
        paragraph('Por favor revise los terminos de la oferta y, de estar de acuerdo, proceda a firmarla electronicamente.') +
        ctaButton('#', 'Revisar y Firmar Oferta') +
        paragraph('<strong>Importante:</strong> Esta oferta tiene una vigencia de 5 dias calendario a partir de la fecha de envio.') +
        paragraph('Si tiene preguntas sobre los terminos, no dude en comunicarse con nosotros.') +
        paragraph('Cordialmente,<br>Equipo de Talento Humano');
      return baseLayout(content, company);
    }
    case 'offerAcceptedNotification': {
      const content = heading('Oferta Aceptada') +
        paragraph('Hola Equipo de RRHH,') +
        paragraph(`Le informamos que <strong>${candidate}</strong> ha aceptado la oferta para el cargo de <strong>${vacancy}</strong>.`) +
        detailsTable(
          detailRow('Candidato', candidate) +
          detailRow('Cargo', vacancy) +
          detailRow('Aceptada el', formatDate(date))
        ) +
        paragraph('<strong>Proximos pasos sugeridos:</strong><br>&#8226; Iniciar proceso de onboarding<br>&#8226; Solicitar documentacion de ingreso<br>&#8226; Coordinar fecha de inicio<br>&#8226; Notificar al equipo receptor') +
        paragraph('Cordialmente,<br>Sistema TIMS ATS');
      return baseLayout(content, company);
    }
    case 'offerDeclinedNotification': {
      const content = heading('Oferta Declinada') +
        paragraph('Hola Equipo de RRHH,') +
        paragraph(`Le informamos que <strong>${candidate}</strong> ha declinado la oferta para el cargo de <strong>${vacancy}</strong>.`) +
        detailsTable(
          detailRow('Candidato', candidate) +
          detailRow('Cargo', vacancy) +
          detailRow('Declinada el', formatDate(date))
        ) +
        paragraph('<strong>Acciones sugeridas:</strong><br>&#8226; Revisar candidatos finalistas alternativos<br>&#8226; Evaluar condiciones de la oferta frente al mercado<br>&#8226; Considerar reabrir la vacante si no hay mas candidatos') +
        paragraph('Cordialmente,<br>Sistema TIMS ATS');
      return baseLayout(content, company);
    }
  }
}

const LABELS: Record<TemplateName, string> = {
  interviewInvitation: 'Invitacion a Entrevista',
  interviewReschedule: 'Reprogramacion de Entrevista',
  interviewCancellation: 'Cancelacion de Entrevista',
  offerSent: 'Oferta Enviada',
  offerAcceptedNotification: 'Oferta Aceptada (HR)',
  offerDeclinedNotification: 'Oferta Declinada (HR)',
};

export default function EmailPreviewPage() {
  const [selected, setSelected] = useState<TemplateName>('interviewInvitation');
  const html = generatePreview(selected);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-64 shrink-0 border-r border-border bg-white p-4">
        <h2 className="text-sm font-semibold text-brand mb-4 uppercase tracking-wider">
          Email Templates
        </h2>
        <div className="space-y-1">
          {TEMPLATES.map((t) => (
            <button
              key={t}
              onClick={() => setSelected(t)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                selected === t
                  ? 'bg-brand text-white font-medium'
                  : 'text-secondary hover:bg-surface'
              }`}
            >
              {LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      {/* Preview */}
      <div className="flex-1 overflow-auto bg-surface p-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-primary">{LABELS[selected]}</h1>
          <span className="text-xs text-muted bg-white px-2 py-1 rounded border border-border">
            Vista previa — no se envia email real
          </span>
        </div>
        <iframe
          srcDoc={html}
          className="w-full bg-white rounded-lg border border-border shadow-sm"
          style={{ height: 'calc(100vh - 180px)', minHeight: 600 }}
          title="Email Preview"
        />
      </div>
    </div>
  );
}
