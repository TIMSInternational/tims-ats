using Tims.Application.Email;

namespace Tims.Application.PlatformInvitations;

/// <summary>Post-commit delivery shared by initial org and user invitations. Never retries or creates rows.</summary>
public sealed class InitialInvitationDelivery(IInvitationResendRepository repository, IEmailSender sender, TimeProvider clock)
{
    public async Task<string> SendAsync(InvitationResendSnapshot invitation, DateTime expiresAt,
        string subject, string html, CancellationToken ct)
    {
        bool accepted;
        try { accepted = await sender.SendEmailAsync(invitation.Email, subject, html, ct); }
        catch (Exception) { accepted = false; }
        // Creation already committed. Cancellation or transport uncertainty must not look like rollback.
        if (!accepted) return "unconfirmed";
        try
        {
            var now = clock.GetUtcNow().UtcDateTime;
            var sentAt = new DateTime(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);
            return await repository.MarkSentAsync(invitation, sentAt, expiresAt, ct) ? "accepted" : "changed";
        }
        catch (Exception) { return "state_unconfirmed"; }
    }
}
