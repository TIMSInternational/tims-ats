using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Tims.Application.OrgStructure;
using Tims.Domain.OrgStructure;

namespace Tims.Infrastructure.OrgStructure;

/// <summary>
/// People ↔ unit writes: <c>user_business_units</c> (the unit-scope anchor that <c>unitIds()</c> reads) and
/// the direct <c>users.business_unit_id</c> home unit (read by <c>unitMemberIds()</c>).
/// </summary>
public sealed partial class OrgStructureRepository
{
    internal const string UserEntity = "user";

    public async Task<OrgWriteResult<UnitAssignmentRow>> PutUnitAssigneeAsync(
        OrgActor actor, Guid businessUnitId, Guid userId, DateTime now, CancellationToken ct)
    {
        var org = actor.OrganizationId;
        await using var scope = await TenantScope.BeginAsync(db, org, ct);
        var unit = await LockBusinessUnitAsync(org, businessUnitId, ct);
        if (unit is null) return Fail<UnitAssignmentRow>(OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);
        if (!unit.IsActive)
        {
            return Fail<UnitAssignmentRow>(OrgWriteStatus.Conflict, OrgStructureErrorCodes.BusinessUnitInactive);
        }

        if (await CheckActiveUserAsync(org, userId, ct) is { } userFailure)
        {
            return Fail<UnitAssignmentRow>(userFailure.Status, userFailure.Code);
        }

        var id = Guid.NewGuid();
        var updatedAt = ToTimestampText(now);
        var inserted = await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO user_business_units (id, organization_id, user_id, business_unit_id, updated_at)
            VALUES ({id}, {org}, {userId}, {businessUnitId}, {updatedAt}::timestamp)
            ON CONFLICT (user_id, business_unit_id) DO NOTHING
            """, ct);
        if (inserted > 0)
        {
            AddAudit(actor, "business_unit_assignee_added", BusinessUnitEntity, businessUnitId, null,
                new JsonObject { ["userId"] = userId.ToString() });
            await db.SaveChangesAsync(ct);
        }

        await scope.CommitAsync(ct);
        return OrgWriteResult<UnitAssignmentRow>.Success(new UnitAssignmentRow(businessUnitId, userId));
    }

    public async Task<OrgWriteResult<UnitAssignmentRow>> DeleteUnitAssigneeAsync(
        OrgActor actor, Guid businessUnitId, Guid userId, CancellationToken ct)
    {
        var org = actor.OrganizationId;
        await using var scope = await TenantScope.BeginAsync(db, org, ct);
        var deleted = await db.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM user_business_units
            WHERE organization_id = {org} AND business_unit_id = {businessUnitId} AND user_id = {userId}
            """, ct);
        if (deleted == 0) return Fail<UnitAssignmentRow>(OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);
        AddAudit(actor, "business_unit_assignee_removed", BusinessUnitEntity, businessUnitId, null,
            new JsonObject { ["userId"] = userId.ToString() });
        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return OrgWriteResult<UnitAssignmentRow>.Success(new UnitAssignmentRow(businessUnitId, userId), OrgWriteStatus.NoContent);
    }

    public async Task<OrgWriteResult<UserBusinessUnitRow>> SetUserBusinessUnitAsync(
        OrgActor actor, Guid userId, Guid? businessUnitId, DateTime now, CancellationToken ct)
    {
        var org = actor.OrganizationId;
        await using var scope = await TenantScope.BeginAsync(db, org, ct);
        var user = await db.Users.AsNoTracking()
            .Where(row => row.Id == userId && row.OrganizationId == org && row.DeletedAt == null)
            .Select(row => new { row.BusinessUnitId }).SingleOrDefaultAsync(ct);
        if (user is null) return Fail<UserBusinessUnitRow>(OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);

        if (businessUnitId is { } unitId)
        {
            var unit = await LockBusinessUnitAsync(org, unitId, ct);
            if (unit is null) return Fail<UserBusinessUnitRow>(OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);
            if (!unit.IsActive)
            {
                return Fail<UserBusinessUnitRow>(OrgWriteStatus.Conflict, OrgStructureErrorCodes.BusinessUnitInactive);
            }
        }

        var result = new UserBusinessUnitRow(userId, businessUnitId);
        if (user.BusinessUnitId == businessUnitId)
        {
            await scope.CommitAsync(ct);
            return OrgWriteResult<UserBusinessUnitRow>.Success(result);
        }

        var updatedAt = ToTimestampText(now);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE users SET business_unit_id = {businessUnitId}, updated_at = {updatedAt}::timestamp
            WHERE id = {userId} AND organization_id = {org} AND deleted_at IS NULL
            """, ct);
        AddAudit(actor, "user_business_unit_set", UserEntity, userId,
            new JsonObject { ["businessUnitId"] = businessUnitId?.ToString() },
            new JsonObject { ["previousBusinessUnitId"] = user.BusinessUnitId?.ToString() });
        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return OrgWriteResult<UserBusinessUnitRow>.Success(result);
    }
}
