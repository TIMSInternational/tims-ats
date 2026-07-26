namespace Tims.Domain.AccessReview;

/// <summary>
/// Port of `packages/api/src/access/access-review-kernel.ts` — pure, deterministic risk
/// classification for a quarterly access review (SOC 2 CC6.2–6.3 / ISO A.5.18). `now` is injected
/// (never `DateTime.UtcNow` read internally) so callers are golden-testable.
/// </summary>
public enum AccessStatus
{
    Active,
    Inactive,
    Deleted,
}

/// <summary>A role assignment as the kernel needs it — <see cref="OrganizationId"/> is the ROLE's
/// owning org (compared to the user's org to detect grant corruption), not the user's.</summary>
public sealed record RoleAssignment(string Slug, Guid OrganizationId, DateTime? ExpiresAt);

public sealed record AccessRiskFlags(
    bool NeverLoggedIn,
    bool Stale,
    bool Privileged,
    bool DeprovisionGap,
    bool ExpiredGrant,
    bool CrossOrgRole);

public sealed record UserAccessInput(
    Guid OrganizationId,
    bool IsActive,
    DateTime? DeletedAt,
    DateTime? LastLoginAt,
    IReadOnlyList<RoleAssignment> Roles,
    bool IsPlatformOwner,
    DateTime Now);

public static class AccessRiskKernel
{
    public const int StaleLoginDays = 90;
    private const double DayMs = 24d * 60 * 60 * 1000;

    public static AccessStatus AccessStatusOf(bool isActive, DateTime? deletedAt)
    {
        if (deletedAt is not null)
        {
            return AccessStatus.Deleted;
        }

        return isActive ? AccessStatus.Active : AccessStatus.Inactive;
    }

    /// <summary>Port of `packages/shared/src/mfa.ts`'s `isMfaPrivileged` — the single-source-of-truth
    /// privileged-role set shared with the MFA gate in TS. Only this decision is needed here, not the
    /// session/AAL logic the rest of that module carries.</summary>
    public static bool IsMfaPrivileged(IEnumerable<string> roleSlugs, bool isPlatformOwner) =>
        isPlatformOwner || roleSlugs.Any(slug => slug is "super_admin" or "platform_owner");

    public static (AccessStatus Status, AccessRiskFlags Flags) AssessUserAccess(UserAccessInput u)
    {
        var status = AccessStatusOf(u.IsActive, u.DeletedAt);
        var active = status == AccessStatus.Active;
        var hasGrant = u.IsPlatformOwner || u.Roles.Count > 0;

        var flags = new AccessRiskFlags(
            NeverLoggedIn: active && u.LastLoginAt is null,
            Stale: active && u.LastLoginAt is { } lastLogin && (u.Now - lastLogin).TotalMilliseconds > StaleLoginDays * DayMs,
            Privileged: IsMfaPrivileged(u.Roles.Select(r => r.Slug), u.IsPlatformOwner),
            DeprovisionGap: !active && hasGrant,
            ExpiredGrant: active && u.Roles.Any(r => r.ExpiresAt is { } expiresAt && expiresAt < u.Now),
            CrossOrgRole: u.Roles.Any(r => r.OrganizationId != u.OrganizationId));

        return (status, flags);
    }
}
