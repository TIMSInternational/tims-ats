using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Domain.Audit;
using Tims.Infrastructure.Audit;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.7 Testcontainers fixture for the single data_access_log writer. Spins up one real Postgres with
/// the SAME RLS mechanism as <see cref="RlsFixture"/> (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE +
/// FORCE ROW LEVEL SECURITY + fail-closed <c>tenant_isolation</c> WITH CHECK) applied to a
/// <c>data_access_logs</c> table that mirrors the Prisma <c>DataAccessLog</c> model.
///
/// <c>app_tenant</c> is granted only SELECT + INSERT (never UPDATE/DELETE) — the DB-level expression of
/// the append-only contract the writer honors in code.
///
/// A SECOND database (<see cref="MissingTableConnectionString"/>) on the same server has the global
/// <c>app_tenant</c> role but NO <c>data_access_logs</c> table, so a writer pointed at it fails its INSERT
/// ("relation does not exist") — the deterministic write-failure that drives the fail-closed/fail-soft
/// branches without depending on flaky error injection.
/// </summary>
public sealed class AuditWriterFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_wp27";
    private const string MissingTableDatabase = "tims_wp27_missing";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // Impersonation scenario: RealOwner (platform owner) acts AS Target — the audit row must name RealOwner.
    public static readonly Guid RealOwner = Guid.Parse("a0000000-0000-0000-0000-0000000000aa");
    public static readonly Guid Target = Guid.Parse("a0000000-0000-0000-0000-0000000000bb");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    /// <summary>The main DB connection string — has the data_access_logs table + RLS.</summary>
    public string ConnectionString { get; private set; } = string.Empty;

    /// <summary>A second DB on the same server WITHOUT the table — writes here fail deterministically.</summary>
    public string MissingTableConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        MissingTableConnectionString =
            new NpgsqlConnectionStringBuilder(ConnectionString) { Database = MissingTableDatabase }.ConnectionString;

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using (var role = connection.CreateCommand())
        {
            // Role membership is cluster-global, so app_tenant is visible in BOTH databases.
            role.CommandText =
                """
                CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
                GRANT app_tenant TO postgres;
                """;
            await role.ExecuteNonQueryAsync();
        }

        await using (var table = connection.CreateCommand())
        {
            table.CommandText =
                """
                CREATE TABLE data_access_logs (
                    id uuid PRIMARY KEY,
                    organization_id uuid NOT NULL,
                    actor_id uuid NOT NULL,
                    data_type text NOT NULL,
                    record_id uuid NOT NULL,
                    action text NOT NULL,
                    ip_address text NULL,
                    user_agent text NULL,
                    created_at timestamptz NOT NULL DEFAULT now()
                );

                -- Append-only at the DB level: SELECT + INSERT only, no UPDATE/DELETE for app_tenant.
                GRANT SELECT, INSERT ON data_access_logs TO app_tenant;

                ALTER TABLE data_access_logs ENABLE ROW LEVEL SECURITY;
                ALTER TABLE data_access_logs FORCE ROW LEVEL SECURITY;

                CREATE POLICY tenant_isolation ON data_access_logs
                    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
                    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
                """;
            await table.ExecuteNonQueryAsync();
        }

        // CB-1 compliance control: engine-level append-only immutability (insert-only trigger + REVOKE), the
        // tamper-evident audit trail (SOC 2 CC7.2 / ISO A.8.15). Applied here so the writer tests run against
        // the SAME hardened table shape as prod, and the dedicated immutability test can prove it bites.
        await using (var immutable = connection.CreateCommand())
        {
            immutable.CommandText = AuditImmutability.BuildAppendOnlySql("data_access_logs");
            await immutable.ExecuteNonQueryAsync();
        }

        // CB-1b: the SECOND audit table `audit_logs` (admin/security events). Unlike data_access_logs it
        // carries a REAL FK organization_id -> organizations ON DELETE CASCADE (faithful to prod), so this
        // fixture also proves the documented FK-cascade constraint: a hard org delete is blocked by the guard.
        await using (var auditLogs = connection.CreateCommand())
        {
            auditLogs.CommandText =
                """
                CREATE TABLE organizations (id uuid PRIMARY KEY);
                CREATE TABLE users_audit (id uuid PRIMARY KEY);
                CREATE TABLE audit_logs (
                    id uuid PRIMARY KEY,
                    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
                    -- optional user refs mirror the Prisma model (userId/actorId String? → default SET NULL),
                    -- so a user hard-delete triggers a SET NULL UPDATE on audit_logs (which immutability blocks).
                    user_id uuid NULL REFERENCES users_audit (id) ON DELETE SET NULL,
                    actor_id uuid NULL REFERENCES users_audit (id) ON DELETE SET NULL,
                    action text NOT NULL,
                    entity text NOT NULL,
                    -- entity_id/changes/metadata/ip_address/user_agent complete the Prisma AuditLog mirror so
                    -- writers over the full AuditLogDbContext mapping (e.g. SecurityEventWriter) can round-trip
                    -- against this same table, not just the FK-cascade-focused subset the original columns covered.
                    entity_id text NULL,
                    changes jsonb NULL,
                    metadata jsonb NULL,
                    ip_address text NULL,
                    user_agent text NULL,
                    created_at timestamp NOT NULL DEFAULT now()
                );

                GRANT SELECT, INSERT ON audit_logs TO app_tenant;

                ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
                ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

                CREATE POLICY tenant_isolation ON audit_logs
                    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
                    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

                INSERT INTO organizations (id) VALUES ('11111111-1111-1111-1111-111111111111');
                INSERT INTO users_audit (id) VALUES ('a0000000-0000-0000-0000-0000000000aa');
                """;
            await auditLogs.ExecuteNonQueryAsync();
        }

        await using (var immutableAuditLogs = connection.CreateCommand())
        {
            // Same reusable control, SECOND table — validates the shared guard reports each table's own name
            // (TG_TABLE_NAME), the exact reusability the CB-1 review (opus M1) fixed.
            immutableAuditLogs.CommandText = AuditImmutability.BuildAppendOnlySql("audit_logs");
            await immutableAuditLogs.ExecuteNonQueryAsync();
        }

        // CREATE DATABASE cannot run inside a transaction block — a plain autocommit command is fine.
        await using (var db2 = connection.CreateCommand())
        {
            db2.CommandText = $"CREATE DATABASE {MissingTableDatabase}";
            await db2.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public static DbContextOptions<DataAccessAuditDbContext> BuildOptions(string connectionString) =>
        new DbContextOptionsBuilder<DataAccessAuditDbContext>().UseNpgsql(connectionString).Options;

    public DataAccessAuditDbContext NewContext(string connectionString) => new(BuildOptions(connectionString));

    public static DbContextOptions<AuditLogDbContext> BuildAuditLogOptions(string connectionString) =>
        new DbContextOptionsBuilder<AuditLogDbContext>().UseNpgsql(connectionString).Options;

    /// <summary>A fresh <see cref="AuditLogDbContext"/> over the given connection string — used by writers of
    /// the SECOND audit table (<c>audit_logs</c>), e.g. <c>SecurityEventWriter</c>. Pass
    /// <see cref="MissingTableConnectionString"/> to get a deterministic write failure (no audit_logs table).</summary>
    public AuditLogDbContext NewAuditLogContext(string connectionString) => new(BuildAuditLogOptions(connectionString));

    /// <summary>Reads a single audit row back as the superuser (bypasses RLS) for assertions.</summary>
    public async Task<AuditRow?> ReadRowAsync(Guid recordId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT organization_id, actor_id, data_type, action, created_at FROM data_access_logs WHERE record_id = @rid";
        command.Parameters.AddWithValue("rid", recordId);

        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return new AuditRow(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetDateTime(4));
    }

    public async Task<int> CountRowsAsync(Guid recordId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM data_access_logs WHERE record_id = @rid";
        command.Parameters.AddWithValue("rid", recordId);
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    public sealed record AuditRow(Guid OrganizationId, Guid ActorId, string DataType, string Action, DateTime CreatedAt);
}
