using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.PlatformInvitations;

namespace Tims.Infrastructure.PlatformInvitations;

public sealed class InvitationResendRepository(InvitationResendDbContext db) : IInvitationResendRepository
{
    public Task<InvitationResendSnapshot?> FindAsync(Guid id, CancellationToken ct) =>
        db.Invitations.AsNoTracking().Where(row => row.Id == id)
            .Select(row => new InvitationResendSnapshot(row.Id, row.Email, row.Token, row.Status,
                row.OrganizationId, row.OrganizationName, row.UpdatedAt)).SingleOrDefaultAsync(ct);

    public async Task<bool> MarkSentAsync(InvitationResendSnapshot expected, DateTime sentAt, DateTime expiresAt, CancellationToken ct)
    {
        // Raw SQL does not inherit the entity property's timestamp mapping: EF defaults DateTime
        // parameters to timestamptz. Pin these parameters to the actual timestamp(3) column type.
        var sent = Timestamp("sent", sentAt);
        var expiry = Timestamp("expiry", expiresAt);
        var updated = Timestamp("version", expected.UpdatedAt);
        // Parameters remain bound; native enum is explicitly cast. Updating updated_at also keeps TS
        // readers/writers coherent, and monotonic ms protects compare-and-set within one clock tick.
        return await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE platform_invitations AS invitation
            SET status = 'sent'::"InvitationStatus", sent_at = delivery.sent, expires_at = delivery.expiry,
                updated_at = GREATEST(delivery.sent, invitation.updated_at + INTERVAL '1 millisecond')
            FROM (SELECT {sent} AS sent, {expiry} AS expiry) AS delivery
            WHERE invitation.id = {expected.Id} AND invitation.token = {expected.Token} AND invitation.updated_at = {updated}
              AND invitation.status::text IN ('pending', 'sent', 'expired')
            """, ct) == 1;
    }

    private static NpgsqlParameter Timestamp(string name, DateTime value) => new(name, NpgsqlDbType.Timestamp)
    {
        Value = DateTime.SpecifyKind(value, DateTimeKind.Unspecified),
    };
}
