namespace Tims.Application.CandidateConsent;

/// <summary>
/// Asks the auth service (Supabase <c>GET /auth/v1/settings</c>) whether new sign-ups must CONFIRM their email.
/// The self-service withdrawal trusts a confirmed email as proof of identity; on a project with
/// <c>mailer_autoconfirm</c> on, every email is "confirmed" without anyone opening the inbox, so that proof is void.
/// </summary>
public interface IAuthSettingsProbe
{
    /// <summary>
    /// True only when the settings were read AND <c>mailer_autoconfirm</c> is the JSON boolean <c>false</c>. False when
    /// auto-confirm is on, and also when the settings cannot be fetched or parsed — callers fail CLOSED on false.
    /// </summary>
    Task<bool> RequiresEmailConfirmationAsync(CancellationToken cancellationToken);
}
