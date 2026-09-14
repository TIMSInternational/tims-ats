using System.Net;
using Tims.Application.Email;
using Tims.Application.PlatformOrganizations;

namespace Tims.Application.PlatformInvitations;

public sealed record UserInvitationInput(string Email, Guid OrganizationId, string? RoleSlug = null);
public enum UserInvitationCreateOutcome { Created, OrganizationUnavailable, RoleUnavailable }
public sealed record UserInvitationPending(UserInvitationCreateOutcome Outcome, InvitationResendSnapshot? Snapshot = null, DateTime? ExpiresAt = null);
public sealed record UserInvitationCreateResult(UserInvitationCreateOutcome Outcome, OrganizationInvitationResponse? Response = null);
public sealed record InvitationRole(string Slug, string Name);
public sealed record InvitationRolesResponse(IReadOnlyList<InvitationRole> Roles);
public interface IUserInvitationCreateRepository
{
    Task<IReadOnlyList<InvitationRole>?> ListRolesAsync(Guid organizationId, CancellationToken ct);
    Task<UserInvitationPending> CreateAsync(UserInvitationInput input, Guid actor, DateTime now, CancellationToken ct);
}

public sealed class UserInvitationCreateUseCase(IUserInvitationCreateRepository repository,
    IInvitationResendRepository deliveryRepository, IEmailSender sender, TimeProvider clock)
{
    public Task<IReadOnlyList<InvitationRole>?> ListRolesAsync(Guid organizationId, CancellationToken ct) =>
        repository.ListRolesAsync(organizationId, ct);

    public static bool IsValid(UserInvitationInput input) => input.OrganizationId != Guid.Empty &&
        PlatformOrganizationsCreateUseCase.IsValidEmail(input.Email) &&
        (input.RoleSlug is null || input.RoleSlug.Length is >= 1 and <= 50 && !input.RoleSlug.Any(char.IsControl));

    public async Task<UserInvitationCreateResult> ExecuteAsync(UserInvitationInput input, Guid actor, Uri appOrigin, CancellationToken ct)
    {
        if (!IsValid(input)) throw new ArgumentException("Invalid user invitation");
        var now = clock.GetUtcNow().UtcDateTime;
        now = new DateTime(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);
        var pending = await repository.CreateAsync(input, actor, now, ct);
        if (pending.Outcome != UserInvitationCreateOutcome.Created) return new(pending.Outcome);
        var invitation = pending.Snapshot!;
        var url = new Uri(appOrigin, "/accept-invitation").AbsoluteUri + "?token=" + Uri.EscapeDataString(invitation.Token);
        var role = input.RoleSlug?.Replace('_', ' ') ?? "usuario";
        var outcome = await new InitialInvitationDelivery(deliveryRepository, sender, clock).SendAsync(invitation, pending.ExpiresAt!.Value,
            "Invitacion para unirte a TIMS ATS",
            $"<h1>TIMS ATS</h1><p>Has sido invitado a unirte a <strong>{WebUtility.HtmlEncode(invitation.OrganizationName)}</strong> como <strong>{WebUtility.HtmlEncode(role)}</strong>.</p><a href=\"{WebUtility.HtmlEncode(url)}\">Aceptar Invitacion</a><p>Esta invitacion expira en 7 dias.</p>", ct);
        return new(UserInvitationCreateOutcome.Created, new(invitation.Id, input.OrganizationId, outcome));
    }
}
