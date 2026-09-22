using System.Net;
using System.Text.Json.Serialization;
using Tims.Application.Email;
using Tims.Domain.Json;

namespace Tims.Application.PlatformInvitations;

public enum InvitationResendOutcome { Sent, NotFound, InvalidStatus, DeliveryUnconfirmed, ChangedDuringDelivery, StateUnconfirmed }

public sealed record InvitationResendResponse(Guid Id, string Status,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime SentAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime ExpiresAt);

public sealed record InvitationResendResult(InvitationResendOutcome Outcome, Guid? OrganizationId = null,
    InvitationResendResponse? Response = null);

public sealed class InvitationResendUseCase(IInvitationResendRepository repository, IEmailSender sender, TimeProvider clock)
{
    public async Task<InvitationResendResult> ExecuteAsync(Guid id, Uri appOrigin, CancellationToken ct)
    {
        var invitation = await repository.FindAsync(id, ct);
        if (invitation is null) return new(InvitationResendOutcome.NotFound);
        if (invitation.Status is not ("pending" or "sent" or "expired"))
            return new(InvitationResendOutcome.InvalidStatus, invitation.OrganizationId);

        var expiresAt = Now().AddDays(7);
        var organization = string.IsNullOrEmpty(invitation.OrganizationName) ? "TIMS ATS" : invitation.OrganizationName;
        var url = new Uri(appOrigin, "/accept-invitation").AbsoluteUri + "?token=" + Uri.EscapeDataString(invitation.Token);
        var accepted = await sender.SendEmailAsync(invitation.Email,
            $"Recordatorio: Invitacion pendiente - {organization}",
            InvitationEmail.Render(organization, null, url, expiresAt, reminder: true), ct);
        if (!accepted) return new(InvitationResendOutcome.DeliveryUnconfirmed, invitation.OrganizationId);

        var sentAt = Now();
        // No DB transaction or lock is held while talking to the provider. Guard the snapshot on update
        // so revoke/accept/edit/concurrent resend cannot be overwritten after email acceptance.
        try
        {
            if (!await repository.MarkSentAsync(invitation, sentAt, expiresAt, ct))
                return new(InvitationResendOutcome.ChangedDuringDelivery, invitation.OrganizationId);
        }
        catch (Exception)
        {
            // A timeout/disconnect can occur after DB commit. Do not claim non-delivery or retry;
            // preserve the known target for the endpoint's cancellation-independent audit attempt.
            return new(InvitationResendOutcome.StateUnconfirmed, invitation.OrganizationId);
        }
        return new(InvitationResendOutcome.Sent, invitation.OrganizationId, new(id, "sent", sentAt, expiresAt));
    }

    private DateTime Now()
    {
        var now = clock.GetUtcNow().UtcDateTime;
        return new DateTime(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);
    }
}
