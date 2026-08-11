using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformOrganizations;

namespace Tims.Infrastructure.PlatformOrganizations;

/// <summary>
/// The ONE C# implementation of <c>notify({ organizationId })</c> (<c>packages/api/src/lib/notify.ts:16-41</c>):
/// select every user with <c>is_platform_owner = true</c> and INSERT one <c>notifications</c> row each.
///
/// <para>Extracted in Phase-5 slice 21 (issue #76) because a SECOND repository now performs the same
/// fan-out. The same argument the ledger already makes for
/// <see cref="Tims.Infrastructure.Audit.AuditLogModelConfiguration"/> applies: the per-owner copy and the
/// empty-set early return are USER-VISIBLE behaviour, and two hand-maintained copies would drift into
/// "notifications that differ depending on which mutation produced them" — not a build error, not a test
/// failure.</para>
///
/// <para><b>Runs OUTSIDE the caller's transaction, unscoped.</b> The owner lookup is cross-org by
/// construction, so it cannot run inside a single organization's <c>TenantScope</c>; and a failed fan-out
/// must not undo a completed mutation. It is its own unit of work — see
/// <see cref="IPlatformOrganizationsWriteRepository.NotifyPlatformOwnersAsync"/> for the full rationale and
/// for the recorded BYPASSRLS dependency this one call still carries.</para>
/// </summary>
public static class PlatformOwnerNotifier
{
    public static async Task SendAsync(
        DbContext db,
        DbSet<PlatformOrganizationOwnerEntity> users,
        DbSet<PlatformOrganizationNotificationEntity> notifications,
        PlatformOwnerNotification notification,
        CancellationToken cancellationToken)
    {
        // lib/notify.ts:21-24 — every platform owner, across every organization.
        var ownerIds = await users
            .AsNoTracking()
            .Where(u => u.IsPlatformOwner)
            .Select(u => u.Id)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        // lib/notify.ts:28 — `if (targets.length === 0) return;` (no empty createMany).
        if (ownerIds.Count == 0)
        {
            return;
        }

        foreach (var ownerId in ownerIds)
        {
            notifications.Add(new PlatformOrganizationNotificationEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = notification.OrganizationId,
                UserId = ownerId,
                Type = notification.Type,
                Title = notification.Title,
                Message = notification.Message,
                Module = notification.Module,
                EntityType = notification.EntityType,
                EntityId = notification.EntityId,
                ActionUrl = notification.ActionUrl,
            });
        }

        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }
}
