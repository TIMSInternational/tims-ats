using Microsoft.EntityFrameworkCore;
using Tims.Application.Audit;
using Tims.Domain.Audit;

namespace Tims.Infrastructure.Audit;

public sealed class TenantAuditRepository(TenantAuditDbContext db) : ITenantAuditRepository
{
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
