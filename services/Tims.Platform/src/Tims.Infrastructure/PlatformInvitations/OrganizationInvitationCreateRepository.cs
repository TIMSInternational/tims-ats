using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Application.PlatformInvitations;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.OrgProvisioning;
using Tims.Infrastructure.PlatformOrganizations;

namespace Tims.Infrastructure.PlatformInvitations;

/// <summary>Uses the existing provisioning context so all setup, invitation and audit writes share
/// one tenant-scoped transaction. No mail is dispatched until CommitAsync succeeds.</summary>
public sealed class OrganizationInvitationCreateRepository(PlatformOrganizationsCreateDbContext db)
    : IOrganizationInvitationCreateRepository
{
    public async Task<OrganizationInvitationPending?> CreateAsync(OrganizationInvitationInput input,
        Guid actorId, DateTime now, CancellationToken ct)
    {
        var organizationId = Guid.NewGuid();
        var invitationId = Guid.NewGuid();
        var token = Guid.NewGuid().ToString();
        var expiresAt = now.AddDays(7);
        var timestamp = now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
        var expiry = expiresAt.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        try
        {
            await OrganizationBundleWriter.CreateAsync(db, organizationId, input.OrganizationName,
                input.OrganizationSlug, input.OrganizationPlan, input.Email, now, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO platform_invitations
                    (id, email, type, organization_id, organization_name, organization_slug, organization_plan,
                     token, status, invited_by_id, expires_at, updated_at)
                VALUES ({invitationId}, {input.Email}, 'org_admin'::"InvitationType", {organizationId},
                    {input.OrganizationName}, {input.OrganizationSlug}, {input.OrganizationPlan}, {token},
                    'pending'::"InvitationStatus", {actorId}, {expiry}::timestamp, {timestamp}::timestamp)
                """, ct);
            db.AuditLogs.Add(new AuditLogEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                ActorId = actorId,
                Action = "org_invitation_created",
                Entity = "platform_invitation",
                EntityId = invitationId.ToString(),
                Metadata = "{\"status\":\"pending\"}",
            });
            await db.SaveChangesAsync(ct);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation &&
                                         ex.ConstraintName == "organizations_slug_key")
        {
            return null;
        }
        await scope.CommitAsync(ct);
        return new(new(invitationId, input.Email, token, "pending", organizationId, input.OrganizationName, now), expiresAt);
    }
}
