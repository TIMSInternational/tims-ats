using Microsoft.EntityFrameworkCore;
using Tims.Application.People;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Domain.People;

namespace Tims.Infrastructure.People;

public sealed class AssignablePeopleRepository(AssignablePeopleDbContext db) : IAssignablePeopleRepository
{
    // PermissionService treats super_admin as privileged without reading role_permissions, so the
    // directory must too — otherwise an organization's admins would be missing from every approver list.
    private const string PrivilegedRole = "super_admin";

    public async Task<IReadOnlyList<AssignablePerson>?> ListAsync(
        Guid organizationId,
        AssignablePurposeRule rule,
        string? search,
        int limit,
        Guid? vacancyId,
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
                    // A deactivated role grants nothing here. NOTE: the authorization kernels (TS
                    // buildAccessForUser, C# IdentityRepository/PermissionService) do NOT read roles.is_active,
                    // so this is stricter than submit/approve — it only ever hides a person, never adds one.
                    && role.IsActive
                    && staffSlugs.Contains(role.Slug)
                    && (role.Slug == PrivilegedRole
                        || db.RolePermissions.Any(grant => grant.RoleId == role.Id
                            && db.Permissions.Any(permission => permission.Id == grant.PermissionId
                                && permission.Module == module
                                && permission.Action == action))))));

            if (vacancyId is { } id)
            {
                var covered = await VacancyScopedApproverIdsAsync(organizationId, id, module, action, staffSlugs, cancellationToken);
                if (covered is null) return null; // the scope disposes (rolls back) - nothing was written
                var (orgWide, narrow) = covered.Value;
                query = query.Where(user => narrow.Contains(user.Id) || db.UserRoles.Any(userRole =>
                    userRole.UserId == user.Id
                    && db.Roles.Any(role => role.Id == userRole.RoleId
                        && role.OrganizationId == organizationId
                        && role.IsActive
                        && staffSlugs.Contains(role.Slug)
                        && (role.Slug == PrivilegedRole
                            || db.RolePermissions.Any(grant => grant.RoleId == role.Id
                                && orgWide.Contains(grant.Scope)
                                && db.Permissions.Any(permission => permission.Id == grant.PermissionId
                                    && permission.Module == module
                                    && permission.Action == action))))));
            }
        }

        var people = await query
            .OrderBy(user => user.FirstName).ThenBy(user => user.LastName).ThenBy(user => user.Id)
            .Take(limit)
            .Select(user => new { user.Id, user.FirstName, user.LastName, user.Email, user.Avatar })
            .ToListAsync(cancellationToken);
        await tenant.CommitAsync(cancellationToken);

        return people.Select(person => new AssignablePerson(
            person.Id, person.FirstName, person.LastName, person.Email,
            string.IsNullOrEmpty(person.Avatar) ? null : person.Avatar)).ToList();
    }

    /// <summary>
    /// For <c>?vacancyId</c>: <c>null</c> when the vacancy is not a non-deleted vacancy of the organization;
    /// otherwise the scope strings that cover EVERY vacancy (widest scope wins, so one such grant or
    /// super_admin decides it) and the ids of narrower-scoped approvers who cover THIS vacancy. Only people
    /// anchored to the vacancy (its team's leader, its assignee/creator, its unit's assignees) can hold a
    /// narrow scope over it, so the candidate set is tiny and each one's widest scope is resolved with the
    /// same <see cref="AccessKernel"/> the approve step uses.
    /// </summary>
    private async Task<(string[] OrgWide, List<Guid> Narrow)?> VacancyScopedApproverIdsAsync(
        Guid organizationId, Guid vacancyId, string module, string action, List<string> staffSlugs,
        CancellationToken cancellationToken)
    {
        var vacancy = await db.Vacancies.AsNoTracking()
            .Where(row => row.Id == vacancyId && row.OrganizationId == organizationId && row.DeletedAt == null)
            .Select(row => new VacancyScopeAnchors(row.TeamId, row.BusinessUnitId, row.AssignedTo, row.CreatedBy))
            .SingleOrDefaultAsync(cancellationToken);
        if (vacancy is null) return null;

        // ledTeamIds (anchors.ts): active teams of this org led by the approver - here, only the vacancy's team.
        var leader = vacancy.TeamId is { } teamId
            ? await db.Teams.AsNoTracking()
                .Where(team => team.Id == teamId && team.OrganizationId == organizationId && team.IsActive)
                .Select(team => team.LeaderId).SingleOrDefaultAsync(cancellationToken)
            : null;
        // unitIds (anchors.ts): user_business_units rows whose unit is active - here, only the vacancy's unit.
        var unitAssignees = vacancy.BusinessUnitId is { } unitId
            ? await db.UserBusinessUnits.AsNoTracking()
                .Where(row => row.OrganizationId == organizationId && row.BusinessUnitId == unitId
                    && db.BusinessUnits.Any(unit => unit.Id == row.BusinessUnitId && unit.IsActive))
                .Select(row => row.UserId).Take(MaxUnitAnchorCandidates).ToListAsync(cancellationToken)
            : [];

        var candidates = new HashSet<Guid>(unitAssignees);
        foreach (var anchored in new[] { leader, vacancy.AssignedTo, vacancy.CreatedBy })
        {
            if (anchored is { } anchoredId) candidates.Add(anchoredId);
        }

        var candidateIds = candidates.ToList();
        var roleRows = await (
            from userRole in db.UserRoles.AsNoTracking()
            join role in db.Roles.AsNoTracking() on userRole.RoleId equals role.Id
            where candidateIds.Contains(userRole.UserId) && role.OrganizationId == organizationId
                && role.IsActive && staffSlugs.Contains(role.Slug)
            select new { userRole.UserId, role.Id, role.Slug }).ToListAsync(cancellationToken);
        var roleIds = roleRows.Select(row => row.Id).Distinct().ToList();
        var grantRows = await (
            from grant in db.RolePermissions.AsNoTracking()
            join permission in db.Permissions.AsNoTracking() on grant.PermissionId equals permission.Id
            where roleIds.Contains(grant.RoleId) && permission.Module == module && permission.Action == action
            select new { grant.RoleId, grant.Scope }).ToListAsync(cancellationToken);
        var scopesByRole = grantRows.ToLookup(row => row.RoleId, row => row.Scope);

        var narrow = new List<Guid>();
        foreach (var person in roleRows.GroupBy(row => row.UserId))
        {
            var roles = person.Select(row => row.Slug).Distinct(StringComparer.Ordinal).ToList();
            var grants = person.SelectMany(row => scopesByRole[row.Id]
                .Select(scope => new Grant(row.Slug, module, action, scope))).ToList();
            var decision = AccessKernel.Decide(
                new AccessPrincipal(roles, organizationId.ToString(), false), grants, module, action);
            if (decision is { Allowed: true, Scope: { } scope } && VacancyApproverScope.Covers(
                    scope, person.Key, vacancy, leadsVacancyTeam: leader == person.Key,
                    assignedToVacancyUnit: unitAssignees.Contains(person.Key)))
            {
                narrow.Add(person.Key);
            }
        }

        return (OrgWideScopes, narrow);
    }

    /// <summary>Scope strings that resolve to organization/company (legacy 'all' maps to organization).</summary>
    private static readonly string[] OrgWideScopes = ["organization", "company", "all"];

    // A unit with more assigned HR partners than this is not a realistic approver pool; the cap bounds the query.
    private const int MaxUnitAnchorCandidates = 1000;

    /// <summary>`%`, `_` and the escape character are LIKE metacharacters; a search term is literal text.</summary>
    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);
}
