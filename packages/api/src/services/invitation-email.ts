type InvitationEmailInput = {
  organization: string;
  role?: string | null;
  url: string;
  expiresAt: Date;
  reminder?: boolean;
  locale?: 'es' | 'en';
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

export function renderInvitationEmail({ organization, role, url, expiresAt, reminder = false, locale = 'es' }: InvitationEmailInput): string {
  const target = new URL(url);
  const isLocal = target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname);
  if ((target.protocol !== 'https:' && !isLocal) || target.username || target.password) {
    throw new Error('Invitation email requires an HTTPS link');
  }

  const en = locale === 'en';
  const title = en ? 'Your next step starts here' : 'Tu próximo paso comienza aquí';
  const action = en ? 'Set up your access' : 'Configurar mi acceso';
  const intro = en ? 'You have been invited to join' : 'Has sido invitado a unirte a';
  const guidance = en
    ? 'New to TIMS? Create your password and confirm your details. Already have an account? Sign in with your existing credentials.'
    : '¿Es tu primera vez en TIMS? Crea tu contraseña y confirma tus datos. Si ya tienes una cuenta, inicia sesión con tus credenciales actuales.';
  const footer = en
    ? 'Need help? Contact the administrator who invited you. If you did not expect this invitation, you can ignore this email.'
    : '¿Necesitas ayuda? Contacta al administrador que te invitó. Si no esperabas esta invitación, puedes ignorar este correo.';
  const date = new Intl.DateTimeFormat(en ? 'en-US' : 'es-CO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(expiresAt);
  const access = role?.replace(/_/g, ' ') || (en ? 'Review your access during setup' : 'Revisa tu acceso durante la configuración');
  const name = escapeHtml(organization);
  const safeRole = escapeHtml(access);
  const safeUrl = escapeHtml(url);

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f3f8;font-family:Arial,Helvetica,sans-serif;color:#241641;">
<div style="display:none;max-height:0;overflow:hidden;">${action} · ${name}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3f8;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;"><tr><td style="padding:0 8px 24px;font-size:24px;font-weight:bold;letter-spacing:-1px;">TIMS <span style="font-weight:normal;">ATS</span></td></tr>
<tr><td style="background:#ffffff;border-radius:20px;padding:36px 28px;">
<div style="height:4px;width:44px;background:#dd0c15;border-radius:4px;margin-bottom:28px;"></div>
<p style="font-size:11px;letter-spacing:2px;color:#776b8f;margin:0 0 14px;">${reminder ? (en ? 'YOUR INVITATION' : 'TU INVITACIÓN') : 'WELCOME / BIENVENIDO'}</p>
<h1 style="font-size:30px;line-height:1.2;margin:0 0 20px;font-weight:600;">${title}</h1>
<p style="font-size:16px;line-height:1.7;color:#625c70;margin:0 0 24px;">${intro} <strong style="color:#241641;">${name}</strong>.</p>
<table role="presentation" width="100%" style="background:#f6f5fa;border-radius:12px;margin-bottom:24px;"><tr><td style="padding:18px;font-size:14px;line-height:1.7;">
<strong>${name}</strong><br>${safeRole}<br><span style="font-size:12px;color:#776b8f;">${en ? 'Valid until' : 'Válida hasta'}: ${escapeHtml(date)} UTC</span></td></tr></table>
<p style="font-size:14px;line-height:1.8;color:#625c70;margin:0 0 26px;">${guidance}</p>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#241641" style="border-radius:10px;"><a href="${safeUrl}" style="display:inline-block;padding:16px 26px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">${action} &#8594;</a></td></tr></table>
<p style="font-size:12px;line-height:1.6;color:#776b8f;margin:26px 0 8px;">${en ? 'If the button does not work, open this link:' : 'Si el botón no funciona, abre este enlace:'}</p>
<a href="${safeUrl}" style="font-size:11px;line-height:1.6;color:#625c70;word-break:break-all;">${safeUrl}</a>
</td></tr><tr><td style="padding:24px 20px;color:#81788e;font-size:12px;line-height:1.7;text-align:center;">${footer}<br><strong>TIMS ATS · TIMS International</strong></td></tr></table>
</td></tr></table></body></html>`;
}
