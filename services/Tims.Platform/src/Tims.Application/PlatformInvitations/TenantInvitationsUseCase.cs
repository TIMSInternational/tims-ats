using System.Text.Json.Serialization;
using Tims.Application.Email;
using Tims.Domain.Identity;
using Tims.Domain.Json;

namespace Tims.Application.PlatformInvitations;

public sealed record TenantInvitationRow(Guid Id, string Email, string? RoleSlug, string Status,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime ExpiresAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? SentAt);
/// <summary>
/// One keyset page, newest first. <see cref="NextCursor"/> is the id of the LAST row in <see cref="Invitations"/>
/// when more rows follow (pass it back as <c>cursor</c>), otherwise null.
/// </summary>
public sealed record TenantInvitationsResponse(IReadOnlyList<TenantInvitationRow> Invitations, Guid? NextCursor);

/// <summary>
/// Which open invitations to list, by EFFECTIVE state: a pending/sent row whose <c>expires_at</c> has passed is
/// expired even if no job has flipped its stored status yet (and is reported with status <c>expired</c>).
/// </summary>
public enum TenantInvitationListFilter { All, Active, Expired }

public sealed record TenantInvitationListQuery(TenantInvitationListFilter Filter, int Take, Guid? Cursor)
{
    public const int DefaultTake = 50;
    public const int MaxTake = 100;

    /// <summary>
    /// Parses the raw query strings (bound as strings so authorization runs first). Rejects — never clamps —
    /// an unknown status, a non-integer or out-of-range limit, and a cursor that is not a canonical GUID.
    /// </summary>
    public static TenantInvitationListQuery? Parse(string? status, string? limit, string? cursor)
    {
        TenantInvitationListFilter filter;
        switch (status)
        {
            case null or "all": filter = TenantInvitationListFilter.All; break;
            case "active": filter = TenantInvitationListFilter.Active; break;
            case "expired": filter = TenantInvitationListFilter.Expired; break;
            default: return null;
        }
        var take = DefaultTake;
        if (limit is not null)
        {
            if (limit.Length is 0 or > 3 || !limit.All(char.IsAsciiDigit)) return null;
            take = int.Parse(limit, System.Globalization.CultureInfo.InvariantCulture);
            if (take is < 1 or > MaxTake) return null;
        }
        Guid? after = null;
        if (cursor is not null)
        {
            if (!Guid.TryParseExact(cursor, "D", out var parsed)) return null;
            after = parsed;
        }
        return new(filter, take, after);
    }
}
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
    /// <summary>
    /// Up to <c>take</c> open invitations strictly after <c>cursor</c> in (created_at DESC, id DESC) order. The
    /// caller asks for one more row than it returns to learn whether another page exists. An unknown or
    /// foreign cursor yields an empty page.
    /// </summary>
    Task<IReadOnlyList<TenantInvitationRow>> ListOpenAsync(Guid organizationId, TenantInvitationListFilter filter,
        int take, Guid? cursor, DateTime now, CancellationToken ct);
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

    public async Task<TenantInvitationsResponse> ListAsync(Guid organizationId, TenantInvitationListQuery query, CancellationToken ct)
    {
        var rows = await repository.ListOpenAsync(organizationId, query.Filter, query.Take + 1, query.Cursor, Now(), ct);
        if (rows.Count <= query.Take) return new(rows, null);
        var page = rows.Take(query.Take).ToList();
        return new(page, page[^1].Id);
    }

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

    public Task<TenantInvitationRevokeOutcome> RevokeAsync(Guid organizationId, Guid id, Guid actor, CancellationToken ct) =>
        repository.RevokeAsync(organizationId, id, actor, Now(), ct);

    private DateTime Now()
    {
        var now = clock.GetUtcNow().UtcDateTime;
        return new DateTime(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);
    }
}
