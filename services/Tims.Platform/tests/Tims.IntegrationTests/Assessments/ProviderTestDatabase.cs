using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// The throwaway Postgres the AS-5 provider fixtures run against. By default a Testcontainers
/// <c>postgres:16-alpine</c> (CI). When <see cref="OverrideVariable"/> holds a superuser connection string to a local,
/// disposable cluster (a machine without a working Docker daemon), each fixture gets its OWN freshly created database
/// on it instead, dropped on dispose. Never point the variable at a shared or production server: the fixtures run DDL.
/// </summary>
internal sealed class ProviderTestDatabase : IAsyncDisposable
{
    public const string OverrideVariable = "TIMS_IT_POSTGRES";

    private readonly PostgreSqlContainer? _container;
    private readonly string? _adminConnectionString;
    private readonly string? _databaseName;

    private ProviderTestDatabase(PostgreSqlContainer? container, string? adminConnectionString, string? databaseName,
        string connectionString)
    {
        _container = container;
        _adminConnectionString = adminConnectionString;
        _databaseName = databaseName;
        ConnectionString = connectionString;
    }

    public string ConnectionString { get; }

    public static async Task<ProviderTestDatabase> StartAsync(string name)
    {
        var admin = Environment.GetEnvironmentVariable(OverrideVariable);
        if (string.IsNullOrWhiteSpace(admin))
        {
            var container = new PostgreSqlBuilder("postgres:16-alpine")
                .WithUsername("postgres")
                .WithPassword("postgres")
                .WithDatabase(name)
                .Build();
            await container.StartAsync();
            return new ProviderTestDatabase(container, null, null, container.GetConnectionString());
        }

        var database = $"{name}_{Guid.NewGuid():N}"[..Math.Min(63, name.Length + 33)];
        await using (var connection = new NpgsqlConnection(admin))
        {
            await connection.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{database}\"", connection);
            await create.ExecuteNonQueryAsync();
        }

        var builder = new NpgsqlConnectionStringBuilder(admin) { Database = database };
        return new ProviderTestDatabase(null, admin, database, builder.ConnectionString);
    }

    /// <summary>
    /// Creates the cluster-wide roles the production privilege shape needs. Idempotent: on a shared local cluster another
    /// fixture may already have created them (roles are per cluster, not per database).
    /// </summary>
    public const string CreateRolesSql =
        """
        DO $roles$
        BEGIN
          -- Fixtures start in parallel against one cluster: two can both see a role missing, so the loser's CREATE is
          -- caught instead of checked first (a NOT EXISTS check alone races: 23505 on pg_authid_rolname_index).
          BEGIN CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END;
          BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END;
          BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END;
          BEGIN GRANT app_tenant TO CURRENT_USER; EXCEPTION WHEN unique_violation THEN NULL; END;
        END
        $roles$;
        """;

    public async ValueTask DisposeAsync()
    {
        if (_container is not null)
        {
            await _container.DisposeAsync();
            return;
        }

        NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection(_adminConnectionString);
        await connection.OpenAsync();
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)", connection);
        await drop.ExecuteNonQueryAsync();
    }
}
