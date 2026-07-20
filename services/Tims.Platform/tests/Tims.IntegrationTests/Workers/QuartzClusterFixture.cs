using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests.Workers;

/// <summary>
/// Phase-4 Slice-2 real-Postgres proof for the clustered Quartz ADO job store. Spins ONE Postgres container,
/// creates the <c>app_tenant</c> role (the DDL's GRANT target), then applies the ACTUAL SHIPPED schema file
/// <c>services/Tims.Platform/db/quartz/quartz-tables_postgres.sql</c> — the SAME file Federico applies to prod
/// — so what is under test is exactly what ships (zero drift). The scheduler connects as the container's
/// superuser (bypasses grants), so a passing test proves the SCHEMA + clustering, not the grant wiring; the
/// grants are exercised only for apply-cleanliness (app_tenant must exist for the GRANT statement to succeed).
/// </summary>
public sealed class QuartzClusterFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_quartz";

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

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        // app_tenant must exist BEFORE the DDL runs — the shipped file GRANTs qrtz_* DML to it. NOBYPASSRLS
        // mirrors the real app role, though these tables have no RLS (they are scheduler infra, RLS-EXEMPT).
        await using (var role = connection.CreateCommand())
        {
            role.CommandText =
                """
                CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
                GRANT app_tenant TO postgres;
                """;
            await role.ExecuteNonQueryAsync();
        }

        // Apply the REAL shipped schema — the whole file in one command batch.
        await using (var ddl = connection.CreateCommand())
        {
            ddl.CommandText = await File.ReadAllTextAsync(QuartzDdlPath());
            await ddl.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync()
    {
        await _container.DisposeAsync();
    }

    /// <summary>Number of rows in <c>qrtz_scheduler_state</c> — proves a clustered node checked in (ADO store,
    /// not RAM). Used by the cluster-node assertion.</summary>
    public async Task<long> SchedulerStateRowCountAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var count = connection.CreateCommand();
        count.CommandText = "SELECT count(*) FROM qrtz_scheduler_state;";
        return (long)(await count.ExecuteScalarAsync())!;
    }

    /// <summary>Number of <c>qrtz_job_details</c> rows whose job name matches — proves reboot did not duplicate.</summary>
    public async Task<long> JobDetailRowCountAsync(string jobName)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var count = connection.CreateCommand();
        count.CommandText = "SELECT count(*) FROM qrtz_job_details WHERE job_name = @jobName;";
        count.Parameters.AddWithValue("jobName", jobName);
        return (long)(await count.ExecuteScalarAsync())!;
    }

    /// <summary>Number of <c>qrtz_cron_triggers</c> rows — proves the HRIS cron trigger persisted into the store.</summary>
    public async Task<long> CronTriggerRowCountAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var count = connection.CreateCommand();
        count.CommandText = "SELECT count(*) FROM qrtz_cron_triggers;";
        return (long)(await count.ExecuteScalarAsync())!;
    }

    /// <summary>
    /// Round-trips a write to <c>qrtz_locks</c> under <c>SET ROLE app_tenant</c> — proves the shipped DDL's
    /// GRANT actually confers DML on the qrtz_* tables to the app role (a typo'd/absent grant would raise
    /// permission-denied here). Uses a probe lock name distinct from Quartz's own STATE_ACCESS/TRIGGER_ACCESS
    /// so it can't interfere with a running scheduler.
    /// </summary>
    public async Task WriteQrtzAsAppTenantAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SET ROLE app_tenant;
            INSERT INTO qrtz_locks (sched_name, lock_name) VALUES ('TEST', 'GRANT_PROBE')
              ON CONFLICT DO NOTHING;
            DELETE FROM qrtz_locks WHERE sched_name = 'TEST' AND lock_name = 'GRANT_PROBE';
            RESET ROLE;
            """;
        await command.ExecuteNonQueryAsync();
    }

    // The DDL is copied to <output>/db/quartz/ by the csproj (Link + CopyToOutputDirectory).
    private static string QuartzDdlPath() =>
        Path.Combine(AppContext.BaseDirectory, "db", "quartz", "quartz-tables_postgres.sql");
}
