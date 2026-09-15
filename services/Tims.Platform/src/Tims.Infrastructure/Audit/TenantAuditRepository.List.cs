using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
using Tims.Domain.Audit;

namespace Tims.Infrastructure.Audit;

public sealed partial class TenantAuditRepository
{
    public async Task<IReadOnlyList<TenantAuditItem<TenantAuditListActor>>> ListAsync(Guid organizationId,
        TenantAuditFilter filter, int take, Guid? cursor, CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(take, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(take, 100);
        await using var tenant = await TenantScope.BeginAsync(db, organizationId, cancellationToken);
        var query = FilteredLogs(organizationId, filter);
        if (cursor is { } cursorId)
        {
            var anchor = await query.Where(row => row.Id == cursorId)
                .Select(row => new { row.CreatedAt, row.Id }).SingleOrDefaultAsync(cancellationToken);
            if (anchor is null) { await tenant.CommitAsync(cancellationToken); return []; }
            query = query.Where(row => row.CreatedAt < anchor.CreatedAt
                || (row.CreatedAt == anchor.CreatedAt && row.Id.CompareTo(anchor.Id) < 0));
        }
        var rows = await query.OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id)
            .Take(take + 1)
            .Select(row => new
            {
                row.Id,
                row.OrganizationId,
                row.UserId,
                row.ActorId,
                row.Action,
                row.Entity,
                row.EntityId,
                row.Changes,
                row.Metadata,
                row.IpAddress,
                row.UserAgent,
                row.CreatedAt
            })
            .ToListAsync(cancellationToken);
        var actorIds = rows.Where(row => row.ActorId.HasValue).Select(row => row.ActorId!.Value).Distinct().ToList();
        var actors = await db.Users.AsNoTracking()
            .Where(person => person.OrganizationId == organizationId && actorIds.Contains(person.Id))
            .Select(person => new TenantAuditListActor(person.Id, person.FirstName, person.LastName, person.Avatar))
            .ToDictionaryAsync(person => person.Id, cancellationToken);
        await tenant.CommitAsync(cancellationToken);
        return rows.Select(row => new TenantAuditItem<TenantAuditListActor>(
            row.Id, row.OrganizationId, row.UserId, row.ActorId, row.Action, row.Entity, row.EntityId,
            row.Changes is null ? null : JsonNode.Parse(row.Changes),
            row.Metadata is null ? null : JsonNode.Parse(row.Metadata), row.IpAddress, row.UserAgent,
            DateTime.SpecifyKind(row.CreatedAt, DateTimeKind.Utc),
            row.ActorId is { } id && actors.TryGetValue(id, out var actor) ? actor : null)).ToList();
    }
    private IQueryable<AuditLogEntity> FilteredLogs(Guid organizationId, TenantAuditFilter filter)
    {
        var query = db.AuditLogs.AsNoTracking().Where(row => row.OrganizationId == organizationId);
        if (filter.ActorId is { } actorId) query = query.Where(row => row.ActorId == actorId);
        // History uses exact entity/entityId matching, including empty strings; list filters follow TS truthiness.
        if (filter.EntityId is not null)
            query = query.Where(row => row.Entity == filter.Entity && row.EntityId == filter.EntityId);
        else if (!string.IsNullOrEmpty(filter.Entity)) query = query.Where(row => row.Entity == filter.Entity);
        if (!string.IsNullOrEmpty(filter.Action)) query = query.Where(row => row.Action == filter.Action);
        if (filter.DateFrom is { } from)
        {
            var date = DateTime.SpecifyKind(from.UtcDateTime, DateTimeKind.Unspecified);
            query = query.Where(row => row.CreatedAt >= date);
        }
        if (filter.DateTo is { } to)
        {
            var date = DateTime.SpecifyKind(to.UtcDateTime, DateTimeKind.Unspecified);
            query = query.Where(row => row.CreatedAt <= date);
        }
        return query;
    }
}
