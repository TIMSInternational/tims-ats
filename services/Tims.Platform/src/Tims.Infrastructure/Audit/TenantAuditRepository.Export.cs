using Microsoft.EntityFrameworkCore;
using Tims.Domain.Audit;

namespace Tims.Infrastructure.Audit;

public sealed partial class TenantAuditRepository
{
    public async Task<IReadOnlyList<TenantAuditExportRow>> ExportAsync(Guid organizationId,
        TenantAuditFilter filter, CancellationToken cancellationToken)
    {
        await using var tenant = await TenantScope.BeginAsync(db, organizationId, cancellationToken);
        // Explicit projection excludes sensitive changes/metadata at the database boundary.
        var rows = await FilteredLogs(organizationId, filter)
            .OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id).Take(10_001)
            .Select(row => new { row.CreatedAt, row.ActorId, row.Action, row.Entity, row.EntityId, row.IpAddress, row.UserAgent })
            .ToListAsync(cancellationToken);
        var ids = rows.Where(row => row.ActorId.HasValue).Select(row => row.ActorId!.Value).Distinct().ToList();
        var actors = await db.Users.AsNoTracking()
            .Where(person => person.OrganizationId == organizationId && ids.Contains(person.Id))
            .Select(person => new TenantAuditPerson(person.Id, person.FirstName, person.LastName, person.Email))
            .ToDictionaryAsync(person => person.Id, cancellationToken);
        await tenant.CommitAsync(cancellationToken);
        return rows.Select(row =>
        {
            var actor = row.ActorId is { } id && actors.TryGetValue(id, out var person) ? person : null;
            return new TenantAuditExportRow(DateTime.SpecifyKind(row.CreatedAt, DateTimeKind.Utc),
                actor is null ? "" : $"{actor.FirstName} {actor.LastName}".Trim(), actor?.Email ?? "",
                row.Action, row.Entity, row.EntityId, row.IpAddress, row.UserAgent);
        }).ToList();
    }
}
