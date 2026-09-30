using System.Text.Json.Serialization;
using Tims.Application.Email;
using Tims.Domain.Identity;
using Tims.Domain.Json;

namespace Tims.Application.PlatformInvitations;

public sealed record TenantInvitationRow(Guid Id, string Email, string? RoleSlug, string Status,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime ExpiresAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? SentAt);
public sealed record TenantInvitationsResponse(IReadOnlyList<TenantInvitationRow> Invitations);
public sealed record TenantInvitationRevokeResponse(Guid Id, string Status);

public enum TenantInvitationCreateOutcome { Created, Invalid, RoleNotGrantable, RoleUnavailable, OrganizationUnavailable, Duplicate }
public sealed record TenantInvitationCreateResult(TenantInvitationCreateOutcome Outcome, OrganizationInvitationResponse? Response = null);
public enum TenantInvitationRevokeOutcome { Revoked, NotFound, InvalidStatus }
/// <summary>The role an invitation will grant on acceptance (<c>role_slug</c>; NULL = the default staff role).</summary>
public sealed record TenantInvitationTarget(string? RoleSlug);
/// <summary><see cref="DeniedRoleSlug"/> is set (and <see cref="Resend"/> null) when the caller may not grant the invitation's role.</summary>
public sealed record TenantInvitationResendResult(InvitationResendResult? Resend, string? DeniedRoleSlug = null);

public interface ITenantInvitationRepository
{
    Task<IReadOnlyList<TenantInvitationRow>> ListOpenAsync(Guid organizationId, CancellationToken ct);
    Task<TenantInvitationRevokeOutcome> RevokeAsync(Guid organizationId, Guid id, Guid actor, DateTime now, CancellationToken ct);
    /// <summary>The stored role of one of this organization's user invitations, or null when it is not visible.</summary>
    Task<TenantInvitationTarget?> FindTargetAsync(Guid organizationId, Guid id, CancellationToken ct);
    /// <summary>
    /// A delivery/resend repository that can only see and update this organization's invitations whose
    /// effective role is in <paramref name="grantableRoles"/> (re-checked inside the guarded UPDATE itself).
    /// </summary>
    IInvitationResendRepository ForOrganization(Guid organizationId, IReadOnlyList<string> grantableRoles);
}

/// <summary>
/// Company-admin invitations for the CALLER'S OWN organization. The organization id always comes from the
/// resolved principal (never from input); the endpoint enforces <c>user:create</c>; this use case enforces
/// <see cref="InvitationGrantPolicy"/> so a caller cannot grant a role more privileged than their own.
/// Creation reuses <see cref="UserInvitationCreateUseCase"/> (duplicate-safe unique path, same email and
/// audit), but post-commit delivery and resend run through an organization-bound repository so a tenant
/// caller can never touch another organization's invitation.
/// </summary>
public sealed class TenantInvitationsUseCase(IUserInvitationCreateRepository createRepository,
    ITenantInvitationRepository repository, IEmailSender sender, TimeProvider clock)
{
    public async Task<IReadOnlyList<InvitationRole>?> ListGrantableRolesAsync(Guid organizationId,
        IReadOnlyList<string> callerRoles, CancellationToken ct)
    {
        var roles = await createRepository.ListRolesAsync(organizationId, ct);
        if (roles is null) return null;
        var grantable = InvitationGrantPolicy.GrantableRoles(callerRoles);
        return roles.Where(role => grantable.Contains(role.Slug, StringComparer.Ordinal)).ToList();
    }

    public Task<IReadOnlyList<TenantInvitationRow>> ListAsync(Guid organizationId, CancellationToken ct) =>
        repository.ListOpenAsync(organizationId, ct);

    public async Task<TenantInvitationCreateResult> CreateAsync(Guid organizationId, IReadOnlyList<string> callerRoles,
        string email, string roleSlug, Guid actor, Uri appOrigin, CancellationToken ct)
    {
        var input = new UserInvitationInput(email, organizationId, roleSlug);
        if (!UserInvitationCreateUseCase.IsValid(input)) return new(TenantInvitationCreateOutcome.Invalid);
        // Privilege check BEFORE any write: the role must be grantable by this caller.
        if (!InvitationGrantPolicy.CanGrant(callerRoles, roleSlug)) return new(TenantInvitationCreateOutcome.RoleNotGrantable);
        var delivery = repository.ForOrganization(organizationId, InvitationGrantPolicy.GrantableRoles(callerRoles));
        var create = new UserInvitationCreateUseCase(createRepository, delivery, sender, clock);
        var result = await create.ExecuteUniqueAsync(input, actor, appOrigin, ct);
        return result.Outcome switch
        {
            UserInvitationCreateOutcome.Created => new(TenantInvitationCreateOutcome.Created, result.Response),
            UserInvitationCreateOutcome.Duplicate => new(TenantInvitationCreateOutcome.Duplicate),
            UserInvitationCreateOutcome.RoleUnavailable => new(TenantInvitationCreateOutcome.RoleUnavailable),
            _ => new(TenantInvitationCreateOutcome.OrganizationUnavailable),
        };
    }

    /// <summary>
    /// Resending restores 7 days of validity to a bearer token whose acceptance grants the STORED role, so it is
    /// a grant in its own right: the caller must be allowed to grant that role, exactly as on create. Otherwise
    /// an hr_admin could revive an expired super_admin invitation they could never have created. Revoke is
    /// deliberately not role-gated: it can only remove a pending grant, never confer one.
    /// </summary>
    public async Task<TenantInvitationResendResult> ResendAsync(Guid organizationId, IReadOnlyList<string> callerRoles,
        Guid id, Uri appOrigin, CancellationToken ct)
    {
        var target = await repository.FindTargetAsync(organizationId, id, ct);
        if (target is null) return new(new InvitationResendResult(InvitationResendOutcome.NotFound));
        var role = InvitationGrantPolicy.EffectiveInvitedRole(target.RoleSlug);
        var grantable = InvitationGrantPolicy.GrantableRoles(callerRoles);
        // Privilege check BEFORE any email or write, as on create.
        if (!grantable.Contains(role, StringComparer.Ordinal)) return new(null, role);
        var resend = new InvitationResendUseCase(repository.ForOrganization(organizationId, grantable), sender, clock);
        return new(await resend.ExecuteAsync(id, appOrigin, ct));
    }

    public Task<TenantInvitationRevokeOutcome> RevokeAsync(Guid organizationId, Guid id, Guid actor, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        now = new DateTime(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);
        return repository.RevokeAsync(organizationId, id, actor, now, ct);
    }
}
