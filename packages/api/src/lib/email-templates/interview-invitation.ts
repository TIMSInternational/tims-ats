export function interviewInvitationEmail(params: {
  candidateName: string;
  vacancyTitle: string;
  interviewType: string;
  dateTime: string;
  duration: number;
  meetingUrl?: string;
  interviewerNames: string[];
}): { subject: string; html: string } {
  const subject = `Invitacion a entrevista: ${params.vacancyTitle}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Inter', Arial, sans-serif; background: #F6F6F6; margin: 0; padding: 32px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
    <div style="background: #1F114C; padding: 24px 32px;">
      <h1 style="color: white; font-size: 18px; margin: 0;">Invitacion a Entrevista</h1>
    </div>
    <div style="padding: 32px;">
      <p style="color: #333; font-size: 14px; line-height: 1.6;">
        Hola <strong>${params.candidateName}</strong>,
      </p>
      <p style="color: #585858; font-size: 14px; line-height: 1.6;">
        Te invitamos a una entrevista para la posicion de <strong>${params.vacancyTitle}</strong>.
      </p>
      <div style="background: #F6F6F6; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 8px; color: #8B8B8B; font-size: 12px;">DETALLES</p>
        <p style="margin: 4px 0; color: #333; font-size: 14px;"><strong>Tipo:</strong> ${params.interviewType}</p>
        <p style="margin: 4px 0; color: #333; font-size: 14px;"><strong>Fecha:</strong> ${params.dateTime}</p>
        <p style="margin: 4px 0; color: #333; font-size: 14px;"><strong>Duracion:</strong> ${params.duration} minutos</p>
        <p style="margin: 4px 0; color: #333; font-size: 14px;"><strong>Entrevistadores:</strong> ${params.interviewerNames.join(', ')}</p>
      </div>
      ${params.meetingUrl ? `
      <a href="${params.meetingUrl}" style="display: inline-block; background: #DD0C15; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">
        Unirse a la reunion
      </a>
      ` : ''}
      <p style="color: #8B8B8B; font-size: 12px; margin-top: 24px;">
        Si necesitas reprogramar, responde a este correo.
      </p>
    </div>
    <div style="background: #F6F6F6; padding: 16px 32px; text-align: center;">
      <p style="color: #8B8B8B; font-size: 11px; margin: 0;">Powered by TIMS ATS</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}
