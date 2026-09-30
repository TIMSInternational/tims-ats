using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.PlatformInvitations;
using Tims.Domain.Identity;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.PlatformOrganizations;

namespace Tims.Infrastructure.PlatformInvitations;

/// <summary>
/// Tenant-bound access to <c>platform_invitations</c> for the company-admin invitation surface. Every
/// statement runs inside <see cref="TenantScope"/> for the caller's organization AND filters
/// <c>organization_id</c> explicitly (defense in depth: the prod login role is BYPASSRLS). Unlike
/// <see cref="InvitationResendRepository"/> (privileged, cross-org, platform-owner only) this repository
/// can never read or update another organization's row. The token is read only for delivery and never
/// leaves the application layer.
/// </summary>
public sealed class TenantInvitationRepository(PlatformOrganizationsCreateDbContext db) : ITenantInvitationRepository
{
    // Hard ceiling on one statement, independent of the use case's own validation (MaxTake + 1 look-ahead).
    private const int MaxRows = TenantInvitationListQuery.MaxTake + 1;

    public async Task<IReadOnlyList<TenantInvitationRow>> ListOpenAsync(Guid organizationId, TenantInvitationListFilter filter,
        int take, Guid? cursor, DateTime now, CancellationToken ct)
    {
        var limit = Math.Clamp(take, 1, MaxRows);
        var filterName = filter switch
        {
            TenantInvitationListFilter.Active => "active",
            TenantInvitationListFilter.Expired => "expired",
            _ => "all",
        };
        // Typed parameters, each bound ONCE in the args CTE: a bare DateTime hole would bind as timestamptz
        // against the naive column (TRAP 10), and a null Guid needs an explicit uuid type.
        var nowParameter = new NpgsqlParameter("now", NpgsqlDbType.Timestamp) { Value = DateTime.SpecifyKind(now, DateTimeKind.Unspecified) };
        var cursorParameter = new NpgsqlParameter("cursor", NpgsqlDbType.Uuid) { Value = cursor is { } c ? c : DBNull.Value };
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        // Keyset pagination on (created_at DESC, id DESC). The anchor is resolved inside this organization only,
        // so an unknown or foreign cursor compares against NULL and yields an empty page (never another org's).
        // Effective status: a pending/sent row past expires_at IS expired, whether or not a job flipped it.
        var rows = await db.Database.SqlQuery<TenantInvitationRow>($"""
            WITH args AS (SELECT {nowParameter} AS now, {cursorParameter} AS cursor),
            anchor AS (
                SELECT i.created_at, i.id FROM platform_invitations i, args
                WHERE i.id = args.cursor AND i.organization_id = {organizationId} AND i.type::text = 'user')
            SELECT i.id AS "Id", i.email AS "Email", i.role_slug AS "RoleSlug",
                   CASE WHEN i.status::text IN ('pending', 'sent') AND i.expires_at <= args.now
                        THEN 'expired' ELSE i.status::text END AS "Status",
                   i.created_at AS "CreatedAt", i.expires_at AS "ExpiresAt", i.sent_at AS "SentAt"
            FROM platform_invitations i, args
            WHERE i.organization_id = {organizationId} AND i.type::text = 'user'
              AND i.status::text IN ('pending', 'sent', 'expired')
              AND ({filterName} = 'all'
                   OR ({filterName} = 'active' AND i.status::text IN ('pending', 'sent') AND i.expires_at > args.now)
                   OR ({filterName} = 'expired' AND (i.status::text = 'expired' OR i.expires_at <= args.now)))
              AND (args.cursor IS NULL OR (i.created_at, i.id) < (SELECT anchor.created_at, anchor.id FROM anchor))
            ORDER BY i.created_at DESC, i.id DESC
            LIMIT {limit}
            """).ToListAsync(ct);
        await scope.CommitAsync(ct);
        return rows.Select(row => row with
        {
            CreatedAt = DateTime.SpecifyKind(row.CreatedAt, DateTimeKind.Utc),
            ExpiresAt = DateTime.SpecifyKind(row.ExpiresAt, DateTimeKind.Utc),
            SentAt = row.SentAt is { } sent ? DateTime.SpecifyKind(sent, DateTimeKind.Utc) : null,
        }).ToList();
    }

    public async Task<TenantInvitationRevokeOutcome> RevokeAsync(Guid organizationId, Guid id, Guid actor, DateTime now, CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        var status = await db.Database.SqlQuery<string>($"""
            SELECT status::text AS "Value" FROM platform_invitations
            WHERE id = {id} AND organization_id = {organizationId} AND type::text = 'user' FOR UPDATE
            """).SingleOrDefaultAsync(ct);
        if (status is null) return TenantInvitationRevokeOutcome.NotFound;
        if (status is not ("pending" or "sent" or "expired")) return TenantInvitationRevokeOutcome.InvalidStatus;
        var timestamp = now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE platform_invitations
            SET status = 'revoked'::"InvitationStatus",
                updated_at = GREATEST({timestamp}::timestamp, updated_at + INTERVAL '1 millisecond')
            WHERE id = {id} AND organization_id = {organizationId}
            """, ct);
        db.AuditLogs.Add(new AuditLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            ActorId = actor,
            Action = "user_invitation_revoked",
            Entity = "platform_invitation",
            EntityId = id.ToString(),
            Metadata = "{\"previousStatus\":\"" + status + "\"}",
        });
        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return TenantInvitationRevokeOutcome.Revoked;
    }

    public async Task<TenantInvitationTarget?> FindTargetAsync(Guid organizationId, Guid id, CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        var row = await db.Database.SqlQuery<TenantInvitationTarget>($"""
            SELECT role_slug AS "RoleSlug", sent_at AS "SentAt", status::text AS "Status" FROM platform_invitations
            WHERE id = {id} AND organization_id = {organizationId} AND type::text = 'user'
            """).SingleOrDefaultAsync(ct);
        await scope.CommitAsync(ct);
        return row;
    }

    public IInvitationResendRepository ForOrganization(Guid organizationId, IReadOnlyList<string> grantableRoles) =>
        new Scoped(db, organizationId, grantableRoles.ToArray(), TenantInvitationsUseCase.ResendCooldown);

    /// <remarks>
    /// Both statements also require the invitation's effective role (<c>COALESCE(role_slug, 'employee')</c>, as
    /// acceptance computes it) to be one the caller may grant, so the use case's pre-delivery role check cannot
    /// be raced into resending an invitation whose role changed in between. The mark-sent UPDATE also refuses to
    /// record a delivery less than <c>cooldown</c> after the stored <c>sent_at</c> (a never-sent row, including a
    /// freshly created one, always passes), so the use case's pre-send cooldown check cannot be raced either.
    /// </remarks>
    private sealed class Scoped(PlatformOrganizationsCreateDbContext db, Guid organizationId, string[] grantableRoles, TimeSpan cooldown)
        : IInvitationResendRepository
    {
        private const string DefaultRole = RoleSlugs.DefaultStaffRole;

        public async Task<InvitationResendSnapshot?> FindAsync(Guid id, CancellationToken ct)
        {
            await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
            var row = await db.Database.SqlQuery<InvitationResendSnapshot>($"""
                SELECT id AS "Id", email AS "Email", token AS "Token", status::text AS "Status",
                       organization_id AS "OrganizationId", organization_name AS "OrganizationName", updated_at AS "UpdatedAt"
                FROM platform_invitations
                WHERE id = {id} AND organization_id = {organizationId} AND type::text = 'user'
                  AND COALESCE(role_slug, {DefaultRole}) = ANY({grantableRoles})
                """).SingleOrDefaultAsync(ct);
            await scope.CommitAsync(ct);
            return row;
        }

        public async Task<bool> MarkSentAsync(InvitationResendSnapshot expected, DateTime sentAt, DateTime expiresAt, CancellationToken ct)
        {
            if (expected.OrganizationId != organizationId) return false;
            await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
            var sent = Timestamp("sent", sentAt);
            var expiry = Timestamp("expiry", expiresAt);
            var updated = Timestamp("version", expected.UpdatedAt);
            var cooldownFloor = Timestamp("cooldown", sentAt - cooldown);
            // Same guarded compare-and-set as the platform resend path, plus the organization predicate.
            var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE platform_invitations AS invitation
                SET status = 'sent'::"InvitationStatus", sent_at = delivery.sent, expires_at = delivery.expiry,
                    updated_at = GREATEST(delivery.sent, invitation.updated_at + INTERVAL '1 millisecond')
                FROM (SELECT {sent} AS sent, {expiry} AS expiry) AS delivery
                WHERE invitation.id = {expected.Id} AND invitation.organization_id = {organizationId}
                  AND invitation.token = {expected.Token} AND invitation.updated_at = {updated}
                  AND invitation.status::text IN ('pending', 'sent', 'expired')
                  AND COALESCE(invitation.role_slug, {DefaultRole}) = ANY({grantableRoles})
                  AND (invitation.sent_at IS NULL OR invitation.sent_at <= {cooldownFloor})
                """, ct);
            await scope.CommitAsync(ct);
            return changed == 1;
        }

        private static NpgsqlParameter Timestamp(string name, DateTime value) => new(name, NpgsqlDbType.Timestamp)
        {
            Value = DateTime.SpecifyKind(value, DateTimeKind.Unspecified),
        };
    }
}
