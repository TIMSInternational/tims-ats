export function applicationConfirmationEmail(params: {
  candidateName: string;
  vacancyTitle: string;
  companyName: string;
}): { subject: string; html: string } {
  const subject = `Tu aplicacion ha sido recibida: ${params.vacancyTitle}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Inter', Arial, sans-serif; background: #F6F6F6; margin: 0; padding: 32px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
    <div style="background: #1F114C; padding: 24px 32px;">
      <h1 style="color: white; font-size: 18px; margin: 0;">Aplicacion Recibida</h1>
    </div>
    <div style="padding: 32px;">
      <p style="color: #333; font-size: 14px; line-height: 1.6;">
        Hola <strong>${params.candidateName}</strong>,
      </p>
      <p style="color: #585858; font-size: 14px; line-height: 1.6;">
        Hemos recibido tu aplicacion para <strong>${params.vacancyTitle}</strong> en <strong>${params.companyName}</strong>.
      </p>
      <p style="color: #585858; font-size: 14px; line-height: 1.6;">
        Nuestro equipo revisara tu perfil y te contactaremos con los siguientes pasos del proceso.
      </p>
      <div style="background: #F0FFF4; border: 1px solid #C6F6D5; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
        <p style="color: #22543D; font-size: 14px; margin: 0; font-weight: 600;">Tu aplicacion esta siendo evaluada</p>
      </div>
      <p style="color: #8B8B8B; font-size: 12px;">
        Si tienes preguntas, no dudes en responder a este correo.
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
