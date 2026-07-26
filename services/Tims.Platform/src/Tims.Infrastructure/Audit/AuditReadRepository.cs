using Microsoft.EntityFrameworkCore;
using Tims.Application.Audit;
using Tims.Domain.Audit;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// Read-only port of TS <c>getCrossOrgAuditLogs</c>/<c>exportAuditLogsCsv</c>
/// (routers/platform/system.ts:267-326). Deliberately runs WITHOUT
/// <see cref="Tims.Infrastructure.TenantScope"/> — see <see cref="AuditReadDbContext"/>'s doc comment.
/// Every query is <c>AsNoTracking()</c>; <c>SaveChanges</c> is never called.
///
/// Both methods LEFT JOIN by id (no EF navigation properties on <see cref="AuditLogEntity"/> —
/// see <see cref="AuditReadDbContext"/>) rather than a nav-property <c>Include</c>, matching the TS
/// query's own LEFT JOIN semantics exactly: <c>actorId</c>/<c>organizationId</c> can be null or
/// point at a row that itself doesn't exist, and the response must degrade to a null actor / "Sistema"
/// (endpoint concern, Task 6) rather than throw or silently drop the audit row.
/// </summary>
public sealed class AuditReadRepository(AuditReadDbContext db) : IAuditReadRepository
{
    private const int ExportCap = 1000;

    private readonly AuditReadDbContext _db = db;

    public async Task<(IReadOnlyList<AuditLogListItem> Logs, Guid? NextCursor, int Total)> ListAsync(
        AuditLogFilter filter, int take, Guid? cursor, CancellationToken cancellationToken)
    {
        var query = ApplyFilter(_db.AuditLogs.AsNoTracking(), filter).OrderByDescending(a => a.CreatedAt);

        if (cursor is { } cursorId)
        {
            var cursorRow = await _db.AuditLogs.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == cursorId, cancellationToken).ConfigureAwait(false);
            if (cursorRow is null)
            {
                // Cursor doesn't resolve to a row (stale/unknown id). Matches Prisma's real
                // findMany({ cursor: { id }, skip: 1 }) behavior: an unresolvable cursor yields an
                // EMPTY page, never "fall back to page 1". `total` is still computed via the same
                // ApplyFilter(...) count query used by the success path below, independent of the
                // stale cursor, so callers still see the true total.
                var totalForUnknownCursor = await ApplyFilter(_db.AuditLogs.AsNoTracking(), filter)
                    .CountAsync(cancellationToken).ConfigureAwait(false);
                return (Array.Empty<AuditLogListItem>(), null, totalForUnknownCursor);
            }

            query = query.Where(a => a.CreatedAt < cursorRow.CreatedAt
                || (a.CreatedAt == cursorRow.CreatedAt && a.Id.CompareTo(cursorRow.Id) < 0))
                .OrderByDescending(a => a.CreatedAt);
        }

        var page = await query.Take(take + 1).ToListAsync(cancellationToken).ConfigureAwait(false);
        Guid? nextCursor = null;
        if (page.Count > take)
        {
            nextCursor = page[take].Id;
            page.RemoveAt(take);
        }

        var total = await ApplyFilter(_db.AuditLogs.AsNoTracking(), filter)
            .CountAsync(cancellationToken).ConfigureAwait(false);

        // A single batched actor lookup (not N+1): fetch every distinct non-null ActorId this page
        // references, then join client-side. The page is bounded (<= take+1, <= 100 per Task 6's
        // MaxTake), so this is one extra round-trip, never one per row.
        var actorIds = page.Where(a => a.ActorId is not null).Select(a => a.ActorId!.Value).Distinct().ToList();
        var actors = await _db.Actors.AsNoTracking()
            .Where(u => actorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken).ConfigureAwait(false);

        var items = page.Select(a => new AuditLogListItem(
            a.Id, a.Action, a.Entity, a.EntityId, a.UserId, a.Metadata, a.CreatedAt, a.IpAddress,
            a.ActorId is { } actorId && actors.TryGetValue(actorId, out var actor)
                ? new AuditLogActorView(actor.Id, actor.FirstName, actor.LastName, actor.Email, actor.Avatar)
                : null)).ToList();

        return (items, nextCursor, total);
    }

    public async Task<IReadOnlyList<AuditLogExportRow>> ExportAsync(AuditLogFilter filter, CancellationToken cancellationToken)
    {
        var rows = await ApplyFilter(_db.AuditLogs.AsNoTracking(), filter)
            .OrderByDescending(a => a.CreatedAt)
            .Take(ExportCap)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var orgIds = rows.Select(a => a.OrganizationId).Distinct().ToList();
        var orgs = await _db.Organizations.AsNoTracking()
            .Where(o => orgIds.Contains(o.Id))
            .ToDictionaryAsync(o => o.Id, cancellationToken).ConfigureAwait(false);

        var actorIds = rows.Where(a => a.ActorId is not null).Select(a => a.ActorId!.Value).Distinct().ToList();
        var actors = await _db.Actors.AsNoTracking()
            .Where(u => actorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken).ConfigureAwait(false);

        return rows.Select(a =>
        {
            // organization_id is NOT NULL with a REQUIRED FK to organizations(id) (system.prisma:31) —
            // the lookup is trusted to always hit; a miss would mean a genuine data-integrity
            // violation, so this throws (KeyNotFoundException) rather than silently coalescing to a
            // placeholder that would mask the bug.
            var org = orgs[a.OrganizationId];
            AuditActorReadEntity? actor = a.ActorId is { } actorId && actors.TryGetValue(actorId, out var found) ? found : null;
            return new AuditLogExportRow(
                a.Action, a.Entity, a.EntityId, a.IpAddress, a.CreatedAt,
                org.Name, actor?.FirstName, actor?.LastName, actor?.Email);
        }).ToList();
    }

    private static IQueryable<AuditLogEntity> ApplyFilter(IQueryable<AuditLogEntity> query, AuditLogFilter filter)
    {
        if (filter.UserId is { } userId) query = query.Where(a => a.ActorId == userId);
        if (filter.OrganizationId is { } orgId) query = query.Where(a => a.OrganizationId == orgId);
        if (filter.Action is { } action) query = query.Where(a => a.Action == action);
        if (filter.Entity is { } entity) query = query.Where(a => a.Entity == entity);
        if (filter.DateFrom is { } from) query = query.Where(a => a.CreatedAt >= from);
        if (filter.DateTo is { } to) query = query.Where(a => a.CreatedAt <= to);
        return query;
    }
}
