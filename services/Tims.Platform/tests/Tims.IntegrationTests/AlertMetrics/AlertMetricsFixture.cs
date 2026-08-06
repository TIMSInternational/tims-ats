using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.AlertMetrics;

namespace Tims.IntegrationTests.AlertMetrics;

/// <summary>
/// Q0b slice 2 Testcontainers fixture. One real Postgres carrying `surveys` and `salary_adjustments` with
/// the EXACT RLS posture prod has for these two tables — <c>ENABLE</c> + <b><c>FORCE</c></b> ROW LEVEL
/// SECURITY plus the fail-closed <c>tenant_isolation</c> policy (verified against
/// packages/db/baseline/prod-public-schema.sql:2620/2474 for FORCE, :7931/:7889 for the policy, :7345/:7303
/// for ENABLE). FORCE is the load-bearing detail: it means even the table OWNER is filtered, so a test that
/// only did ENABLE would prove nothing about whether the cross-org reader actually works in prod.
///
/// Testcontainers connects as `postgres`, a SUPERUSER — superusers bypass RLS, which is the container's
/// stand-in for prod's BYPASSRLS base login role
/// (docs/architecture/csharp-migration/PROD-DEPLOY-PREP-2026-07-27.md:139). `app_tenant` is created
/// NOBYPASSRLS and granted to postgres so <see cref="Tims.Infrastructure.TenantScope"/>'s
/// <c>SET LOCAL ROLE app_tenant</c> can engage RLS on the SAME connection — that pairing is what lets one
/// test prove "privileged sees all orgs" and another prove "scoped sees one org" without the first being a
/// false positive caused by RLS simply not being on.
///
/// Seed shape is chosen so the §21 min-5 floor is exercised for real:
///   OrgA — 2 active surveys (+1 draft, which must NOT be counted), 5 pending salary adjustments (+1
///          approved, which must NOT be counted) → an UNSUPPRESSED sensitive value of 5;
///   OrgB — 1 active survey, 3 pending salary adjustments → a SUPPRESSED sensitive outcome (1..4).
/// </summary>
public sealed class AlertMetricsFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_alert_metrics";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    /// <summary>An org with no rows at all — the EMPTY-database question: the surface must return 0, not a tick.</summary>
    public static readonly Guid OrgWithNoRows = Guid.Parse("33333333-3333-3333-3333-333333333333");

    public const string CronSecret = "cron-secret-under-test-do-not-reuse";

    public const int OrgAActiveSurveys = 2;
    public const int OrgAPendingAdjustments = 5;
    public const int OrgBActiveSurveys = 1;
    public const int OrgBPendingAdjustments = 3;

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

        foreach (var sql in new[] { RoleSql, SchemaSql, SeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public AlertMetricsDbContext NewContext() =>
        new(new DbContextOptionsBuilder<AlertMetricsDbContext>().UseNpgsql(ConnectionString).Options);

    private const string RoleSql = "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;";

    private const string SchemaSql =
        """
        CREATE TABLE surveys (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            status text NOT NULL DEFAULT 'draft'
        );
        CREATE TABLE salary_adjustments (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            status text NOT NULL DEFAULT 'pending'
        );

        GRANT SELECT ON surveys TO app_tenant;
        GRANT SELECT ON salary_adjustments TO app_tenant;

        ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;
        ALTER TABLE surveys FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON surveys
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

        ALTER TABLE salary_adjustments ENABLE ROW LEVEL SECURITY;
        ALTER TABLE salary_adjustments FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON salary_adjustments
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // Seeded as the superuser/owner. NOTE: FORCE RLS applies to the owner too, so these INSERTs succeed
    // only because `postgres` is a SUPERUSER (superusers bypass RLS entirely, FORCE included).
    private const string SeedSql =
        """
        INSERT INTO surveys (id, organization_id, status) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'active'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'active'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'draft'),
          ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'active');

        INSERT INTO salary_adjustments (id, organization_id, status) VALUES
          ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'pending'),
          ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'pending'),
          ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'pending'),
          ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'pending'),
          ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'pending'),
          ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'approved'),
          ('b1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'pending'),
          ('b1000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'pending'),
          ('b1000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'pending');
        """;
}

[CollectionDefinition("AlertMetrics")]
public sealed class AlertMetricsCollection : ICollectionFixture<AlertMetricsFixture>;
