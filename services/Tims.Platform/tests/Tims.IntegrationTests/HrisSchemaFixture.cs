using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Hris;

namespace Tims.IntegrationTests;

/// <summary>
/// WP3.1 real-RLS proof for the first EF-OWNED product tables. Spins ONE Postgres container, creates
/// the NOLOGIN/NOBYPASSRLS <c>app_tenant</c> role (granted to the superuser login so
/// <c>SET LOCAL ROLE app_tenant</c> can assume it), then applies the ACTUAL
/// <c>20260716000000_hris_domain</c> EF migration via <see cref="DatabaseFacade.MigrateAsync"/> — so
/// the tables, the <c>EnableTenantRls</c> ENABLE/FORCE/policy blocks, and the app_tenant GRANTs under
/// test are exactly what ships, never hand-rewritten DDL. Two orgs are seeded (connectors + external
/// employees) as the superuser (bypasses RLS).
///
/// Mirrors <see cref="RlsFixture"/>: the container login role is a SUPERUSER (bypasses RLS), which is
/// why the role switch — not the query — is what engages tenant isolation.
/// </summary>
public sealed class HrisSchemaFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_hris";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid ConnectorA = Guid.Parse("aaaaaaaa-0000-0000-0000-0000000000c1");
    public static readonly Guid ConnectorB = Guid.Parse("bbbbbbbb-0000-0000-0000-0000000000c1");

    public static readonly Guid EmployeeA = Guid.Parse("aaaaaaaa-0000-0000-0000-0000000000e1");
    public static readonly Guid EmployeeB = Guid.Parse("bbbbbbbb-0000-0000-0000-0000000000e1");

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

        // The app_tenant role must exist BEFORE the migration runs — the migration GRANTs table
        // privileges to it (RLS only engages for a NOBYPASSRLS role the session can SET LOCAL ROLE to).
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

        // Apply the REAL EF migration (tables + EnableTenantRls + GRANTs) as the superuser.
        await using (var migrateDb = new HrisDbContext(BuildOptions(ConnectionString)))
        {
            await migrateDb.Database.MigrateAsync();
        }

        await SeedAsync(ConnectionString);
    }

    public async Task DisposeAsync()
    {
        await _container.DisposeAsync();
    }

    public static DbContextOptions<HrisDbContext> BuildOptions(string connectionString) =>
        new DbContextOptionsBuilder<HrisDbContext>()
            .UseNpgsql(connectionString)
            .Options;

    // Seed two orgs' connectors + external employees as the superuser/owner (bypasses RLS).
    private static async Task SeedAsync(string connectionString)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();

        await using var seed = connection.CreateCommand();
        seed.CommandText =
            """
            INSERT INTO hris_connectors (id, organization_id, provider, display_name, status)
            VALUES (@connectorA, @orgA, 'bamboohr', 'Org A BambooHR', 'connected'),
                   (@connectorB, @orgB, 'bamboohr', 'Org B BambooHR', 'connected');

            INSERT INTO hris_external_employees
                (id, organization_id, connector_id, external_id, first_name, last_name, source_hash)
            VALUES (@employeeA, @orgA, @connectorA, 'ext-a-1', 'Ada', 'Alpha', 'hash-a'),
                   (@employeeB, @orgB, @connectorB, 'ext-b-1', 'Ben', 'Bravo', 'hash-b');
            """;
        seed.Parameters.AddWithValue("connectorA", ConnectorA);
        seed.Parameters.AddWithValue("connectorB", ConnectorB);
        seed.Parameters.AddWithValue("employeeA", EmployeeA);
        seed.Parameters.AddWithValue("employeeB", EmployeeB);
        seed.Parameters.AddWithValue("orgA", OrgA);
        seed.Parameters.AddWithValue("orgB", OrgB);
        await seed.ExecuteNonQueryAsync();
    }
}
