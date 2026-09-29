using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Tims.Application.OrgStructure;
using Tims.Domain.OrgStructure;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.OrgStructure;

/// <summary>
/// Business-unit writes. A business-unit row is locked (<c>FOR UPDATE</c>) before any decision that depends
/// on its active state, and every team create/reactivate takes the same lock, so "deactivate a unit that
/// has no active teams" cannot race a concurrent team creation into the unit.
/// </summary>
public sealed partial class OrgStructureRepository
{
    internal const string BusinessUnitEntity = "business_unit";

    public async Task<OrgWriteResult<BusinessUnitRow>> CreateBusinessUnitAsync(
        OrgActor actor, CreateBusinessUnitInput input, DateTime now, CancellationToken ct)
    {
        var org = actor.OrganizationId;
        await using var scope = await TenantScope.BeginAsync(db, org, ct);
        var companies = await db.Companies.AsNoTracking()
            .Where(company => company.OrganizationId == org && company.IsActive
                && (input.CompanyId == null || company.Id == input.CompanyId))
            .Select(company => company.Id)
            .Take(2)
            .ToListAsync(ct);
        if (input.CompanyId is not null && companies.Count == 0)
        {
            return OrgWriteResult<BusinessUnitRow>.Fail(OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);
        }

        if (companies.Count != 1)
        {
            return OrgWriteResult<BusinessUnitRow>.Fail(OrgWriteStatus.BadRequest, OrgStructureErrorCodes.CompanyRequired);
        }

        var id = Guid.NewGuid();
        var companyId = companies[0];
        var updatedAt = ToTimestampText(now);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO business_units (id, organization_id, company_id, name, code, updated_at)
            VALUES ({id}, {org}, {companyId}, {input.Name}, {input.Code}, {updatedAt}::timestamp)
            """, ct);
        AddAudit(actor, "business_unit_created", BusinessUnitEntity, id, null,
            new JsonObject { ["name"] = input.Name, ["code"] = input.Code, ["companyId"] = companyId.ToString() });
        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return OrgWriteResult<BusinessUnitRow>.Success(
            new BusinessUnitRow(id, input.Name, input.Code, companyId, true), OrgWriteStatus.Created);
    }

    public async Task<OrgWriteResult<BusinessUnitRow>> UpdateBusinessUnitAsync(
        OrgActor actor, Guid businessUnitId, UpdateBusinessUnitInput input, DateTime now, CancellationToken ct)
    {
        var org = actor.OrganizationId;
        await using var scope = await TenantScope.BeginAsync(db, org, ct);
        var current = await LockBusinessUnitAsync(org, businessUnitId, ct);
        if (current is null)
        {
            return OrgWriteResult<BusinessUnitRow>.Fail(OrgWriteStatus.NotFound, OrgStructureErrorCodes.NotFound);
        }

        if (input.IsActive is { IsSet: true, Value: false } && current.IsActive
            && await db.Teams.AnyAsync(team => team.OrganizationId == org
                && team.BusinessUnitId == businessUnitId && team.IsActive, ct))
        {
            return OrgWriteResult<BusinessUnitRow>.Fail(
                OrgWriteStatus.Conflict, OrgStructureErrorCodes.BusinessUnitHasActiveTeams);
        }

        var name = input.Name.IsSet ? input.Name.Value : current.Name;
        var code = input.Code.IsSet ? input.Code.Value : current.Code;
        var isActive = input.IsActive.IsSet ? input.IsActive.Value : current.IsActive;
        var updatedAt = ToTimestampText(now);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE business_units SET name = {name}, code = {code}, is_active = {isActive},
                updated_at = {updatedAt}::timestamp
            WHERE id = {businessUnitId} AND organization_id = {org}
            """, ct);

        var changes = new JsonObject();
        if (input.Name.IsSet) changes["name"] = name;
        if (input.Code.IsSet) changes["code"] = code;
        if (input.IsActive.IsSet) changes["isActive"] = isActive;
        AddAudit(actor, "business_unit_updated", BusinessUnitEntity, businessUnitId, changes, null);
        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return OrgWriteResult<BusinessUnitRow>.Success(
            new BusinessUnitRow(businessUnitId, name, code, current.CompanyId, isActive));
    }

    /// <summary>Row-locks one business unit of the organization and returns it, or null if absent/foreign.</summary>
    private async Task<OrgBusinessUnitEntity?> LockBusinessUnitAsync(Guid org, Guid businessUnitId, CancellationToken ct)
    {
        var rows = await db.BusinessUnits.FromSqlInterpolated($"""
            SELECT id, organization_id, company_id, name, code, is_active FROM business_units
            WHERE id = {businessUnitId} AND organization_id = {org} FOR UPDATE
            """).AsNoTracking().ToListAsync(ct);
        return rows.Count == 1 ? rows[0] : null;
    }

    private void AddAudit(OrgActor actor, string action, string entity, Guid entityId, JsonObject? changes, JsonObject? metadata) =>
        db.AuditLogs.Add(new AuditLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = actor.OrganizationId,
            ActorId = actor.ActorId,
            Action = action,
            Entity = entity,
            EntityId = entityId.ToString(),
            Changes = changes?.ToJsonString(),
            Metadata = metadata?.ToJsonString(),
            IpAddress = actor.IpAddress,
            UserAgent = actor.UserAgent,
        });

    // Prisma writes `timestamp(3) without time zone` holding a UTC wall-clock; bind the same text form.
    private static string ToTimestampText(DateTime value) =>
        value.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
}
