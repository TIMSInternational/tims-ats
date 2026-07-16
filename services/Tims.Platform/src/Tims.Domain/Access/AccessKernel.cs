namespace Tims.Domain.Access;

/// <summary>
/// The caller principal, ported from AccessUser (build.ts) minus the DB id (which the
/// pure decision does not read).
/// </summary>
public sealed record AccessPrincipal(
    IReadOnlyList<string> Roles,
    string? OrganizationId,
    bool IsPlatformOwner);

/// <summary>
/// Thrown by <see cref="AccessKernel.Decide"/> when a platform-owner / super-admin
/// principal hits a tenant module without an organization context. The TS kernel
/// raises <c>TRPCError({ code: 'BAD_REQUEST' })</c> here (build.ts) rather than running
/// unscoped on the privileged client; this is the C# equivalent, and the golden
/// fixtures pin it as an <c>expectThrow</c> case.
/// </summary>
public sealed class TenantOrgRequiredException : Exception
{
    public TenantOrgRequiredException()
        : base("Selecciona o impersona una organizacion para operar datos de tenant") { }
}

/// <summary>
/// Pure port of <c>buildAccessForUser</c> (packages/api/src/access/build.ts) with the
/// infra (Redis cache + Prisma rolePermission fetch) removed: it takes the already-
/// resolved <paramref name="grants"/> the DB would return and produces the decision.
/// The TS function's cache/DB plumbing is the ONLY thing not ported — the decision
/// logic (privileged short-circuit, org-less deny, legacy 'all'→'organization' map,
/// then <see cref="AccessResolver.ResolveAccess"/>) is reproduced exactly.
/// </summary>
public static class AccessKernel
{
    private const string PlatformOwnerRole = "platform_owner";
    private const string SuperAdminRole = "super_admin";
    private const string LegacyAllScope = "all";

    public static AccessDecision Decide(
        AccessPrincipal principal,
        IReadOnlyList<Grant> grants,
        string module,
        string action)
    {
        var isPrivileged = principal.IsPlatformOwner
            || principal.Roles.Contains(PlatformOwnerRole)
            || principal.Roles.Contains(SuperAdminRole);

        if (isPrivileged)
        {
            // Platform owner / super_admin hitting a tenant module without an org →
            // refuse rather than run on the privileged unscoped client (build.ts).
            if (string.IsNullOrEmpty(principal.OrganizationId))
            {
                throw new TenantOrgRequiredException();
            }

            // super_admin returns roles as-is; a platform owner collapses to
            // ['platform_owner'] (matches the isPlatformOwner ? ['platform_owner'] : roles line).
            var roles = principal.IsPlatformOwner
                ? new[] { PlatformOwnerRole }
                : principal.Roles.ToArray();
            return AccessDecision.Allow(AccessScope.Organization, roles);
        }

        if (string.IsNullOrEmpty(principal.OrganizationId)) return AccessDecision.Deny;

        // LEGACY COMPAT: pre-wave rows carry scope 'all' (org-wide under the old
        // middleware). Map 'all' → 'organization' before resolving; every other scope
        // passes through untouched and ResolveAccess re-validates it.
        var mapped = grants.Select(g =>
            g.Scope == LegacyAllScope
                ? g with { Scope = AccessScope.Organization.ToWire() }
                : g);

        return AccessResolver.ResolveAccess(mapped, module, action);
    }
}
