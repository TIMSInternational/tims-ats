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
    private const int MaxRows = 100;

    public async Task<IReadOnlyList<TenantInvitationRow>> ListOpenAsync(Guid organizationId, CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        var rows = await db.Database.SqlQuery<TenantInvitationRow>($"""
            SELECT id AS "Id", email AS "Email", role_slug AS "RoleSlug", status::text AS "Status",
                   created_at AS "CreatedAt", expires_at AS "ExpiresAt", sent_at AS "SentAt"
            FROM platform_invitations
            WHERE organization_id = {organizationId} AND type::text = 'user'
              AND status::text IN ('pending', 'sent', 'expired')
            ORDER BY created_at DESC, id LIMIT {MaxRows}
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
            SELECT role_slug AS "RoleSlug" FROM platform_invitations
            WHERE id = {id} AND organization_id = {organizationId} AND type::text = 'user'
            """).SingleOrDefaultAsync(ct);
        await scope.CommitAsync(ct);
        return row;
    }

    public IInvitationResendRepository ForOrganization(Guid organizationId, IReadOnlyList<string> grantableRoles) =>
        new Scoped(db, organizationId, grantableRoles.ToArray());

    /// <remarks>
    /// Both statements also require the invitation's effective role (<c>COALESCE(role_slug, 'employee')</c>, as
    /// acceptance computes it) to be one the caller may grant, so the use case's pre-delivery role check cannot
    /// be raced into resending an invitation whose role changed in between.
    /// </remarks>
    private sealed class Scoped(PlatformOrganizationsCreateDbContext db, Guid organizationId, string[] grantableRoles)
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
