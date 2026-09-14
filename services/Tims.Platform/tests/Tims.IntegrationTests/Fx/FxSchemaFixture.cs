using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Fx;

namespace Tims.IntegrationTests.Fx;

/// <summary>
/// Slice 11c real-schema proof for the efcore-OWNED, RLS-EXEMPT <c>fx_rates</c> table. Spins ONE Postgres,
/// creates the NOLOGIN/NOBYPASSRLS <c>app_tenant</c> role (granted to the superuser login so
/// <c>SET LOCAL ROLE app_tenant</c> can assume it), then applies the ACTUAL <c>20260723032952_fx_rates</c> EF
/// migration via <see cref="Microsoft.EntityFrameworkCore.Infrastructure.DatabaseFacade.MigrateAsync"/> — so the
/// table, the <c>GRANT SELECT … TO app_tenant</c>, and the DELIBERATE ABSENCE of any RLS policy are exactly what
/// ships. Mirrors <see cref="Tims.IntegrationTests.HrisSchemaFixture"/> but proves the RLS-EXEMPT posture.
/// </summary>
public sealed class FxSchemaFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_fx";

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

        // app_tenant must exist BEFORE the migration runs — the migration GRANTs SELECT on fx_rates to it.
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

        await using var migrateDb = new FxRateDbContext(BuildOptions(ConnectionString));
        await migrateDb.Database.MigrateAsync();
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public FxRateDbContext NewContext() => new(BuildOptions(ConnectionString));

    private static DbContextOptions<FxRateDbContext> BuildOptions(string connectionString) =>
        new DbContextOptionsBuilder<FxRateDbContext>().UseNpgsql(connectionString).Options;

    /// <summary>Truncate fx_rates between tests so each starts from a known, empty pin table.</summary>
    public async Task ResetAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var truncate = connection.CreateCommand();
        truncate.CommandText = "TRUNCATE TABLE fx_rates;";
        await truncate.ExecuteNonQueryAsync();
    }
}

[CollectionDefinition(nameof(FxSchemaCollection))]
public sealed class FxSchemaCollection : ICollectionFixture<FxSchemaFixture>;
