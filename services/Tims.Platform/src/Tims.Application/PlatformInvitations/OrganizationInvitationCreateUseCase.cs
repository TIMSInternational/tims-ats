using System.Net;
using Tims.Application.Email;
using Tims.Application.PlatformOrganizations;
using Tims.Domain.Identity;

namespace Tims.Application.PlatformInvitations;

/// <param name="LocaleProfile">Country, time zone, currency and number locale ("Invitar organización" always
/// sends it). Null = the pre-profile behaviour: empty settings and a CR company on the column defaults.</param>
public sealed record OrganizationInvitationInput(string Email, string OrganizationName, string OrganizationSlug,
    string OrganizationPlan = "trial", OrgLocaleProfile? LocaleProfile = null);
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
        PlatformOrganizationsCreateUseCase.IsValidEmail(input.Email) &&
        (input.LocaleProfile is null || OrgLocaleProfileRules.IsValid(input.LocaleProfile));

    public async Task<OrganizationInvitationResponse?> ExecuteAsync(OrganizationInvitationInput input,
        Guid actorId, Uri appOrigin, CancellationToken ct)
    {
        if (!IsValid(input)) throw new ArgumentException("Invalid organization invitation");
        var pending = await repository.CreateAsync(input, actorId, Now(), ct);
        if (pending is null) return null;
        var invitation = pending.Snapshot;
        var organizationId = invitation.OrganizationId!.Value;
        var url = new Uri(appOrigin, "/accept-invitation").AbsoluteUri + "?token=" + Uri.EscapeDataString(invitation.Token);
        var timeZone = await InvitationTimeZone.FindAsync(deliveryRepository, organizationId, ct);
        var outcome = await new InitialInvitationDelivery(deliveryRepository, sender, clock).SendAsync(invitation, pending.ExpiresAt,
            $"Invitación para administrar {input.OrganizationName} en TIMS ATS",
            // An org_admin invitation is accepted as super_admin (InvitationOnboardingRepository).
            InvitationEmail.Render(input.OrganizationName, InvitationGrantPolicy.SuperAdmin, url, pending.ExpiresAt,
                timeZone: timeZone), ct);
        return new(invitation.Id, organizationId, outcome);
    }

    private DateTime Now()
    {
        var now = clock.GetUtcNow().UtcDateTime;
        return new DateTime(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);
    }
}
