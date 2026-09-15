using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
using Tims.Application.Audit;
using Tims.Domain.Audit;

namespace Tims.Infrastructure.Audit;

public sealed partial class TenantAuditRepository(TenantAuditDbContext db) : ITenantAuditRepository
{
    public async Task<TenantAuditDetail?> GetDetailAsync(Guid organizationId, Guid id, CancellationToken cancellationToken)
    {
        await using var tenant = await TenantScope.BeginAsync(db, organizationId, cancellationToken);
        var row = await db.AuditLogs.AsNoTracking()
            .Where(log => log.OrganizationId == organizationId && log.Id == id)
            .Select(log => new
            {
                log.Id,
                log.OrganizationId,
                log.UserId,
                log.ActorId,
                log.Action,
                log.Entity,
                log.EntityId,
                log.Changes,
                log.Metadata,
                log.IpAddress,
                log.UserAgent,
                log.CreatedAt
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null) { await tenant.CommitAsync(cancellationToken); return null; }
        // Both related people are independently tenant-filtered; malformed cross-tenant references
        // cannot expose another organization's identity fields.
        var people = await db.Users.AsNoTracking()
            .Where(person => person.OrganizationId == organizationId && (person.Id == row.ActorId || person.Id == row.UserId))
            .Select(person => new TenantAuditPerson(person.Id, person.FirstName, person.LastName, person.Email))
            .ToListAsync(cancellationToken);
        await tenant.CommitAsync(cancellationToken);
        return new TenantAuditDetail(row.Id, row.OrganizationId, row.UserId, row.ActorId, row.Action,
            row.Entity, row.EntityId, row.Changes is null ? null : JsonNode.Parse(row.Changes),
            row.Metadata is null ? null : JsonNode.Parse(row.Metadata), row.IpAddress, row.UserAgent,
            DateTime.SpecifyKind(row.CreatedAt, DateTimeKind.Utc),
            people.SingleOrDefault(person => person.Id == row.ActorId),
            people.SingleOrDefault(person => person.Id == row.UserId));
    }

    public async Task<IReadOnlyList<TenantAccessReportRow>> GetAccessReportAsync(
        Guid organizationId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo,
        CancellationToken cancellationToken)
    {
        await using var tenant = await TenantScope.BeginAsync(db, organizationId, cancellationToken);
        var query = db.AuditLogs.AsNoTracking()
            .Where(row => row.OrganizationId == organizationId && row.Action == "access");
        // Prisma timestamp columns contain UTC wall-clock values (no timezone).
        if (dateFrom is { } from)
        {
            var utcFrom = DateTime.SpecifyKind(from.UtcDateTime, DateTimeKind.Unspecified);
            query = query.Where(row => row.CreatedAt >= utcFrom);
        }
        if (dateTo is { } to)
        {
            var utcTo = DateTime.SpecifyKind(to.UtcDateTime, DateTimeKind.Unspecified);
            query = query.Where(row => row.CreatedAt <= utcTo);
        }
        var counts = await query.GroupBy(row => new { row.ActorId, row.Entity })
            .Select(group => new { group.Key.ActorId, group.Key.Entity, Count = group.Count() })
            .OrderByDescending(row => row.Count)
            .ThenBy(row => row.ActorId).ThenBy(row => row.Entity)
            .Take(50).ToListAsync(cancellationToken);
        await tenant.CommitAsync(cancellationToken);
        return counts.Select(row => new TenantAccessReportRow(
            row.ActorId, row.Entity, new TenantAccessCount(row.Count))).ToList();
    }
}
