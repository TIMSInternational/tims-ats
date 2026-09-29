using Microsoft.EntityFrameworkCore;
using Tims.Application.People;
using Tims.Domain.Identity;
using Tims.Domain.People;

namespace Tims.Infrastructure.People;

public sealed class AssignablePeopleRepository(AssignablePeopleDbContext db) : IAssignablePeopleRepository
{
    // PermissionService treats super_admin as privileged without reading role_permissions, so the
    // directory must too — otherwise an organization's admins would be missing from every approver list.
    private const string PrivilegedRole = "super_admin";

    public async Task<IReadOnlyList<AssignablePerson>> ListAsync(
        Guid organizationId,
        AssignablePurposeRule rule,
        string? search,
        int limit,
        CancellationToken cancellationToken)
    {
        var staffSlugs = RoleSlugs.AssignableStaffRoles.ToList();
        await using var tenant = await TenantScope.BeginAsync(db, organizationId, cancellationToken);

        var query = db.Users.AsNoTracking()
            .Where(user => user.OrganizationId == organizationId && user.IsActive && user.DeletedAt == null);

        if (search is not null)
        {
            var pattern = $"%{EscapeLike(search)}%";
            query = query.Where(user =>
                EF.Functions.ILike(user.FirstName, pattern, "\\")
                || EF.Functions.ILike(user.LastName, pattern, "\\")
                || EF.Functions.ILike(user.Email, pattern, "\\"));
        }

        if (rule.EligibilityModule is { } module && rule.EligibilityAction is { } action)
        {
            query = query.Where(user => db.UserRoles.Any(userRole => userRole.UserId == user.Id
                && db.Roles.Any(role => role.Id == userRole.RoleId
                    && role.OrganizationId == organizationId
                    && staffSlugs.Contains(role.Slug)
                    && (role.Slug == PrivilegedRole
                        || db.RolePermissions.Any(grant => grant.RoleId == role.Id
                            && db.Permissions.Any(permission => permission.Id == grant.PermissionId
                                && permission.Module == module
                                && permission.Action == action))))));
        }

        var people = await query
            .OrderBy(user => user.FirstName).ThenBy(user => user.LastName).ThenBy(user => user.Id)
            .Take(limit)
            .Select(user => new { user.Id, user.FirstName, user.LastName, user.Email, user.Avatar })
            .ToListAsync(cancellationToken);

        var ids = people.Select(person => person.Id).ToList();
        var roles = await (
            from userRole in db.UserRoles.AsNoTracking()
            join role in db.Roles.AsNoTracking() on userRole.RoleId equals role.Id
            where ids.Contains(userRole.UserId) && role.OrganizationId == organizationId
            select new { userRole.UserId, role.Slug }).ToListAsync(cancellationToken);
        await tenant.CommitAsync(cancellationToken);

        var slugsByUser = roles.ToLookup(row => row.UserId, row => row.Slug);
        return people.Select(person => new AssignablePerson(
            person.Id, person.FirstName, person.LastName, person.Email,
            string.IsNullOrEmpty(person.Avatar) ? null : person.Avatar,
            slugsByUser[person.Id].Order(StringComparer.Ordinal).ToList())).ToList();
    }

    /// <summary>`%`, `_` and the escape character are LIKE metacharacters; a search term is literal text.</summary>
    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);
}
