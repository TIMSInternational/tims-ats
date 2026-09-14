using System.Net;
using Tims.Application.Email;
using Tims.Application.PlatformOrganizations;

namespace Tims.Application.PlatformInvitations;

public sealed record OrganizationInvitationInput(string Email, string OrganizationName, string OrganizationSlug, string OrganizationPlan = "trial");
public sealed record OrganizationInvitationResponse(Guid Id, Guid OrganizationId, string Delivery);
public sealed record OrganizationInvitationPending(InvitationResendSnapshot Snapshot, DateTime ExpiresAt);
public interface IOrganizationInvitationCreateRepository
{
    // Null means only the named organization-slug unique constraint rejected creation.
    Task<OrganizationInvitationPending?> CreateAsync(OrganizationInvitationInput input, Guid actorId, DateTime now, CancellationToken ct);
}

public sealed class OrganizationInvitationCreateUseCase(IOrganizationInvitationCreateRepository repository,
    IInvitationResendRepository deliveryRepository, IEmailSender sender, TimeProvider clock)
{
    public static bool IsValid(OrganizationInvitationInput input) =>
        input.OrganizationName.Length is >= 2 and <= 100 && !input.OrganizationName.Any(char.IsControl) &&
        input.OrganizationSlug.Length is >= 2 and <= 63 &&
        input.OrganizationSlug.All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' or '-') &&
        PlatformOrganizationsCreateUseCase.Plans.Contains(input.OrganizationPlan, StringComparer.Ordinal) &&
        PlatformOrganizationsCreateUseCase.IsValidEmail(input.Email);

    public async Task<OrganizationInvitationResponse?> ExecuteAsync(OrganizationInvitationInput input,
        Guid actorId, Uri appOrigin, CancellationToken ct)
    {
        if (!IsValid(input)) throw new ArgumentException("Invalid organization invitation");
        var pending = await repository.CreateAsync(input, actorId, Now(), ct);
        if (pending is null) return null;
        var invitation = pending.Snapshot;
        var organizationId = invitation.OrganizationId!.Value;
        var url = new Uri(appOrigin, "/accept-invitation").AbsoluteUri + "?token=" + Uri.EscapeDataString(invitation.Token);
        bool accepted;
        try
        {
            accepted = await sender.SendEmailAsync(input.Email,
                $"Invitacion para administrar {input.OrganizationName} en TIMS ATS",
                $"<h1>TIMS ATS</h1><p>Has sido invitado a administrar <strong>{WebUtility.HtmlEncode(input.OrganizationName)}</strong>.</p><a href=\"{WebUtility.HtmlEncode(url)}\">Aceptar Invitacion</a><p>Esta invitacion expira en 7 dias.</p>", ct);
        }
        catch (Exception)
        {
            // Creation already committed. Cancellation/transport uncertainty must not masquerade as a
            // failed create that invites the caller to create another organization or retry delivery.
            accepted = false;
        }
        if (!accepted) return new(invitation.Id, organizationId, "unconfirmed");
        try
        {
            var marked = await deliveryRepository.MarkSentAsync(invitation, Now(), pending.ExpiresAt, ct);
            return new(invitation.Id, organizationId, marked ? "accepted" : "changed");
        }
        catch (Exception)
        {
            return new(invitation.Id, organizationId, "state_unconfirmed");
        }
    }

    private DateTime Now()
    {
        var now = clock.GetUtcNow().UtcDateTime;
        return new DateTime(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);
    }
}
