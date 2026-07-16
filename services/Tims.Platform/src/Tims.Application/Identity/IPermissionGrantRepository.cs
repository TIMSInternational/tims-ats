using Tims.Domain.Access;

namespace Tims.Application.Identity;

/// <summary>
/// Read-only port over the Prisma-OWNED RBAC tables (`role_permissions`, `permissions`, joined to
/// `roles`; see docs/architecture/table-ownership.md → efcoreReadOnly). Implemented in
/// Tims.Infrastructure by an EF Core query that NEVER writes these rows. It mirrors the Prisma
/// <c>rolePermission.findMany</c> in packages/api/src/access/build.ts:
/// <c>role.slug IN roleSlugs AND role.organizationId = orgId AND permission.module/action = …</c>,
/// projecting each match to a <see cref="Grant"/> (role slug + permission module/action + raw scope).
/// The legacy 'all'→'organization' map and scope re-validation happen downstream in
/// <see cref="AccessKernel.Decide"/> — this port returns rows verbatim.
/// </summary>
public interface IPermissionGrantRepository
{
    /// <summary>
    /// Fetches the matching <see cref="Grant"/>s for a tenant principal's roles at a given
    /// (module, action). Returns an empty list when no grant matches (deny-by-default upstream).
    /// </summary>
    Task<IReadOnlyList<Grant>> FindGrantsAsync(
        string orgId,
        IReadOnlyList<string> roleSlugs,
        string module,
        string action,
        CancellationToken ct);
}
