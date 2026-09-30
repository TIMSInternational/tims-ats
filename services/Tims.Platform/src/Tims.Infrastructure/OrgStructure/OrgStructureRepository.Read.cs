using Microsoft.EntityFrameworkCore;
using Tims.Application.OrgStructure;
using Tims.Domain.OrgStructure;

namespace Tims.Infrastructure.OrgStructure;

/// <summary>
/// Reads of the tenant org structure. One <see cref="TenantScope"/> per read; every query carries an
/// explicit organization predicate and a cap from <see cref="OrgStructureLimits"/>. People are projected
/// to { userId, fullName, email } only, and only non-deleted users of the same organization are shown
/// (a drifted leader/member row pointing at another tenant's user never leaks that user).
/// </summary>
public sealed partial class OrgStructureRepository(OrgStructureDbContext db) : IOrgStructureRepository
{
    public async Task<OrgStructureView> ReadStructureAsync(Guid organizationId, CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);

        var units = await db.BusinessUnits.AsNoTracking()
            .Where(unit => unit.OrganizationId == organizationId)
            .OrderBy(unit => unit.Name).ThenBy(unit => unit.Id)
            .Take(OrgStructureLimits.MaxBusinessUnits)
            .Select(unit => new { unit.Id, unit.Name, unit.Code, unit.CompanyId, unit.IsActive })
            .ToListAsync(ct);
        var unitIds = units.Select(unit => unit.Id).ToList();

        var teams = await db.Teams.AsNoTracking()
            .Where(team => team.OrganizationId == organizationId && unitIds.Contains(team.BusinessUnitId))
            .OrderBy(team => team.Name).ThenBy(team => team.Id)
            .Take(OrgStructureLimits.MaxTeams)
            .Select(team => new { team.Id, team.Name, team.BusinessUnitId, team.IsActive, team.LeaderId })
            .ToListAsync(ct);
        var teamIds = teams.Select(team => team.Id).ToList();

        var members = await (
            from membership in db.UserTeams.AsNoTracking()
            join user in ActiveOrDormantUsers(organizationId) on membership.UserId equals user.Id
            where teamIds.Contains(membership.TeamId)
            orderby user.FirstName, user.LastName, user.Id
            select new { membership.TeamId, user.Id, user.FirstName, user.LastName, user.Email, membership.Role })
            .Take(OrgStructureLimits.MaxTeamMembers)
            .ToListAsync(ct);

        var assignees = await (
            from assignment in db.UserBusinessUnits.AsNoTracking()
            join user in ActiveOrDormantUsers(organizationId) on assignment.UserId equals user.Id
            where assignment.OrganizationId == organizationId && unitIds.Contains(assignment.BusinessUnitId)
            orderby user.FirstName, user.LastName, user.Id
            select new { assignment.BusinessUnitId, user.Id, user.FirstName, user.LastName, user.Email })
            .Take(OrgStructureLimits.MaxUnitAssignees)
            .ToListAsync(ct);

        var leaderIds = teams.Where(team => team.LeaderId is not null).Select(team => team.LeaderId!.Value)
            .Distinct().ToList();
        var leaders = await ActiveOrDormantUsers(organizationId)
            .Where(user => leaderIds.Contains(user.Id))
            .Select(user => new { user.Id, user.FirstName, user.LastName, user.Email })
            .ToDictionaryAsync(user => user.Id, ct);

        var companies = await db.Companies.AsNoTracking()
            .Where(company => company.OrganizationId == organizationId && company.IsActive)
            .OrderBy(company => company.Name).ThenBy(company => company.Id)
            .Take(OrgStructureLimits.MaxCompanies)
            .Select(company => new OrgCompany(company.Id, company.Name))
            .ToListAsync(ct);
        await scope.CommitAsync(ct);

        var membersByTeam = members.ToLookup(member => member.TeamId, member => new OrgTeamMember(
            member.Id, OrgStructureInput.FullName(member.FirstName, member.LastName), member.Email, member.Role));
        var assigneesByUnit = assignees.ToLookup(row => row.BusinessUnitId, row => new OrgPerson(
            row.Id, OrgStructureInput.FullName(row.FirstName, row.LastName), row.Email));
        var teamsByUnit = teams.ToLookup(team => team.BusinessUnitId, team => new OrgTeamView(
            team.Id, team.Name, team.BusinessUnitId, team.IsActive,
            team.LeaderId is { } leaderId && leaders.TryGetValue(leaderId, out var leader)
                ? new OrgPerson(leader.Id, OrgStructureInput.FullName(leader.FirstName, leader.LastName), leader.Email)
                : null,
            membersByTeam[team.Id].ToList()));

        return new OrgStructureView(
            units.Select(unit => new OrgBusinessUnitView(
                unit.Id, unit.Name, unit.Code, unit.CompanyId, unit.IsActive,
                teamsByUnit[unit.Id].Count(team => team.IsActive),
                assigneesByUnit[unit.Id].ToList(),
                teamsByUnit[unit.Id].ToList())).ToList(),
            companies);
    }

    public async Task<OrgStructureOptions> ReadOptionsAsync(Guid organizationId, CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        var units = await db.BusinessUnits.AsNoTracking()
            .Where(unit => unit.OrganizationId == organizationId && unit.IsActive)
            .OrderBy(unit => unit.Name).ThenBy(unit => unit.Id)
            .Take(OrgStructureLimits.MaxBusinessUnits)
            .Select(unit => new { unit.Id, unit.Name })
            .ToListAsync(ct);
        var unitIds = units.Select(unit => unit.Id).ToList();

        // hasLeader means "a leader-scoped approval can resolve for this team": the leader must be an
        // ACTIVE, non-deleted user of this organization, not merely a non-null leader_id.
        var teams = await db.Teams.AsNoTracking()
            .Where(team => team.OrganizationId == organizationId && team.IsActive
                && unitIds.Contains(team.BusinessUnitId))
            .OrderBy(team => team.Name).ThenBy(team => team.Id)
            .Take(OrgStructureLimits.MaxTeams)
            .Select(team => new
            {
                team.Id,
                team.Name,
                team.BusinessUnitId,
                HasLeader = team.LeaderId != null && db.Users.Any(user => user.Id == team.LeaderId
                    && user.OrganizationId == organizationId && user.IsActive && user.DeletedAt == null),
            })
            .ToListAsync(ct);
        await scope.CommitAsync(ct);

        var teamsByUnit = teams.ToLookup(team => team.BusinessUnitId, team => new OrgTeamOption(
            team.Id, team.Name, team.HasLeader));
        return new OrgStructureOptions(units
            .Select(unit => new OrgBusinessUnitOption(unit.Id, unit.Name, teamsByUnit[unit.Id].ToList()))
            .ToList());
    }

    /// <summary>Non-deleted users of the organization (inactive ones stay visible in the management view).</summary>
    private IQueryable<OrgUserEntity> ActiveOrDormantUsers(Guid organizationId) =>
        db.Users.AsNoTracking().Where(user => user.OrganizationId == organizationId && user.DeletedAt == null);
}
