using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.Hris;

namespace Tims.IntegrationTests.Hris;

/// <summary>
/// WP3.6 combined real-RLS fixture for the DB-backed HRIS sync proof. Spins ONE Postgres container that
/// carries BOTH deliverables the end-to-end sync touches:
/// <list type="bullet">
///   <item>the four <c>hris_</c> tables, applied via the ACTUAL <c>20260716000000_hris_domain</c> EF
///     migration (so the ENABLE/FORCE/policy blocks + app_tenant GRANTs under test are exactly what
///     ships — Slice 1's <see cref="HrisSchemaFixture"/> pattern); and</item>
///   <item>the WP2.7 <c>data_access_logs</c> table with the SAME RLS mechanism as
///     <see cref="AuditWriterFixture"/> (append-only SELECT+INSERT GRANT, fail-closed
///     <c>tenant_isolation</c> WITH CHECK), so the sync's REAL <see cref="DataAccessAuditWriter"/> row
///     can land under tenant RLS — never mocked.</item>
/// </list>
///
/// The container login role is the SUPERUSER (bypasses RLS): the NOLOGIN/NOBYPASSRLS <c>app_tenant</c>
/// role is what <see cref="Tims.Infrastructure.TenantScope"/> switches into to engage tenant isolation.
/// Seed/read helpers run as the superuser (bypass RLS) so a test can arrange cross-org state and assert
/// what actually landed. Each test calls <see cref="ResetAsync"/> first — the collection runs serially,
/// so a truncate-then-seed gives every test a clean slate without a fresh container.
/// </summary>
public sealed class HrisSyncFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_hris_sync";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid ConnectorA = Guid.Parse("aaaaaaaa-0000-0000-0000-0000000000c1");
    public static readonly Guid ConnectorB = Guid.Parse("bbbbbbbb-0000-0000-0000-0000000000c1");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();

        // app_tenant must exist BEFORE the migration runs (the migration GRANTs to it) and before the
        // data_access_logs policy references it — one role, shared by both schemas.
        await using (var connection = new NpgsqlConnection(ConnectionString))
        {
            await connection.OpenAsync();
            await using var role = connection.CreateCommand();
            role.CommandText =
                """
                CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
                GRANT app_tenant TO postgres;
                """;
            await role.ExecuteNonQueryAsync();
        }

        // (1) The REAL hris_* tables + RLS + GRANTs, straight from the shipped EF migration.
        await using (var migrateDb = new HrisDbContext(BuildHrisOptions(ConnectionString)))
        {
            await migrateDb.Database.MigrateAsync();
        }

        // (2) The WP2.7 data_access_logs table (mirrors AuditWriterFixture) so the sync's real audit
        //     row can land under tenant RLS in the SAME container.
        await using (var connection = new NpgsqlConnection(ConnectionString))
        {
            await connection.OpenAsync();
            await using var table = connection.CreateCommand();
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
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public static DbContextOptions<HrisDbContext> BuildHrisOptions(string connectionString) =>
        new DbContextOptionsBuilder<HrisDbContext>().UseNpgsql(connectionString).Options;

    public HrisDbContext NewHrisContext() => new(BuildHrisOptions(ConnectionString));

    public DataAccessAuditDbContext NewAuditContext() =>
        new(new DbContextOptionsBuilder<DataAccessAuditDbContext>().UseNpgsql(ConnectionString).Options);

    // ---- Arrange (superuser, bypasses RLS) --------------------------------------------------------

    /// <summary>Wipes every table so each test in the serial collection starts from a clean slate.</summary>
    public async Task ResetAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            TRUNCATE hris_external_employees, hris_sync_runs, hris_sync_record_errors,
                     hris_connectors, data_access_logs;
            """;
        await command.ExecuteNonQueryAsync();
    }

    public async Task SeedConnectorAsync(Guid connectorId, Guid organizationId, string displayName)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        // secret_ref + subdomain are REQUIRED for an active connector (the use case fails closed without
        // them). The fake connector ignores their values, but they must be present for the sync to run.
        command.CommandText =
            """
            INSERT INTO hris_connectors (id, organization_id, provider, display_name, status, secret_ref, subdomain)
            VALUES (@id, @org, 'bamboohr', @name, 'connected', @secretRef, @subdomain);
            """;
        command.Parameters.AddWithValue("id", connectorId);
        command.Parameters.AddWithValue("org", organizationId);
        command.Parameters.AddWithValue("name", displayName);
        command.Parameters.AddWithValue("secretRef", $"bamboohr/{organizationId:N}");
        command.Parameters.AddWithValue("subdomain", $"sub-{organizationId:N}");
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>Seeds one pre-existing external employee (e.g. an org-B row that an org-A sync must never touch).</summary>
    public async Task SeedEmployeeAsync(
        Guid organizationId,
        Guid connectorId,
        string externalId,
        string firstName,
        string lastName,
        string sourceHash)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            INSERT INTO hris_external_employees
                (id, organization_id, connector_id, external_id, first_name, last_name, source_hash)
            VALUES (@id, @org, @connector, @ext, @first, @last, @hash);
            """;
        command.Parameters.AddWithValue("id", Guid.NewGuid());
        command.Parameters.AddWithValue("org", organizationId);
        command.Parameters.AddWithValue("connector", connectorId);
        command.Parameters.AddWithValue("ext", externalId);
        command.Parameters.AddWithValue("first", firstName);
        command.Parameters.AddWithValue("last", lastName);
        command.Parameters.AddWithValue("hash", sourceHash);
        await command.ExecuteNonQueryAsync();
    }

    // ---- Assert (superuser reads, bypass RLS) -----------------------------------------------------

    public async Task<IReadOnlyList<EmployeeRow>> ReadEmployeesAsync(Guid connectorId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT external_id, organization_id, first_name, is_deleted_in_source, last_sync_run_id
            FROM hris_external_employees
            WHERE connector_id = @connector
            ORDER BY external_id;
            """;
        command.Parameters.AddWithValue("connector", connectorId);

        var rows = new List<EmployeeRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new EmployeeRow(
                reader.GetString(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetBoolean(3),
                await reader.IsDBNullAsync(4) ? null : reader.GetGuid(4)));
        }

        return rows;
    }

    public async Task<IReadOnlyList<SyncRunRow>> ReadSyncRunsAsync(Guid organizationId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT id, organization_id, status, records_seen, records_upserted, records_failed
            FROM hris_sync_runs
            WHERE organization_id = @org
            ORDER BY created_at;
            """;
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<SyncRunRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new SyncRunRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetInt32(3),
                reader.GetInt32(4),
                reader.GetInt32(5)));
        }

        return rows;
    }

    public async Task<IReadOnlyList<RecordErrorRow>> ReadRecordErrorsAsync(Guid organizationId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT external_id, error_type, organization_id
            FROM hris_sync_record_errors
            WHERE organization_id = @org
            ORDER BY created_at;
            """;
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<RecordErrorRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new RecordErrorRow(
                await reader.IsDBNullAsync(0) ? null : reader.GetString(0),
                reader.GetString(1),
                reader.GetGuid(2)));
        }

        return rows;
    }

    public async Task<IReadOnlyList<AuditRow>> ReadAuditRowsAsync(Guid organizationId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT organization_id, actor_id, data_type, action, record_id
            FROM data_access_logs
            WHERE organization_id = @org
            ORDER BY created_at;
            """;
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<AuditRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new AuditRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetGuid(4)));
        }

        return rows;
    }

    public sealed record EmployeeRow(
        string ExternalId,
        Guid OrganizationId,
        string FirstName,
        bool IsDeletedInSource,
        Guid? LastSyncRunId);

    public sealed record SyncRunRow(
        Guid Id,
        Guid OrganizationId,
        string Status,
        int RecordsSeen,
        int RecordsUpserted,
        int RecordsFailed);

    public sealed record RecordErrorRow(string? ExternalId, string ErrorType, Guid OrganizationId);

    public sealed record AuditRow(Guid OrganizationId, Guid ActorId, string DataType, string Action, Guid RecordId);
}
