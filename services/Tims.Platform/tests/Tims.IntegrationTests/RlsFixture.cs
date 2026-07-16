using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure;

namespace Tims.IntegrationTests;

/// <summary>
/// Spins up one real Postgres container and applies the exact RLS mechanism
/// described in docs/architecture/2026-07-15-csharp-backend-target-architecture.md
/// §3: a NOLOGIN/NOBYPASSRLS `app_tenant` role, an org-scoped `widgets` table with
/// ENABLE + FORCE ROW LEVEL SECURITY, and the fail-closed `tenant_isolation` policy.
///
/// Testcontainers connects as the container's configured login role ("postgres"),
/// which is a SUPERUSER — superusers bypass RLS entirely. That is why `app_tenant`
/// is granted to "postgres": `SET LOCAL ROLE app_tenant` lets the session
/// temporarily assume a NOBYPASSRLS identity, which is what actually engages RLS.
/// Without that role switch, every query over this same connection would silently
/// see all rows and the spike would be a false positive.
/// </summary>
public sealed class RlsFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_spike_a";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid WidgetA1 = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    public static readonly Guid WidgetA2 = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002");
    public static readonly Guid WidgetB1 = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000001");
    public static readonly Guid WidgetB2 = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    /// <summary>The container's own connection string (default ADO.NET pooling, unbounded).</summary>
    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using var setup = connection.CreateCommand();
        setup.CommandText =
            """
            CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
            GRANT app_tenant TO postgres;

            CREATE TABLE widgets (
                id uuid PRIMARY KEY,
                organization_id uuid NOT NULL,
                name text NOT NULL
            );

            GRANT SELECT, INSERT, UPDATE, DELETE ON widgets TO app_tenant;

            ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;
            ALTER TABLE widgets FORCE ROW LEVEL SECURITY;

            CREATE POLICY tenant_isolation ON widgets
                USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
                WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
            """;
        await setup.ExecuteNonQueryAsync();

        // Seed as the superuser/owner (bypasses RLS) — two orgs, two rows each.
        await using var seed = connection.CreateCommand();
        seed.CommandText = "INSERT INTO widgets (id, organization_id, name) VALUES " +
                            "(@a1, @orgA, 'widget-a1'), (@a2, @orgA, 'widget-a2'), " +
                            "(@b1, @orgB, 'widget-b1'), (@b2, @orgB, 'widget-b2')";
        seed.Parameters.AddWithValue("a1", WidgetA1);
        seed.Parameters.AddWithValue("a2", WidgetA2);
        seed.Parameters.AddWithValue("b1", WidgetB1);
        seed.Parameters.AddWithValue("b2", WidgetB2);
        seed.Parameters.AddWithValue("orgA", OrgA);
        seed.Parameters.AddWithValue("orgB", OrgB);
        await seed.ExecuteNonQueryAsync();
    }

    public async Task DisposeAsync()
    {
        await _container.DisposeAsync();
    }

    public static DbContextOptions<TenantWidgetDbContext> BuildOptions(string connectionString)
    {
        return new DbContextOptionsBuilder<TenantWidgetDbContext>()
            .UseNpgsql(connectionString)
            .Options;
    }
}
