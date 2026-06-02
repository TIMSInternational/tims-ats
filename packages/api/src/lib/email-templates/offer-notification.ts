export function offerNotificationEmail(params: {
  candidateName: string;
  vacancyTitle: string;
  companyName: string;
  salary: string;
  startDate: string;
  portalUrl?: string;
}): { subject: string; html: string } {
  const subject = `Oferta de trabajo: ${params.vacancyTitle} en ${params.companyName}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Inter', Arial, sans-serif; background: #F6F6F6; margin: 0; padding: 32px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
    <div style="background: #1F114C; padding: 24px 32px;">
      <h1 style="color: white; font-size: 18px; margin: 0;">Oferta de Trabajo</h1>
    </div>
    <div style="padding: 32px;">
      <p style="color: #333; font-size: 14px; line-height: 1.6;">
        Hola <strong>${params.candidateName}</strong>,
      </p>
      <p style="color: #585858; font-size: 14px; line-height: 1.6;">
        Nos complace ofrecerte la posicion de <strong>${params.vacancyTitle}</strong> en <strong>${params.companyName}</strong>.
      </p>
      <div style="background: #F6F6F6; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 8px; color: #8B8B8B; font-size: 12px;">DETALLES DE LA OFERTA</p>
        <p style="margin: 4px 0; color: #333; font-size: 14px;"><strong>Posicion:</strong> ${params.vacancyTitle}</p>
        <p style="margin: 4px 0; color: #333; font-size: 14px;"><strong>Salario:</strong> ${params.salary}</p>
        <p style="margin: 4px 0; color: #333; font-size: 14px;"><strong>Fecha inicio:</strong> ${params.startDate}</p>
      </div>
      ${params.portalUrl ? `
      <a href="${params.portalUrl}" style="display: inline-block; background: #DD0C15; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">
        Ver y aceptar oferta
      </a>
      ` : ''}
      <p style="color: #8B8B8B; font-size: 12px; margin-top: 24px;">
        Si tienes preguntas sobre la oferta, responde a este correo.
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
