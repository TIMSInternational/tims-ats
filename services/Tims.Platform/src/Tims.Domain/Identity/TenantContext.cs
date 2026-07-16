namespace Tims.Domain.Identity;

/// <summary>
/// The resolved TIMS principal + tenant context (phase-2 WP2.2's ITenantContext). Drives the
/// RLS GUC (Phase 1), every org WHERE filter, audit actor, and the DbContext-profile choice.
/// <see cref="OrganizationId"/> is a string, empty ("") for an org-less platform owner —
/// matching the TS fast path (`appUser.organizationId ?? ''`).
/// </summary>
public sealed record TenantContext(
    PrincipalType PrincipalType,
    string OrganizationId,
    string UserId,
    IReadOnlyList<string> Roles,
    string? ImpersonatedBy = null,
    IReadOnlyList<string>? ApiKeyScopes = null);

/// <summary>The staff `User` row the resolver decides over (minimal shape; mirrors StaffAppUser, staff-context.ts).</summary>
public sealed record AppUserRow(
    string Id,
    string SupabaseUserId,
    string Email,
    string? OrganizationId,
    bool IsActive,
    bool IsPlatformOwner,
    IReadOnlyList<string> RoleSlugs);

/// <summary>Result of staff resolution: either a resolved <see cref="TenantContext"/> or "not staff" (fall back to candidate/anon).</summary>
public sealed record StaffResolution(bool Resolved, TenantContext? Context)
{
    public static readonly StaffResolution NeedsFallback = new(false, null);
    public static StaffResolution Resolve(TenantContext context) => new(true, context);
}

/// <summary>
/// Pure port of resolveStaffContext's decision (apps/web/lib/auth/staff-context.ts) minus IO
/// (the DB lookups + fire-and-forget lastLogin). Given the already-fetched staff <paramref
/// name="appUser"/> and an already-fetched impersonation <paramref name="impersonationTarget"/>
/// (or null), it returns the tenant context or <see cref="StaffResolution.NeedsFallback"/>.
///
/// Fallback (not staff) when: no row, inactive, or neither org-scoped nor platform-owner —
/// the candidate/anonymous/unprovisioned cases. Impersonation is honored ONLY for a real
/// platform owner and ONLY for a valid target (active, org-scoped, NOT itself an owner); the
/// impersonated context takes the target's org + filtered roles with IsPlatformOwner false,
/// so it runs the DB-checked permission path with the target's grants (never owner bypass).
/// </summary>
public static class StaffContextResolver
{
    private const string PlatformOwnerRole = "platform_owner";

    public static StaffResolution ResolveStaffContext(AppUserRow? appUser, AppUserRow? impersonationTarget)
    {
        // Not a staff/owner row, or inactive, or neither org-scoped nor owner → fall back.
        if (appUser is null
            || !appUser.IsActive
            || (!appUser.IsPlatformOwner && string.IsNullOrEmpty(appUser.OrganizationId)))
        {
            return StaffResolution.NeedsFallback;
        }

        // Impersonation: only a real platform owner, only a valid target.
        if (appUser.IsPlatformOwner
            && impersonationTarget is { } target
            && target.IsActive
            && !string.IsNullOrEmpty(target.OrganizationId)
            && !target.IsPlatformOwner)
        {
            return StaffResolution.Resolve(new TenantContext(
                PrincipalType: PrincipalType.OrgUser,
                OrganizationId: target.OrganizationId!,
                UserId: target.Id,
                Roles: RoleSlugs.FilterStaffRoleSlugs(target.RoleSlugs),
                ImpersonatedBy: appUser.Id));
        }

        // Real staff/owner context. Owner roles collapse to ['platform_owner']; org-less owner → "".
        var roles = appUser.IsPlatformOwner
            ? new[] { PlatformOwnerRole }
            : RoleSlugs.FilterStaffRoleSlugs(appUser.RoleSlugs).ToArray();

        return StaffResolution.Resolve(new TenantContext(
            PrincipalType: appUser.IsPlatformOwner ? PrincipalType.PlatformOwner : PrincipalType.OrgUser,
            OrganizationId: appUser.OrganizationId ?? string.Empty,
            UserId: appUser.Id,
            Roles: roles));
    }
}
