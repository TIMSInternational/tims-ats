using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Application.Identity;

/// <summary>
/// The use-case port of <c>buildAccessForUser</c> (packages/api/src/access/build.ts) WITH its infra
/// re-attached: the privileged short-circuit + org-less deny run against the pure
/// <see cref="AccessKernel"/>, and the non-privileged path fetches grants cache-aside
/// (<see cref="IPermissionCache"/> → <see cref="IPermissionGrantRepository"/>) before deciding.
/// The authz logic itself is NOT re-implemented here — it lives in <see cref="AccessKernel.Decide"/>
/// (privileged short-circuit, org-less deny, legacy 'all'→'organization' map, resolveAccess). This
/// service only supplies the DB grants + cache the pure kernel deliberately does not know about.
/// </summary>
public sealed class PermissionService(IPermissionGrantRepository grants, IPermissionCache cache)
{
    private const string PlatformOwnerRole = "platform_owner";
    private const string SuperAdminRole = "super_admin";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);

    private readonly IPermissionGrantRepository _grants = grants;
    private readonly IPermissionCache _cache = cache;

    /// <summary>
    /// Resolves the scoped access decision for a resolved <see cref="TenantContext"/> at
    /// (module, action). "Privileged" is derived (TenantContext has no isPlatformOwner field):
    /// <see cref="PrincipalType.PlatformOwner"/> OR a role of <c>platform_owner</c>/<c>super_admin</c>
    /// — matching build.ts. May throw <see cref="TenantOrgRequiredException"/> for a privileged,
    /// org-less principal (the caller surfaces it as 400/forbidden).
    /// </summary>
    public Task<AccessDecision> CheckAsync(TenantContext principal, string module, string action, CancellationToken ct)
    {
        var isPlatformOwner = principal.PrincipalType == PrincipalType.PlatformOwner;
        var orgId = string.IsNullOrEmpty(principal.OrganizationId) ? null : principal.OrganizationId;
        return CheckAsync(new AccessPrincipal(principal.Roles, orgId, isPlatformOwner), module, action, ct);
    }

    /// <summary>
    /// Overload taking the already-shaped <see cref="AccessPrincipal"/> (roles, org, isPlatformOwner).
    /// </summary>
    public async Task<AccessDecision> CheckAsync(AccessPrincipal principal, string module, string action, CancellationToken ct)
    {
        var isPrivileged = principal.IsPlatformOwner
            || principal.Roles.Contains(PlatformOwnerRole)
            || principal.Roles.Contains(SuperAdminRole);

        // Privileged (no DB, no cache — the kernel returns the org-scope decision or throws
        // TenantOrgRequiredException) OR non-privileged with no org (empty grants → deny).
        if (isPrivileged || string.IsNullOrEmpty(principal.OrganizationId))
        {
            return AccessKernel.Decide(principal, Array.Empty<Grant>(), module, action);
        }

        var key = PermissionCacheKey.Build(principal.OrganizationId, principal.Roles, module, action);
        var cached = await _cache.GetAsync(key, ct).ConfigureAwait(false);
        if (cached is not null)
        {
            return cached;
        }

        var fetched = await _grants
            .FindGrantsAsync(principal.OrganizationId, principal.Roles, module, action, ct)
            .ConfigureAwait(false);
        var decision = AccessKernel.Decide(principal, fetched, module, action);
        await _cache.SetAsync(key, decision, CacheTtl, ct).ConfigureAwait(false);
        return decision;
    }
}
