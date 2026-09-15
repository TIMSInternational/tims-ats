using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformInvitations;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.PlatformOrganizations;

namespace Tims.Infrastructure.PlatformInvitations;

public sealed class UserInvitationCreateRepository(PlatformOrganizationsCreateDbContext db) : IUserInvitationCreateRepository
{
    public async Task<IReadOnlyList<InvitationRole>?> ListRolesAsync(Guid organizationId, CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, ct);
        if (!await db.Organizations.AnyAsync(o => o.Id == organizationId && o.IsActive && o.DeletedAt == null, ct)) return null;
        var roles = await db.Database.SqlQuery<InvitationRole>($"""
            SELECT slug AS "Slug", name AS "Name" FROM roles
            WHERE organization_id={organizationId} AND is_active=true ORDER BY name,slug LIMIT 100
            """).ToListAsync(ct);
        await scope.CommitAsync(ct);
        return roles;
    }

    public Task<UserInvitationPending> CreateAsync(UserInvitationInput input, Guid actor, DateTime now, CancellationToken ct) =>
        CreateCoreAsync(input, actor, now, false, ct);

    public Task<UserInvitationPending> CreateUniqueAsync(UserInvitationInput input, Guid actor, DateTime now, CancellationToken ct) =>
        CreateCoreAsync(input, actor, now, true, ct);

    private async Task<UserInvitationPending> CreateCoreAsync(UserInvitationInput input, Guid actor, DateTime now, bool unique, CancellationToken ct)
    {
        await using var scope = await TenantScope.BeginAsync(db, input.OrganizationId, ct);
        var org = await db.Organizations.AsNoTracking()
            .Where(o => o.Id == input.OrganizationId && o.IsActive && o.DeletedAt == null)
            .Select(o => new { o.Name }).SingleOrDefaultAsync(ct);
        if (org is null) return new(UserInvitationCreateOutcome.OrganizationUnavailable);
        if (input.RoleSlug is not null)
        {
            var validRole = await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM roles WHERE organization_id={input.OrganizationId}
                    AND slug={input.RoleSlug} AND is_active=true) AS "Value"
                """).SingleAsync(ct);
            if (!validRole) return new(UserInvitationCreateOutcome.RoleUnavailable);
        }
        if (unique)
        {
            // Same key and PostgreSQL hash as the TS bulk repository. Release at commit, before email.
            await db.Database.ExecuteSqlRawAsync("SET LOCAL statement_timeout = '1500ms'", ct);
            var key = $"{input.OrganizationId.ToString().ToLowerInvariant()}:{input.Email.ToLowerInvariant()}";
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", ct);
            var exists = await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM platform_invitations WHERE organization_id={input.OrganizationId}
                    AND lower(email)=lower({input.Email}) AND status::text IN ('pending','sent','accepted')) AS "Value"
                """).SingleAsync(ct);
            if (exists) return new(UserInvitationCreateOutcome.Duplicate);
        }
        var id = Guid.NewGuid(); var token = Guid.NewGuid().ToString(); var expiry = now.AddDays(7);
        var timestamp = now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
        var expiryText = expiry.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO platform_invitations
                (id,email,type,organization_id,organization_name,role_slug,token,status,invited_by_id,expires_at,updated_at)
            VALUES ({id},{input.Email},'user'::"InvitationType",{input.OrganizationId},{org.Name},{input.RoleSlug},
                {token},'pending'::"InvitationStatus",{actor},{expiryText}::timestamp,{timestamp}::timestamp)
            """, ct);
        db.AuditLogs.Add(new AuditLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = input.OrganizationId,
            ActorId = actor,
            Action = "user_invitation_created",
            Entity = "platform_invitation",
            EntityId = id.ToString(),
            Metadata = "{\"status\":\"pending\"}",
        });
        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return new(UserInvitationCreateOutcome.Created, new(id, input.Email, token, "pending", input.OrganizationId, org.Name, now), expiry);
    }
}
