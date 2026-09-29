using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Application.PlatformInvitations;
using Tims.Infrastructure.PlatformInvitations;

namespace Tims.IntegrationTests.PlatformInvitations;

[Collection("InvitationOnboardingRepository")]
public sealed class InvitationOnboardingRepositoryTests(InvitationOnboardingRepositoryFixture fixture)
{
    private readonly InvitationOnboardingRepositoryFixture _fixture = fixture;

    [Fact]
    public async Task Completion_atomically_creates_tenant_user_role_audit_and_consumes_invitation()
    {
        var seeded = await _fixture.SeedAsync("invitee@example.test", "user", "recruiter");
        var repository = _fixture.Repository();
        var preview = await repository.PreviewAsync(seeded.Token, default);
        Assert.NotNull(preview);
        Assert.False(preview!.AccountExists);

        var identity = new SetupIdentity(Guid.NewGuid().ToString(), "INVITEE@example.test");
        Assert.True(await repository.CompleteAsync(seeded.Token, identity, new("Test", "Recipient"), default));
        Assert.True(await repository.CompleteAsync(seeded.Token, identity, new("Test", "Recipient"), default));

        var state = await _fixture.StateAsync(seeded.InvitationId);
        Assert.Equal("accepted", state.Status);
        Assert.Equal(1, state.Users);
        Assert.Equal(1, state.Grants);
        Assert.Equal(1, state.Audits);
    }

    [Fact]
    public async Task Org_admin_maps_to_active_super_admin_role()
    {
        var seeded = await _fixture.SeedAsync("admin@example.test", "org_admin", null);
        var repository = _fixture.Repository();
        var preview = await repository.PreviewAsync(seeded.Token, default);
        Assert.Equal("super_admin", preview!.RoleSlug);
        Assert.True(await repository.CompleteAsync(seeded.Token,
            new(Guid.NewGuid().ToString(), "admin@example.test"), new("Org", "Admin"), default));
        Assert.Equal("super_admin", await _fixture.AssignedRoleAsync(seeded.InvitationId));
    }

    [Fact]
    public async Task Wrong_email_and_cross_org_existing_user_fail_without_partial_writes()
    {
        var seeded = await _fixture.SeedAsync("conflict@example.test", "user", "recruiter");
        var repository = _fixture.Repository();
        Assert.False(await repository.CompleteAsync(seeded.Token,
            new(Guid.NewGuid().ToString(), "wrong@example.test"), new("Wrong", "Account"), default));

        var identity = Guid.NewGuid().ToString();
        await _fixture.SeedExistingUserAsync(identity, "conflict@example.test", Guid.NewGuid());
        Assert.False(await repository.CompleteAsync(seeded.Token,
            new(identity, "conflict@example.test"), new("Cross", "Tenant"), default));
        var state = await _fixture.StateAsync(seeded.InvitationId);
        Assert.Equal("sent", state.Status);
        Assert.Equal(0, state.Audits);
    }

    [Fact]
    public async Task Inactive_role_hides_invitation_and_prevents_access()
    {
        var seeded = await _fixture.SeedAsync("inactive@example.test", "user", "inactive_role");
        var repository = _fixture.Repository();
        Assert.Null(await repository.PreviewAsync(seeded.Token, default));
        Assert.False(await repository.CompleteAsync(seeded.Token,
            new(Guid.NewGuid().ToString(), "inactive@example.test"), new("No", "Role"), default));
        Assert.Equal("sent", (await _fixture.StateAsync(seeded.InvitationId)).Status);
    }

    [Theory]
    [InlineData("candidate")]
    [InlineData("external")]
    public async Task Non_staff_role_hides_invitation_and_never_provisions_access(string role)
    {
        var seeded = await _fixture.SeedAsync($"{role}@example.test", "user", role);
        var repository = _fixture.Repository();

        Assert.Null(await repository.PreviewAsync(seeded.Token, default));
        Assert.False(await repository.CompleteAsync(seeded.Token,
            new(Guid.NewGuid().ToString(), $"{role}@example.test"), new("Non", "Staff"), default));

        var state = await _fixture.StateAsync(seeded.InvitationId);
        Assert.Equal("sent", state.Status);
        Assert.Equal((0, 0, 0), (state.Users, state.Grants, state.Audits));
    }

    [Fact]
    public async Task Existing_tenant_user_receives_the_invited_role_idempotently()
    {
        var seeded = await _fixture.SeedAsync("member@example.test", "user", "recruiter");
        var identity = Guid.NewGuid().ToString();
        await _fixture.SeedExistingUserAsync(identity, "member@example.test", seeded.OrganizationId);
        var repository = _fixture.Repository();

        Assert.True(await repository.CompleteAsync(seeded.Token,
            new(identity, "member@example.test"), new("Existing", "Member"), default));
        Assert.True(await repository.CompleteAsync(seeded.Token,
            new(identity, "member@example.test"), new("Existing", "Member"), default));

        var state = await _fixture.StateAsync(seeded.InvitationId);
        Assert.Equal((1, 1, 1), (state.Users, state.Grants, state.Audits));
    }

    [Fact]
    public async Task Concurrent_completion_is_idempotent_and_never_duplicates_access()
    {
        var seeded = await _fixture.SeedAsync("parallel@example.test", "user", "recruiter");
        var identity = new SetupIdentity(Guid.NewGuid().ToString(), "parallel@example.test");
        var results = await Task.WhenAll(
            _fixture.Repository().CompleteAsync(seeded.Token, identity, new("Parallel", "One"), default),
            _fixture.Repository().CompleteAsync(seeded.Token, identity, new("Parallel", "One"), default));
        Assert.All(results, Assert.True);
        var state = await _fixture.StateAsync(seeded.InvitationId);
        Assert.Equal((1, 1, 1), (state.Users, state.Grants, state.Audits));
    }

    [Theory]
    [InlineData("revoked")]
    [InlineData("expired")]
    public async Task Terminal_invitation_never_provisions_access(string status)
    {
        var seeded = await _fixture.SeedAsync($"{status}@example.test", "user", "recruiter");
        await _fixture.SetStatusAsync(seeded.InvitationId, status);
        Assert.False(await _fixture.Repository().CompleteAsync(seeded.Token,
            new(Guid.NewGuid().ToString(), $"{status}@example.test"), new("Terminal", "Recipient"), default));
        var state = await _fixture.StateAsync(seeded.InvitationId);
        Assert.Equal((0, 0, 0), (state.Users, state.Grants, state.Audits));
    }

    [Fact]
    public async Task Accepted_invitation_does_not_restore_deleted_access()
    {
        var seeded = await _fixture.SeedAsync("deleted@example.test", "user", "recruiter");
        var identity = new SetupIdentity(Guid.NewGuid().ToString(), "deleted@example.test");
        var repository = _fixture.Repository();
        Assert.True(await repository.CompleteAsync(seeded.Token, identity, new("Deleted", "Recipient"), default));
        await _fixture.DeleteProvisionedUserAsync(seeded.InvitationId);
        Assert.False(await repository.CompleteAsync(seeded.Token, identity, new("Deleted", "Recipient"), default));
        Assert.Equal(0, (await _fixture.StateAsync(seeded.InvitationId)).Users);
    }

    [Fact]
    public async Task Accepted_invitation_does_not_restore_an_administrator_removed_role()
    {
        var seeded = await _fixture.SeedAsync("removed-role@example.test", "user", "recruiter");
        var identity = new SetupIdentity(Guid.NewGuid().ToString(), "removed-role@example.test");
        var repository = _fixture.Repository();
        Assert.True(await repository.CompleteAsync(seeded.Token, identity, new("Removed", "Role"), default));
        await _fixture.RemoveAssignedRolesAsync(seeded.InvitationId);
        Assert.False(await repository.CompleteAsync(seeded.Token, identity, new("Removed", "Role"), default));
        Assert.Equal(0, (await _fixture.StateAsync(seeded.InvitationId)).Grants);
    }

    [Fact]
    public async Task Accepted_replay_rejects_a_recreated_identity_with_the_same_email()
    {
        var seeded = await _fixture.SeedAsync("recreated@example.test", "user", "recruiter");
        var repository = _fixture.Repository();
        Assert.True(await repository.CompleteAsync(seeded.Token,
            new(Guid.NewGuid().ToString(), "recreated@example.test"), new("Original", "Identity"), default));
        Assert.False(await repository.CompleteAsync(seeded.Token,
            new(Guid.NewGuid().ToString(), "recreated@example.test"), new("Recreated", "Identity"), default));
        var state = await _fixture.StateAsync(seeded.InvitationId);
        Assert.Equal((1, 1, 1), (state.Users, state.Grants, state.Audits));
    }

    [Fact]
    public async Task Audit_failure_rolls_back_user_role_and_invitation_status()
    {
        var seeded = await _fixture.SeedAsync("rollback@example.test", "user", "recruiter");
        await _fixture.SetAuditInsertAsync(false);
        try
        {
            await Assert.ThrowsAsync<PostgresException>(() => _fixture.Repository().CompleteAsync(seeded.Token,
                new(Guid.NewGuid().ToString(), "rollback@example.test"), new("Rollback", "Recipient"), default));
        }
        finally
        {
            await _fixture.SetAuditInsertAsync(true);
        }
        var state = await _fixture.StateAsync(seeded.InvitationId);
        Assert.Equal("sent", state.Status);
        Assert.Equal((0, 0, 0), (state.Users, state.Grants, state.Audits));
    }
}

public sealed class InvitationOnboardingRepositoryFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("invitation_setup").WithUsername("postgres").WithPassword("postgres").Build();
    private string _connectionString = "";

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = Schema;
        await command.ExecuteNonQueryAsync();
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();

    public InvitationOnboardingRepository Repository() => new(new(
        PlatformInvitationsDataSource.Build(_connectionString)));

    public async Task<(Guid InvitationId, string Token, Guid OrganizationId)> SeedAsync(
        string email, string type, string? role)
    {
        var org = Guid.NewGuid(); var invitation = Guid.NewGuid(); var token = Guid.NewGuid().ToString();
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO organizations(id,name) VALUES(@org,@name);
            INSERT INTO roles(id,organization_id,slug,is_active) VALUES
              (@recruiter,@org,'recruiter',true),(@admin,@org,'super_admin',true),
              (@candidate,@org,'candidate',true),(@external,@org,'external',true),
              (@inactive,@org,'inactive_role',false);
            INSERT INTO platform_invitations(id,email,type,organization_id,role_slug,token,status,expires_at,updated_at)
            VALUES(@invitation,@email,@type::"InvitationType",@org,@role,@token,'sent',now()+interval '1 day',now());
            """;
        command.Parameters.AddWithValue("org", org); command.Parameters.AddWithValue("name", "Test " + org);
        command.Parameters.AddWithValue("recruiter", Guid.NewGuid()); command.Parameters.AddWithValue("admin", Guid.NewGuid());
        command.Parameters.AddWithValue("candidate", Guid.NewGuid()); command.Parameters.AddWithValue("external", Guid.NewGuid());
        command.Parameters.AddWithValue("inactive", Guid.NewGuid()); command.Parameters.AddWithValue("invitation", invitation);
        command.Parameters.AddWithValue("email", email); command.Parameters.AddWithValue("type", type);
        command.Parameters.AddWithValue("role", (object?)role ?? DBNull.Value); command.Parameters.AddWithValue("token", token);
        await command.ExecuteNonQueryAsync();
        return (invitation, token, org);
    }

    public async Task SeedExistingUserAsync(string identity, string email, Guid organizationId)
    {
        await using var connection = new NpgsqlConnection(_connectionString); await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO organizations(id,name) VALUES(@org,'Other tenant') ON CONFLICT(id) DO NOTHING;
            INSERT INTO users(id,organization_id,supabase_user_id,email,first_name,last_name)
            VALUES(@id,@org,@identity,@email,'Existing','User');
            """;
        command.Parameters.AddWithValue("org", organizationId); command.Parameters.AddWithValue("id", Guid.NewGuid());
        command.Parameters.AddWithValue("identity", identity); command.Parameters.AddWithValue("email", email);
        await command.ExecuteNonQueryAsync();
    }

    public async Task<(string Status, int Users, int Grants, int Audits)> StateAsync(Guid invitationId)
    {
        await using var connection = new NpgsqlConnection(_connectionString); await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT i.status::text,
              (SELECT count(*)::int FROM users u WHERE lower(u.email)=lower(i.email)),
              (SELECT count(*)::int FROM user_roles ur JOIN users u ON u.id=ur.user_id WHERE lower(u.email)=lower(i.email)),
              (SELECT count(*)::int FROM audit_logs a WHERE a.entity_id=i.id::text AND a.action='invitation_account_completed')
            FROM platform_invitations i WHERE i.id=@id
            """;
        command.Parameters.AddWithValue("id", invitationId);
        await using var reader = await command.ExecuteReaderAsync(); await reader.ReadAsync();
        return (reader.GetString(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt32(3));
    }

    public async Task<string?> AssignedRoleAsync(Guid invitationId)
    {
        await using var connection = new NpgsqlConnection(_connectionString); await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT r.slug FROM platform_invitations i JOIN users u ON lower(u.email)=lower(i.email)
            JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE i.id=@id
            """;
        command.Parameters.AddWithValue("id", invitationId);
        return await command.ExecuteScalarAsync() as string;
    }

    public async Task SetStatusAsync(Guid invitationId, string status)
    {
        await using var connection = new NpgsqlConnection(_connectionString); await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE platform_invitations SET status=@status::\"InvitationStatus\" WHERE id=@id";
        command.Parameters.AddWithValue("status", status); command.Parameters.AddWithValue("id", invitationId);
        await command.ExecuteNonQueryAsync();
    }

    public async Task DeleteProvisionedUserAsync(Guid invitationId)
    {
        await using var connection = new NpgsqlConnection(_connectionString); await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            DELETE FROM user_roles WHERE user_id IN (SELECT u.id FROM users u JOIN platform_invitations i
              ON lower(i.email)=lower(u.email) WHERE i.id=@id);
            DELETE FROM users WHERE lower(email)=(SELECT lower(email) FROM platform_invitations WHERE id=@id);
            """;
        command.Parameters.AddWithValue("id", invitationId);
        await command.ExecuteNonQueryAsync();
    }

    public async Task RemoveAssignedRolesAsync(Guid invitationId)
    {
        await using var connection = new NpgsqlConnection(_connectionString); await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            DELETE FROM user_roles WHERE user_id IN (SELECT u.id FROM users u JOIN platform_invitations i
              ON lower(i.email)=lower(u.email) WHERE i.id=@id)
            """;
        command.Parameters.AddWithValue("id", invitationId);
        await command.ExecuteNonQueryAsync();
    }

    public async Task SetAuditInsertAsync(bool enabled)
    {
        await using var connection = new NpgsqlConnection(_connectionString); await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = enabled
            ? "GRANT INSERT ON audit_logs TO app_tenant"
            : "REVOKE INSERT ON audit_logs FROM app_tenant";
        await command.ExecuteNonQueryAsync();
    }

    private const string Schema = """
        CREATE SCHEMA auth;
        CREATE TABLE auth.users(id uuid PRIMARY KEY,email text NOT NULL);
        CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;
        CREATE TYPE "InvitationType" AS ENUM ('org_admin','user');
        CREATE TYPE "InvitationStatus" AS ENUM ('pending','sent','accepted','expired','revoked');
        CREATE TABLE organizations(id uuid PRIMARY KEY,name text NOT NULL,is_active boolean NOT NULL DEFAULT true,deleted_at timestamp NULL);
        CREATE TABLE roles(id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),slug text NOT NULL,is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users(id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),supabase_user_id text NOT NULL UNIQUE,
          email text NOT NULL,first_name text,last_name text,is_platform_owner boolean NOT NULL DEFAULT false,is_active boolean NOT NULL DEFAULT true,
          deleted_at timestamp NULL,updated_at timestamp NOT NULL DEFAULT now());
        CREATE TABLE user_roles(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),role_id uuid NOT NULL REFERENCES roles(id),UNIQUE(user_id,role_id));
        CREATE TABLE platform_invitations(id uuid PRIMARY KEY,email text NOT NULL,type "InvitationType" NOT NULL,organization_id uuid NOT NULL REFERENCES organizations(id),
          role_slug text,token text NOT NULL UNIQUE,status "InvitationStatus" NOT NULL,accepted_at timestamp NULL,expires_at timestamp NOT NULL,updated_at timestamp NOT NULL);
        CREATE TABLE audit_logs(id uuid PRIMARY KEY,organization_id uuid NOT NULL,actor_id uuid,action text NOT NULL,entity text NOT NULL,entity_id text);
        GRANT SELECT,INSERT,UPDATE ON users,user_roles,platform_invitations,audit_logs TO app_tenant;
        ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE users FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_users ON users USING(organization_id=NULLIF(current_setting('app.current_org_id',true),'')::uuid)
          WITH CHECK(organization_id=NULLIF(current_setting('app.current_org_id',true),'')::uuid);
        ALTER TABLE platform_invitations ENABLE ROW LEVEL SECURITY; ALTER TABLE platform_invitations FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_invitations ON platform_invitations USING(organization_id=NULLIF(current_setting('app.current_org_id',true),'')::uuid)
          WITH CHECK(organization_id=NULLIF(current_setting('app.current_org_id',true),'')::uuid);
        ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_audit ON audit_logs USING(organization_id=NULLIF(current_setting('app.current_org_id',true),'')::uuid)
          WITH CHECK(organization_id=NULLIF(current_setting('app.current_org_id',true),'')::uuid);
        """;
}

[CollectionDefinition("InvitationOnboardingRepository")]
public sealed class InvitationOnboardingRepositoryCollection : ICollectionFixture<InvitationOnboardingRepositoryFixture>;
