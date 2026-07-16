using Microsoft.EntityFrameworkCore;
using Tims.Application.Identity;
using Tims.Domain.Access;

namespace Tims.Infrastructure.Identity;

/// <summary>
/// EF Core implementation of <see cref="IPermissionGrantRepository"/> over
/// <see cref="IdentityDbContext"/>. Strictly read-only (<c>AsNoTracking</c>, no writes) and projects
/// ONLY role.slug + permission.module/action + role_permissions.scope — the exact columns the pure
/// <see cref="AccessKernel"/> reads. Mirrors the Prisma <c>rolePermission.findMany</c> in build.ts:
/// join role_permissions → roles (slug IN roleSlugs AND organizationId = orgId) → permissions
/// (module = module AND action = action). An unparseable org id yields no grants (deny-by-default).
/// </summary>
public sealed class PermissionGrantRepository(IdentityDbContext db) : IPermissionGrantRepository
{
    private readonly IdentityDbContext _db = db;

    public async Task<IReadOnlyList<Grant>> FindGrantsAsync(
        string orgId,
        IReadOnlyList<string> roleSlugs,
        string module,
        string action,
        CancellationToken ct)
    {
        if (!Guid.TryParse(orgId, out var organizationId) || roleSlugs.Count == 0)
        {
            return [];
        }

        var slugs = roleSlugs.ToList();

        var rows = await (
            from rp in _db.RolePermissions.AsNoTracking()
            join role in _db.Roles.AsNoTracking() on rp.RoleId equals role.Id
            join permission in _db.Permissions.AsNoTracking() on rp.PermissionId equals permission.Id
            where role.OrganizationId == organizationId
                && slugs.Contains(role.Slug)
                && permission.Module == module
                && permission.Action == action
            select new
            {
                role.Slug,
                permission.Module,
                permission.Action,
                rp.Scope,
            }).ToListAsync(ct).ConfigureAwait(false);

        return rows.Select(r => new Grant(r.Slug, r.Module, r.Action, r.Scope)).ToList();
    }
}
