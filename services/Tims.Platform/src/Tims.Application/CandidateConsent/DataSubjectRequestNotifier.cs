using System.Net;
using Tims.Application.Email;

namespace Tims.Application.CandidateConsent;

/// <summary>
/// Post-commit email to an organization's admins about a NEW data subject request (supresión de datos). The request
/// and its in-app notifications are already committed; this only tries delivery. It never throws and never fails
/// the request: the result carries counts only, so the caller can log without any address or candidate data.
/// The email names no candidate ("un candidato").
/// </summary>
public sealed class DataSubjectRequestNotifier(IEmailSender sender)
{
    public const string Subject = "Nueva solicitud de supresión de datos — responder en 15 días hábiles";

    public async Task<(int Accepted, int Failed)> SendAsync(
        DataSubjectRequestNotice notice, Uri appOrigin, CancellationToken cancellationToken)
    {
        var url = new Uri(appOrigin, CandidateConsentConstants.StaffListPath).AbsoluteUri;
        var dueDate = BusinessDays.ColombiaDate(notice.DueAt);
        var accepted = 0;
        var failed = 0;
        foreach (var recipient in notice.Recipients)
        {
            bool ok;
            try
            {
                ok = await sender.SendEmailAsync(
                    recipient.Email, Subject, Render(recipient.FirstName, dueDate, url), cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception)
            {
                ok = false;
            }

            if (ok)
            {
                accepted++;
            }
            else
            {
                failed++;
            }
        }

        return (accepted, failed);
    }

    /// <summary>Spanish HTML body; every interpolated value is HTML-encoded.</summary>
    public static string Render(string firstName, string dueDate, string url)
    {
        static string E(string value) => WebUtility.HtmlEncode(value);
        var greeting = string.IsNullOrWhiteSpace(firstName) ? "Hola" : $"Hola {E(firstName.Trim())}";
        return $"""
            <!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="margin:0;padding:24px;background:#f4f3f8;font-family:Arial,Helvetica,sans-serif;color:#241641;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;"><tr><td style="padding:32px 28px;">
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">{greeting},</p>
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Se recibió una solicitud de <strong>supresión de datos personales</strong> de un candidato de su organización.</p>
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Según la Ley 1581 de 2012 (art. 15), la solicitud debe responderse dentro de <strong>15 días hábiles</strong>. Fecha límite estimada: <strong>{E(dueDate)}</strong> (no descuenta festivos; verifique el plazo legal).</p>
            <p style="margin:24px 0;"><a href="{E(url)}" style="display:inline-block;padding:14px 22px;background:#241641;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:bold;">Ver solicitudes</a></p>
            <p style="font-size:12px;line-height:1.6;color:#776b8f;margin:0;">Si el botón no funciona, abra este enlace: <a href="{E(url)}" style="color:#625c70;">{E(url)}</a></p>
            </td></tr></table><p style="text-align:center;font-size:12px;color:#81788e;">TIMS ATS · TIMS International</p></body></html>
            """;
    }
}
