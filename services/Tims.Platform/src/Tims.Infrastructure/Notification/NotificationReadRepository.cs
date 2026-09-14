using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Tims.Application.Notification;

namespace Tims.Infrastructure.Notification;

/// <summary>
/// EF implementation of <see cref="INotificationReadRepository"/> — <c>list</c>, <c>unreadCount</c> and the read
/// half of <c>getPreferences</c> (notification.ts:20-124). Every query is <c>AsNoTracking()</c> and runs UNDER
/// <see cref="TenantScope"/>, and every one carries the explicit <c>user_id == callerUserId</c> predicate that
/// is this surface's authorization boundary.
///
/// <para><b>The <c>user_id</c> predicate is not defence-in-depth here — it is the whole control.</b> On an
/// org-scoped surface a cross-org test cannot tell the explicit predicate apart from RLS, because
/// <see cref="TenantScope"/> opens with the same organization id the predicate uses. That is NOT the situation
/// here: RLS filters by <c>organization_id</c> while this predicate filters by <c>user_id</c>, so deleting it
/// would expose every co-tenant's notifications to every other user in the org. It is mutation-provable and it
/// is mutation-proved (<c>OtherUsersNotification_IsNeverReturned</c>).</para>
/// </summary>
public sealed class NotificationReadRepository(NotificationDbContext db) : INotificationReadRepository
{
    private readonly NotificationDbContext _db = db;

    public async Task<IReadOnlyList<NotificationRow>> ListAsync(
        Guid? organizationId,
        Guid userId,
        int limit,
        Guid? cursor,
        bool unreadOnly,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // where: { userId, archived: false, ...(unreadOnly ? { read: false } : {}) }
        var filtered = _db.Notifications.AsNoTracking().Where(n => n.UserId == userId && !n.Archived);
        if (unreadOnly)
        {
            filtered = filtered.Where(n => !n.Read);
        }

        var skip = 0;
        if (cursor is { } cursorId)
        {
            // Prisma's cursor is positional: it resolves the cursor row's orderBy value and pages relative to
            // it, then `skip: 1` steps past the cursor row itself. The boundary lookup is scoped to the
            // CALLER'S OWN rows — not to the archived/unreadOnly filters, which would move the boundary for a
            // cursor minted under different filters, and not unscoped, which would turn the cursor into an
            // oracle for another user's notification timestamps. An unknown or foreign cursor yields no
            // boundary → an empty page, never a leak (the ExternalAssessmentRepository precedent).
            var boundary = await _db.Notifications.AsNoTracking()
                .Where(n => n.Id == cursorId && n.UserId == userId)
                .Select(n => (DateTime?)n.CreatedAt)
                .FirstOrDefaultAsync(cancellationToken)
                .ConfigureAwait(false);
            if (boundary is null)
            {
                await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
                return [];
            }

            // `<=` (not `<`) with OFFSET 1 is Prisma's own shape for a DESC cursor over a NON-UNIQUE column.
            // It is tie-fragile by construction — rows sharing the boundary timestamp can repeat or vanish
            // across pages — and that fragility is reproduced rather than repaired. See the slice doc.
            filtered = filtered.Where(n => n.CreatedAt <= boundary.Value);
            skip = 1;
        }

        var rows = await filtered
            .OrderByDescending(n => n.CreatedAt)
            .Skip(skip)
            .Take(limit + 1)
            .Select(n => new NotificationProjection
            {
                Id = n.Id,
                Type = n.Type,
                Title = n.Title,
                Message = n.Message,
                Module = n.Module,
                Read = n.Read,
                ReadAt = n.ReadAt,
                EntityType = n.EntityType,
                EntityId = n.EntityId,
                ActionUrl = n.ActionUrl,
                CreatedAt = n.CreatedAt,
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return [.. rows.Select(MapRow)];
    }

    public async Task<int> CountUnreadAsync(Guid? organizationId, Guid userId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var count = await _db.Notifications.AsNoTracking()
            .CountAsync(n => n.UserId == userId && !n.Read && !n.Archived, cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return count;
    }

    public async Task<NotificationPreferencesRow?> GetPreferencesAsync(
        Guid? organizationId, Guid userId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var row = await _db.NotificationPreferences.AsNoTracking()
            .Where(p => p.UserId == userId)
            .Select(p => new PreferencesProjection
            {
                EmailEnabled = p.EmailEnabled,
                PushEnabled = p.PushEnabled,
                Categories = p.Categories,
                Modules = p.Modules,
                QuietHoursStart = p.QuietHoursStart,
                QuietHoursEnd = p.QuietHoursEnd,
            })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return row is null ? null : MapPreferences(row);
    }

    /// <summary>
    /// Maps the flat projection to the wire row. <c>Guid.ToString()</c> runs in MEMORY, never in the expression
    /// tree — translating it server-side would risk a provider-specific text format, and the TS emits plain
    /// lowercase uuid strings.
    /// </summary>
    internal static NotificationRow MapRow(NotificationProjection p) => new(
        p.Id.ToString(),
        p.Type,
        p.Title,
        p.Message,
        p.Module,
        p.Read,
        p.ReadAt,
        p.EntityType,
        p.EntityId?.ToString(),
        p.ActionUrl,
        p.CreatedAt);

    /// <summary>jsonb arrives as raw JSON text; parse it so STJ emits real JSON, not an escaped string.</summary>
    internal static NotificationPreferencesRow MapPreferences(PreferencesProjection p) => new(
        p.EmailEnabled,
        p.PushEnabled,
        JsonNode.Parse(p.Categories),
        JsonNode.Parse(p.Modules),
        p.QuietHoursStart,
        p.QuietHoursEnd);
}

/// <summary>
/// The EF-side shape of <c>notificationSelect</c> — mapped to the wire row in memory.
///
/// <para>A CLASS with settable properties, not a positional record, and that is a hard requirement rather than
/// a style choice: these types are materialised both by a LINQ projection AND by
/// <c>Database.SqlQuery&lt;T&gt;</c> on the write side, and <c>SqlQuery</c> materialises an unmapped type
/// through a parameterless constructor plus writable properties — a positional record has neither. Same shape
/// as <c>PlanCountRow</c>. The type must NOT be registered in the model, or EF would map a phantom table.</para>
/// </summary>
internal sealed class NotificationProjection
{
    public Guid Id { get; set; }

    public string Type { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string? Message { get; set; }

    public string? Module { get; set; }

    public bool Read { get; set; }

    public DateTime? ReadAt { get; set; }

    public string? EntityType { get; set; }

    public Guid? EntityId { get; set; }

    public string? ActionUrl { get; set; }

    public DateTime CreatedAt { get; set; }
}

/// <summary>The EF-side shape of the six selected preference columns. Class, for the reason above.</summary>
internal sealed class PreferencesProjection
{
    public bool EmailEnabled { get; set; }

    public bool PushEnabled { get; set; }

    public string Categories { get; set; } = string.Empty;

    public string Modules { get; set; } = string.Empty;

    public string? QuietHoursStart { get; set; }

    public string? QuietHoursEnd { get; set; }
}
