namespace Tims.Application.Email;

/// <summary>
/// Internal delivery boundary, not a public send-email API. Callers must authorize the recipient
/// and HTML-encode interpolated template values. True means provider acceptance, not inbox delivery.
/// False includes disabled, rejected, cancelled and uncertain delivery; never blindly retry it or
/// mark an invitation sent. Durable retry/reconciliation belongs to the calling workflow.
/// </summary>
public interface IEmailSender
{
    Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct);
}
