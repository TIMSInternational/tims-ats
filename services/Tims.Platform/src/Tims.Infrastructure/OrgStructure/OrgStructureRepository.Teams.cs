using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Tims.Application.OrgStructure;
using Tims.Domain.OrgStructure;

namespace Tims.Infrastructure.OrgStructure;

/// <summary>
/// Team writes. A leader must be an ACTIVE, non-deleted user of the caller's organization: leader-scoped
/// approvals anchor on <c>teams.leader_id</c>, so a foreign or inactive leader would silently widen or
/// break approval scope. The owning business unit must be active to create or reactivate a team.
/// </summary>
public sealed partial class OrgStructureRepository
{
    internal const string TeamEntity = "team";

    public async Task<OrgWriteResult<TeamRow>> CreateTeamAsync(
        OrgActor actor, CreateTeamInput input, DateTime now, CancellationToken ct)
    {
        var org = actor.OrganizationId;
        await using var scope = await TenantScope.BeginAsync(db, org, ct);
        var unit = await LockBusinessUnitAsync(org, input.BusinessUnitId, ct);
        if (unit is null) return Fail<TeamRow>(OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);
        if (!unit.IsActive) return Fail<TeamRow>(OrgWriteStatus.Conflict, OrgStructureErrorCodes.BusinessUnitInactive);
        if (input.LeaderUserId is { } leaderId && await CheckActiveUserAsync(org, leaderId, ct) is { } leaderFailure)
        {
            return Fail<TeamRow>(leaderFailure.Status, leaderFailure.Code);
        }

        var id = Guid.NewGuid();
        var updatedAt = ToTimestampText(now);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, updated_at)
            VALUES ({id}, {org}, {input.BusinessUnitId}, {input.Name}, {input.LeaderUserId}, {updatedAt}::timestamp)
            """, ct);
        AddAudit(actor, "team_created", TeamEntity, id, null, new JsonObject
        {
            ["name"] = input.Name,
            ["businessUnitId"] = input.BusinessUnitId.ToString(),
            ["leaderUserId"] = input.LeaderUserId?.ToString(),
        });
        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return OrgWriteResult<TeamRow>.Success(
            new TeamRow(id, input.Name, input.BusinessUnitId, true, input.LeaderUserId), OrgWriteStatus.Created);
    }

    public async Task<OrgWriteResult<TeamRow>> UpdateTeamAsync(
        OrgActor actor, Guid teamId, UpdateTeamInput input, DateTime now, CancellationToken ct)
    {
        var org = actor.OrganizationId;
        await using var scope = await TenantScope.BeginAsync(db, org, ct);
        var teams = await db.Teams.FromSqlInterpolated($"""
            SELECT id, organization_id, business_unit_id, name, leader_id, is_active FROM teams
            WHERE id = {teamId} AND organization_id = {org} FOR UPDATE
            """).AsNoTracking().ToListAsync(ct);
        if (teams.Count != 1) return Fail<TeamRow>(OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);
        var current = teams[0];

        if (input.IsActive is { IsSet: true, Value: true } && !current.IsActive)
        {
            var unit = await LockBusinessUnitAsync(org, current.BusinessUnitId, ct);
            if (unit is not { IsActive: true })
            {
                return Fail<TeamRow>(OrgWriteStatus.Conflict, OrgStructureErrorCodes.BusinessUnitInactive);
            }
        }

        if (input.LeaderUserId is { IsSet: true, Value: { } leaderId }
            && await CheckActiveUserAsync(org, leaderId, ct) is { } leaderFailure)
        {
            return Fail<TeamRow>(leaderFailure.Status, leaderFailure.Code);
        }

        var name = input.Name.IsSet ? input.Name.Value : current.Name;
        var isActive = input.IsActive.IsSet ? input.IsActive.Value : current.IsActive;
        var leader = input.LeaderUserId.IsSet ? input.LeaderUserId.Value : current.LeaderId;
        var updatedAt = ToTimestampText(now);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE teams SET name = {name}, is_active = {isActive}, leader_id = {leader},
                updated_at = {updatedAt}::timestamp
            WHERE id = {teamId} AND organization_id = {org}
            """, ct);

        var changes = new JsonObject();
        if (input.Name.IsSet) changes["name"] = name;
        if (input.IsActive.IsSet) changes["isActive"] = isActive;
        if (input.LeaderUserId.IsSet) changes["leaderUserId"] = leader?.ToString();
        AddAudit(actor, "team_updated", TeamEntity, teamId, changes, null);
        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return OrgWriteResult<TeamRow>.Success(new TeamRow(teamId, name, current.BusinessUnitId, isActive, leader));
    }

    public async Task<OrgWriteResult<TeamMembershipRow>> PutTeamMemberAsync(
        OrgActor actor, Guid teamId, Guid userId, string role, CancellationToken ct)
    {
        var org = actor.OrganizationId;
        await using var scope = await TenantScope.BeginAsync(db, org, ct);
        var team = await db.Teams.AsNoTracking()
            .Where(row => row.Id == teamId && row.OrganizationId == org)
            .Select(row => new { row.IsActive }).SingleOrDefaultAsync(ct);
        if (team is null) return Fail<TeamMembershipRow>(OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);
        if (!team.IsActive) return Fail<TeamMembershipRow>(OrgWriteStatus.Conflict, OrgStructureErrorCodes.TeamInactive);
        if (await CheckActiveUserAsync(org, userId, ct) is { } userFailure)
        {
            return Fail<TeamMembershipRow>(userFailure.Status, userFailure.Code);
        }

        var existing = await db.UserTeams.AsNoTracking()
            .Where(row => row.TeamId == teamId && row.UserId == userId)
            .Select(row => row.Role).SingleOrDefaultAsync(ct);
        var result = new TeamMembershipRow(teamId, userId, role);
        if (existing == role)
        {
            await scope.CommitAsync(ct);
            return OrgWriteResult<TeamMembershipRow>.Success(result);
        }

        var id = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO user_teams (id, user_id, team_id, role) VALUES ({id}, {userId}, {teamId}, {role})
            ON CONFLICT (user_id, team_id) DO UPDATE SET role = EXCLUDED.role
            """, ct);
        AddAudit(actor, existing is null ? "team_member_added" : "team_member_role_changed", TeamEntity, teamId,
            existing is null ? null : new JsonObject { ["role"] = role },
            new JsonObject { ["userId"] = userId.ToString(), ["role"] = role });
        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return OrgWriteResult<TeamMembershipRow>.Success(result);
    }

    public async Task<OrgWriteResult<TeamMembershipRow>> DeleteTeamMemberAsync(
        OrgActor actor, Guid teamId, Guid userId, CancellationToken ct)
    {
        var org = actor.OrganizationId;
        await using var scope = await TenantScope.BeginAsync(db, org, ct);
        // The team predicate carries the organization; RLS on user_teams (parent subquery) is the backstop.
        var deleted = await db.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM user_teams WHERE team_id = {teamId} AND user_id = {userId}
              AND EXISTS (SELECT 1 FROM teams t WHERE t.id = {teamId} AND t.organization_id = {org})
            """, ct);
        if (deleted == 0) return Fail<TeamMembershipRow>(OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);
        AddAudit(actor, "team_member_removed", TeamEntity, teamId, null,
            new JsonObject { ["userId"] = userId.ToString() });
        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return OrgWriteResult<TeamMembershipRow>.Success(
            new TeamMembershipRow(teamId, userId, string.Empty), OrgWriteStatus.NoContent);
    }

    /// <summary>
    /// Null when <paramref name="userId"/> is an active, non-deleted user of <paramref name="org"/>. Foreign,
    /// unknown and deleted users are all NotFound (never reveals another tenant's ids); a dormant user of the
    /// same organization is a 400 so the admin can tell "reactivate them first" from "no such person".
    /// </summary>
    private async Task<(OrgWriteStatus Status, string Code)?> CheckActiveUserAsync(Guid org, Guid userId, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking()
            .Where(row => row.Id == userId && row.OrganizationId == org && row.DeletedAt == null)
            .Select(row => new { row.IsActive }).SingleOrDefaultAsync(ct);
        if (user is null) return (OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);
        return user.IsActive ? null : (OrgWriteStatus.BadRequest, OrgStructureErrorCodes.UserInactive);
    }

    private static OrgWriteResult<T> Fail<T>(OrgWriteStatus status, string code) => OrgWriteResult<T>.Fail(status, code);
}
