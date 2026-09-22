using Npgsql;
using Tims.Application.PlatformInvitations;
using Tims.Domain.Identity;

namespace Tims.Infrastructure.PlatformInvitations;

/// <summary>Capability-scoped repository. Tenant identity always comes from the locked invitation.</summary>
public sealed class InvitationOnboardingRepository(PlatformInvitationsDataSourceHolder source)
    : IInvitationOnboardingRepository
{
    public async Task<InvitationSetup?> PreviewAsync(string token, CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT i.id,i.email,i.organization_id,o.name,
              CASE WHEN i.type::text='org_admin' THEN 'super_admin' ELSE i.role_slug END,
              i.status::text,i.expires_at,
              EXISTS(SELECT 1 FROM auth.users a WHERE lower(a.email)=lower(i.email)),
              EXISTS(SELECT 1 FROM audit_logs l WHERE l.organization_id=i.organization_id
                AND l.entity_id=i.id::text AND l.action='invitation_account_completed')
            FROM platform_invitations i JOIN organizations o ON o.id=i.organization_id
            WHERE i.token=@token AND o.is_active AND o.deleted_at IS NULL
              AND ((i.type::text='user' AND i.role_slug IS NULL) OR EXISTS(SELECT 1 FROM roles r
                WHERE r.organization_id=i.organization_id AND r.is_active
                  AND r.slug=ANY(@staff_roles)
                  AND r.slug=CASE WHEN i.type::text='org_admin' THEN 'super_admin' ELSE i.role_slug END))
            """, connection);
        command.Parameters.AddWithValue("token", token);
        command.Parameters.AddWithValue("staff_roles", RoleSlugs.AssignableStaffRoles.ToArray());
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? Read(reader) : null;
    }

    private static InvitationSetup Read(NpgsqlDataReader reader) => new(reader.GetGuid(0), reader.GetString(1),
        reader.GetGuid(2), reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetString(4),
        reader.GetString(5), DateTime.SpecifyKind(reader.GetDateTime(6), DateTimeKind.Utc),
        reader.GetBoolean(7), reader.GetBoolean(8));

    public async Task<bool> CompleteAsync(string token, SetupIdentity identity, SetupProfile profile,
        CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using (var guard = new NpgsqlCommand(
            "SELECT pg_advisory_xact_lock(hashtext(@identity))", connection, transaction))
        {
            guard.Parameters.AddWithValue("identity", "invitation-onboarding:" + identity.Id);
            await guard.ExecuteNonQueryAsync(ct);
        }

        InvitationSetup invitation;
        string kind;
        await using (var command = new NpgsqlCommand("""
            SELECT i.id,i.email,i.organization_id,o.name,
              CASE WHEN i.type::text='org_admin' THEN 'super_admin' ELSE i.role_slug END,
              i.status::text,i.expires_at,true,false,i.type::text
            FROM platform_invitations i JOIN organizations o ON o.id=i.organization_id
            WHERE i.token=@token AND o.is_active AND o.deleted_at IS NULL
            FOR UPDATE OF i FOR SHARE OF o
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("token", token);
            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return false;
            invitation = Read(reader);
            kind = reader.GetString(9);
        }

        if (invitation.Status is not ("pending" or "sent" or "accepted") ||
            invitation.ExpiresAt <= DateTime.UtcNow ||
            !string.Equals(invitation.Email, identity.Email, StringComparison.OrdinalIgnoreCase)) return false;

        var roleSlug = kind == "org_admin" ? "super_admin" : invitation.RoleSlug;
        if (roleSlug is not null && !RoleSlugs.AssignableStaffRoles.Contains(roleSlug, StringComparer.Ordinal))
            return false;
        Guid? roleId = null;
        if (roleSlug is not null)
        {
            await using var role = new NpgsqlCommand("""
                SELECT id FROM roles WHERE organization_id=@org AND slug=@slug AND is_active FOR SHARE
                """, connection, transaction);
            role.Parameters.AddWithValue("org", invitation.OrganizationId);
            role.Parameters.AddWithValue("slug", roleSlug);
            roleId = await role.ExecuteScalarAsync(ct) as Guid?;
            if (roleId is null) return false;
        }

        Guid userId;
        var exists = false;
        await using (var find = new NpgsqlCommand("""
            SELECT id,organization_id,is_active,deleted_at,is_platform_owner
            FROM users WHERE supabase_user_id=@identity OR lower(email)=lower(@email) FOR UPDATE
            """, connection, transaction))
        {
            find.Parameters.AddWithValue("identity", identity.Id);
            find.Parameters.AddWithValue("email", identity.Email);
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                userId = reader.GetGuid(0);
                exists = true;
                if (reader.IsDBNull(1) || reader.GetGuid(1) != invitation.OrganizationId ||
                    !reader.GetBoolean(2) || !reader.IsDBNull(3) || reader.GetBoolean(4)) return false;
                if (await reader.ReadAsync(ct)) return false;
            }
            else userId = Guid.NewGuid();
        }

        if (exists)
        {
            await using var match = new NpgsqlCommand(
                "SELECT EXISTS(SELECT 1 FROM users WHERE id=@id AND supabase_user_id=@identity)",
                connection, transaction);
            match.Parameters.AddWithValue("id", userId);
            match.Parameters.AddWithValue("identity", identity.Id);
            if (await match.ExecuteScalarAsync(ct) is not true) return false;
        }

        if (invitation.Status == "accepted")
        {
            if (!exists) return false;
            await using var previous = new NpgsqlCommand("""
                SELECT EXISTS(SELECT 1 FROM audit_logs WHERE organization_id=@org
                  AND entity_id=@invitation AND actor_id=@actor AND action='invitation_account_completed')
                """, connection, transaction);
            previous.Parameters.AddWithValue("org", invitation.OrganizationId);
            previous.Parameters.AddWithValue("invitation", invitation.Id.ToString());
            previous.Parameters.AddWithValue("actor", userId);
            if (await previous.ExecuteScalarAsync(ct) is not true) return false;
            if (roleId is not null)
            {
                await using var retainedRole = new NpgsqlCommand(
                    "SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=@user AND role_id=@role)",
                    connection, transaction);
                retainedRole.Parameters.AddWithValue("user", userId);
                retainedRole.Parameters.AddWithValue("role", roleId.Value);
                if (await retainedRole.ExecuteScalarAsync(ct) is not true) return false;
            }
            await transaction.CommitAsync(ct);
            return true;
        }

        await using (var scope = new NpgsqlCommand(
            "SET LOCAL ROLE app_tenant; SELECT set_config('app.current_org_id',@org,true)", connection, transaction))
        {
            scope.Parameters.AddWithValue("org", invitation.OrganizationId.ToString());
            await scope.ExecuteNonQueryAsync(ct);
        }

        if (!exists)
        {
            await using var insert = new NpgsqlCommand("""
                INSERT INTO users(id,organization_id,supabase_user_id,email,first_name,last_name,updated_at)
                VALUES(@id,@org,@identity,@email,@first,@last,now())
                """, connection, transaction);
            insert.Parameters.AddWithValue("id", userId);
            insert.Parameters.AddWithValue("org", invitation.OrganizationId);
            insert.Parameters.AddWithValue("identity", identity.Id);
            insert.Parameters.AddWithValue("email", invitation.Email);
            insert.Parameters.AddWithValue("first", profile.FirstName.Trim());
            insert.Parameters.AddWithValue("last", profile.LastName.Trim());
            await insert.ExecuteNonQueryAsync(ct);
        }

        if (roleId is not null)
        {
            await using var assign = new NpgsqlCommand("""
                INSERT INTO user_roles(id,user_id,role_id) VALUES(@id,@user,@role)
                ON CONFLICT(user_id,role_id) DO NOTHING
                """, connection, transaction);
            assign.Parameters.AddWithValue("id", Guid.NewGuid());
            assign.Parameters.AddWithValue("user", userId);
            assign.Parameters.AddWithValue("role", roleId.Value);
            await assign.ExecuteNonQueryAsync(ct);
        }

        await using var complete = new NpgsqlCommand("""
            UPDATE platform_invitations SET status='accepted'::"InvitationStatus",
              accepted_at=COALESCE(accepted_at,now()),updated_at=now()
            WHERE id=@id AND organization_id=@org;
            INSERT INTO audit_logs(id,organization_id,actor_id,action,entity,entity_id)
            VALUES(@audit,@org,@actor,'invitation_account_completed','platform_invitation',@entity)
            """, connection, transaction);
        complete.Parameters.AddWithValue("id", invitation.Id);
        complete.Parameters.AddWithValue("org", invitation.OrganizationId);
        complete.Parameters.AddWithValue("audit", Guid.NewGuid());
        complete.Parameters.AddWithValue("actor", userId);
        complete.Parameters.AddWithValue("entity", invitation.Id.ToString());
        await complete.ExecuteNonQueryAsync(ct);

        await transaction.CommitAsync(ct);
        return true;
    }
}
