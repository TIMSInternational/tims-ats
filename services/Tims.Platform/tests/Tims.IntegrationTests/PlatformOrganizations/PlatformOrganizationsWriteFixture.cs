using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 20 (issue #76) Testcontainers fixture for the platform organizations WRITE surface.
///
/// <para>Two databases on one server, and the second one is the point. <see cref="ConnectionString"/> has
/// the full shape (<c>organizations</c> + <c>audit_logs</c> + <c>users</c> + <c>notifications</c>, the real
/// <c>OrgPlan</c> enum, RLS with the production predicates).
/// <see cref="MissingAuditTableConnectionString"/> is identical EXCEPT that <c>audit_logs</c> does not
/// exist — so the audit INSERT fails deterministically ("relation does not exist") without error
/// injection, mocks, or a flaky failpoint. That is what makes the fail-closed claim provable rather than
/// asserted: the same code path, one missing table, and the organization row must come out unchanged.
/// The technique is lifted from <see cref="AuditWriterFixture"/>, which already uses it for the
/// fail-soft/fail-closed split on <c>data_access_logs</c>.</para>
///
/// <para>RLS is real here. <c>app_tenant</c> is NOLOGIN/NOBYPASSRLS and the policies are the production
/// ones — <c>organizations</c> scopes by its OWN id (<c>id = current_org_id</c>), <c>audit_logs</c> by
/// <c>organization_id</c>. So these tests also prove the thing the port could plausibly have got wrong:
/// that a platform-owner write CAN run under <see cref="Tims.Infrastructure.TenantScope"/> at all, rather
/// than needing the unscoped BYPASSRLS path the slice-19 reader uses.</para>
/// </summary>
public sealed class PlatformOrganizationsWriteFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_slice20";
    private const string MissingAuditTableDatabase = "tims_slice20_no_audit";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid MissingOrg = Guid.Parse("33333333-3333-3333-3333-333333333333");

    /// <summary>The acting platform owner (in OrgA). Also one of the two notification targets.</summary>
    public static readonly Guid Actor = Guid.Parse("a0000000-0000-0000-0000-0000000000aa");

    /// <summary>A SECOND platform owner, in a DIFFERENT organization — the fan-out must reach them too.</summary>
    public static readonly Guid OwnerTwo = Guid.Parse("a0000000-0000-0000-0000-0000000000bb");

    /// <summary>A non-owner in OrgB — must never receive a platform notification.</summary>
    public static readonly Guid NonOwner = Guid.Parse("a0000000-0000-0000-0000-0000000000cc");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    /// <summary>Same schema minus <c>audit_logs</c> — every audit INSERT fails here, deterministically.</summary>
    public string MissingAuditTableConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        MissingAuditTableConnectionString =
            new NpgsqlConnectionStringBuilder(ConnectionString) { Database = MissingAuditTableDatabase }.ConnectionString;

        await using (var connection = new NpgsqlConnection(ConnectionString))
        {
            await connection.OpenAsync();

            // Role membership is cluster-global, so app_tenant is visible in BOTH databases.
            await ExecuteAsync(connection, "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;");
            await ExecuteAsync(connection, BaseSchemaSql);
            await ExecuteAsync(connection, AuditLogsSql);
            await ExecuteAsync(connection, NotificationsSql);
            await ExecuteAsync(connection, SeedSql);

            // CREATE DATABASE cannot run inside a transaction block — a plain autocommit command is fine.
            await ExecuteAsync(connection, $"CREATE DATABASE {MissingAuditTableDatabase}");
        }

        await using (var missing = new NpgsqlConnection(MissingAuditTableConnectionString))
        {
            await missing.OpenAsync();
            // Everything EXCEPT audit_logs. organizations must exist and be seeded, otherwise the update
            // would fail for the wrong reason and the mutation proof would pass vacuously.
            await ExecuteAsync(missing, BaseSchemaSql);
            await ExecuteAsync(missing, NotificationsSql);
            await ExecuteAsync(missing, SeedSql);
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    /// <summary>
    /// A write context on the SAME EnableUnmappedTypes data source Program.cs wires — not a plain
    /// connection string. That is load-bearing, not incidental: <c>organizations.plan</c> is a native
    /// Postgres enum and EFCore.PG cannot materialise it into a C# string without it. A fixture that used a
    /// plain connection string would pass only if the port stopped reading the row back.
    /// </summary>
    public PlatformOrganizationsWriteDbContext NewContext(string connectionString) =>
        new(new DbContextOptionsBuilder<PlatformOrganizationsWriteDbContext>()
            .UseNpgsql(PlatformOrganizationsDataSource.Build(connectionString))
            .Options);

    /// <summary>The slice-19 READ context on the same data source — see PlatformOrganizationsReadDbContextTests.</summary>
    public PlatformOrganizationsReadDbContext NewReadContext(string connectionString) =>
        new(new DbContextOptionsBuilder<PlatformOrganizationsReadDbContext>()
            .UseNpgsql(PlatformOrganizationsDataSource.Build(connectionString))
            .Options);

    /// <summary>Reads an organization back as the superuser (bypassing RLS) for assertions.</summary>
    public async Task<OrgSnapshot?> ReadOrganizationAsync(Guid id, string? connectionString = null)
    {
        await using var connection = new NpgsqlConnection(connectionString ?? ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT name, plan::text, settings::text, is_active, updated_at FROM organizations WHERE id = @id";
        command.Parameters.AddWithValue("id", id);

        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return new OrgSnapshot(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetBoolean(3),
            reader.GetDateTime(4));
    }

    /// <summary>Every audit row for an organization, superuser-read, newest last.</summary>
    public async Task<IReadOnlyList<AuditRow>> ReadAuditRowsAsync(Guid organizationId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        // jsonb_typeof is asserted, not just the text: the TS writes a jsonb STRING scalar (Prisma `Json?`
        // handed a JSON.stringify result), and a port that wrote an OBJECT would round-trip to a
        // similar-looking value with re-ordered, re-spaced keys.
        command.CommandText =
            """
            SELECT action, entity, entity_id, actor_id, jsonb_typeof(changes), changes #>> '{}'
            FROM audit_logs WHERE organization_id = @org ORDER BY created_at, action
            """;
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<AuditRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new AuditRow(
                reader.GetString(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetGuid(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5)));
        }

        return rows;
    }

    public async Task<IReadOnlyList<NotificationRow>> ReadNotificationsAsync(Guid organizationId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT user_id, type, title, module, action_url FROM notifications WHERE organization_id = @org ORDER BY user_id";
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<NotificationRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new NotificationRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4)));
        }

        return rows;
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    // `organizations` mirrors the Prisma model, including the native OrgPlan enum and the settings jsonb
    // default — the two column types the port has to cast explicitly.
    private const string BaseSchemaSql =
        """
        CREATE TYPE "OrgPlan" AS ENUM ('trial', 'starter', 'professional', 'enterprise');

        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            slug text NOT NULL UNIQUE,
            domain text NULL UNIQUE,
            logo text NULL,
            plan "OrgPlan" NOT NULL DEFAULT 'trial',
            settings jsonb NOT NULL DEFAULT '{}',
            billing_email text NULL,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL DEFAULT now(),
            updated_at timestamp(3) NOT NULL DEFAULT now(),
            deleted_at timestamp(3) NULL
        );

        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
            is_platform_owner boolean NOT NULL DEFAULT false
        );

        GRANT SELECT, INSERT, UPDATE, DELETE ON organizations TO app_tenant;
        GRANT SELECT ON users TO app_tenant;

        ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

        -- Production predicate (20260604100000_enable_rls_tenant_isolation:320): organizations scope by
        -- their OWN id, on both USING and WITH CHECK.
        CREATE POLICY tenant_isolation ON organizations
            USING (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string AuditLogsSql =
        """
        CREATE TABLE audit_logs (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
            user_id uuid NULL,
            actor_id uuid NULL,
            action text NOT NULL,
            entity text NOT NULL,
            entity_id text NULL,
            changes jsonb NULL,
            metadata jsonb NULL,
            ip_address text NULL,
            user_agent text NULL,
            created_at timestamp NOT NULL DEFAULT now()
        );

        -- Append-only at the DB level, matching CB-1b: no UPDATE/DELETE grant for app_tenant.
        GRANT SELECT, INSERT ON audit_logs TO app_tenant;

        ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON audit_logs
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // notifications carries no RLS here on purpose: the fan-out is UNSCOPED on both stacks (TS uses the
    // privileged `db`, and prod connects as a BYPASSRLS role), so a policy would be bypassed in the test
    // exactly as it is in production and would prove nothing.
    private const string NotificationsSql =
        """
        CREATE TABLE notifications (
            id uuid PRIMARY KEY,
            organization_id uuid NULL,
            user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            type text NOT NULL,
            title text NOT NULL,
            message text NULL,
            module text NULL,
            entity_type text NULL,
            entity_id uuid NULL,
            action_url text NULL,
            read boolean NOT NULL DEFAULT false,
            read_at timestamp(3) NULL,
            archived boolean NOT NULL DEFAULT false,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """;

    private const string SeedSql =
        """
        INSERT INTO organizations (id, name, slug, plan, settings, is_active) VALUES
            ('11111111-1111-1111-1111-111111111111', 'Acme', 'acme', 'trial', '{"locale":"es","timezone":"America/Bogota"}', true),
            ('22222222-2222-2222-2222-222222222222', 'Beta', 'beta', 'starter', '{}', true);

        INSERT INTO users (id, organization_id, is_platform_owner) VALUES
            ('a0000000-0000-0000-0000-0000000000aa', '11111111-1111-1111-1111-111111111111', true),
            ('a0000000-0000-0000-0000-0000000000bb', '22222222-2222-2222-2222-222222222222', true),
            ('a0000000-0000-0000-0000-0000000000cc', '22222222-2222-2222-2222-222222222222', false);
        """;

    public sealed record OrgSnapshot(string Name, string Plan, string Settings, bool IsActive, DateTime UpdatedAt);

    public sealed record AuditRow(string Action, string Entity, string? EntityId, Guid? ActorId, string? ChangesType, string? ChangesText);

    public sealed record NotificationRow(Guid UserId, string Type, string Title, string? Module, string? ActionUrl);
}
