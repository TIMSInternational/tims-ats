using System.Globalization;
using System.Net;

namespace Tims.Application.PlatformInvitations;

/// <summary>Table-based, inline-styled invitation email for Outlook and mobile clients.</summary>
public static class InvitationEmail
{
    public static string Render(string organization, string? role, string url, DateTime expiresAt,
        string locale = "es", bool reminder = false)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var target) || target.Scheme != "https" ||
            target.UserInfo.Length != 0)
            throw new ArgumentException("Invitation email requires an HTTPS link", nameof(url));
        var en = locale == "en";
        var heading = en ? "Your next step starts here" : "Tu próximo paso comienza aquí";
        var intro = en ? "You have been invited to join" : "Has sido invitado a unirte a";
        var button = en ? "Set up your access" : "Configurar mi acceso";
        var steps = en
            ? "New to TIMS? Create your password, confirm your details and join your team. Already have an account? Sign in with your existing credentials."
            : "¿Es tu primera vez en TIMS? Crea tu contraseña, confirma tus datos y únete a tu equipo. Si ya tienes una cuenta, inicia sesión con tus credenciales actuales.";
        var date = expiresAt.ToString("d MMMM yyyy", CultureInfo.GetCultureInfo(en ? "en-US" : "es-CO"));
        var footer = en
            ? "Need help? Contact the administrator who invited you. If you were not expecting this invitation, you can ignore this email."
            : "¿Necesitas ayuda? Contacta al administrador que te invitó. Si no esperabas esta invitación, puedes ignorar este correo.";
        string E(string value) => WebUtility.HtmlEncode(value);
        var access = role?.Replace('_', ' ') ??
            (en ? "Review your access during setup" : "Revisa tu acceso durante la configuración");
        return $"""
            <!doctype html><html lang="{(en ? "en" : "es")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="margin:0;padding:0;background:#f4f3f8;font-family:Arial,Helvetica,sans-serif;color:#241641;">
            <div style="display:none;max-height:0;overflow:hidden;">{E(button)} · {E(organization)}</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3f8;"><tr><td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;"><tr><td style="padding:0 8px 24px;font-size:24px;font-weight:bold;letter-spacing:-1px;">TIMS <span style="font-weight:normal;">ATS</span></td></tr>
            <tr><td style="background:#ffffff;border-radius:20px;padding:36px 28px;">
            <div style="height:4px;width:44px;background:#dd0c15;border-radius:4px;margin-bottom:28px;"></div>
            <p style="font-size:11px;letter-spacing:2px;color:#776b8f;margin:0 0 14px;">{(reminder ? (en ? "YOUR INVITATION" : "TU INVITACIÓN") : "WELCOME / BIENVENIDO")}</p>
            <h1 style="font-size:30px;line-height:1.2;margin:0 0 20px;font-weight:600;">{heading}</h1>
            <p style="font-size:16px;line-height:1.7;color:#625c70;margin:0 0 24px;">{intro} <strong style="color:#241641;">{E(organization)}</strong>.</p>
            <table role="presentation" width="100%" style="background:#f6f5fa;border-radius:12px;margin-bottom:24px;"><tr><td style="padding:18px;font-size:14px;line-height:1.7;">
            <strong>{E(organization)}</strong><br>{E(access)}<br><span style="font-size:12px;color:#776b8f;">{(en ? "Valid until" : "Válida hasta")}: {E(date)} UTC</span></td></tr></table>
            <p style="font-size:14px;line-height:1.8;color:#625c70;margin:0 0 26px;">{steps}</p>
            <table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#241641" style="border-radius:10px;"><a href="{E(url)}" style="display:inline-block;padding:16px 26px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">{button} &#8594;</a></td></tr></table>
            <p style="font-size:12px;line-height:1.6;color:#776b8f;margin:26px 0 8px;">{(en ? "If the button does not work, open this link:" : "Si el botón no funciona, abre este enlace:")}</p>
            <a href="{E(url)}" style="font-size:11px;line-height:1.6;color:#625c70;word-break:break-all;">{E(url)}</a>
            </td></tr><tr><td style="padding:24px 20px;color:#81788e;font-size:12px;line-height:1.7;text-align:center;">{footer}<br><strong>TIMS ATS · TIMS International</strong></td></tr></table>
            </td></tr></table></body></html>
            """;
    }
}
