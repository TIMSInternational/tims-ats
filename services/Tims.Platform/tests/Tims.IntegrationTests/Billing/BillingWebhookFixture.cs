using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Billing;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Phase-5 Slice 4 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED <c>subscriptions</c> +
/// <c>organizations</c> tables WITH the native <c>OrgPlan</c>/<c>SubscriptionStatus</c> enum types and their
/// Prisma DB defaults (trial/trialing), the unique <c>organization_id</c> (the upsert key), AND RLS ENABLE +
/// FORCE with the fail-closed <c>tenant_isolation</c> policy. The webhook repository connects on the
/// PRIVILEGED (superuser → BYPASSRLS) connection — faithfully modelling the prod privileged pooler role — so
/// it writes with an EXPLICIT organization_id and no org GUC; a <c>NOLOGIN/NOBYPASSRLS app_tenant</c> role is
/// present so the RLS-necessity bite can prove a tenant-scoped writer would be blocked.
///
/// Distinct orgs per destructive test so the shared container never collides.
/// </summary>
public sealed class BillingWebhookFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_billing_webhook";

    // Orgs WITHOUT a subscription row (insert / link-new / concurrency / rls paths).
    public static readonly Guid OrgInsert = Guid.Parse("10000000-0000-0000-0000-000000000001");
    public static readonly Guid OrgLinkNew = Guid.Parse("10000000-0000-0000-0000-000000000007");
    public static readonly Guid OrgConcurrent = Guid.Parse("10000000-0000-0000-0000-000000000009");
    public static readonly Guid OrgRls = Guid.Parse("10000000-0000-0000-0000-00000000000a");

    // Orgs WITH a seeded existing subscription.
    public static readonly Guid OrgUpdate = Guid.Parse("10000000-0000-0000-0000-000000000002");
    public static readonly Guid OrgDuplicate = Guid.Parse("10000000-0000-0000-0000-000000000003");
    public static readonly Guid OrgStale = Guid.Parse("10000000-0000-0000-0000-000000000004");
    public static readonly Guid OrgNoDowngrade = Guid.Parse("10000000-0000-0000-0000-000000000005");
    public static readonly Guid OrgResolve = Guid.Parse("10000000-0000-0000-0000-000000000006");
    public static readonly Guid OrgLinkExisting = Guid.Parse("10000000-0000-0000-0000-000000000008");
    public static readonly Guid OrgB = Guid.Parse("20000000-0000-0000-0000-000000000001");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    private NpgsqlDataSource? _dataSource;

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using (var role = connection.CreateCommand())
        {
            role.CommandText =
                """
                CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
                GRANT app_tenant TO postgres;
                """;
            await role.ExecuteNonQueryAsync();
        }

        await using (var ddl = connection.CreateCommand())
        {
            ddl.CommandText = SchemaSql + SeedSql;
            await ddl.ExecuteNonQueryAsync();
        }

        // The privileged webhook data source (EnableUnmappedTypes for the native SubscriptionStatus read),
        // shared across the repo contexts the tests build.
        _dataSource = BillingWebhookDataSource.Build(ConnectionString);
    }

    public async Task DisposeAsync()
    {
        if (_dataSource is not null)
        {
            await _dataSource.DisposeAsync();
        }

        await _container.DisposeAsync();
    }

    /// <summary>A webhook context on the PRIVILEGED connection (EnableUnmappedTypes), as Program.cs wires it.</summary>
    public BillingWebhookDbContext NewWebhookContext() =>
        new(new DbContextOptionsBuilder<BillingWebhookDbContext>().UseNpgsql(_dataSource!).Options);

    public async Task<NpgsqlConnection> OpenSuperuserConnectionAsync()
    {
        var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    /// <summary>Reads a subscription row as superuser (RLS bypassed) — null if absent.</summary>
    public async Task<SubscriptionSnapshot?> GetSubscriptionAsync(Guid organizationId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT stripe_customer_id, stripe_subscription_id, plan::text, status::text,
                   current_period_start, current_period_end, cancelled_at, last_stripe_event_at
            FROM subscriptions WHERE organization_id = @org
            """;
        command.Parameters.AddWithValue("org", organizationId);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return new SubscriptionSnapshot(
            reader.IsDBNull(0) ? null : reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetDateTime(4),
            reader.IsDBNull(5) ? null : reader.GetDateTime(5),
            reader.IsDBNull(6) ? null : reader.GetDateTime(6),
            reader.IsDBNull(7) ? null : reader.GetDateTime(7));
    }

    /// <summary>Reads organizations.plan as superuser.</summary>
    public async Task<string> GetOrgPlanAsync(Guid organizationId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT plan::text FROM organizations WHERE id = @org";
        command.Parameters.AddWithValue("org", organizationId);
        return (string)(await command.ExecuteScalarAsync())!;
    }

    /// <summary>Counts subscription rows for an org (0/1) — proves the upsert never duplicates on the unique org.</summary>
    public async Task<int> CountSubscriptionsAsync(Guid organizationId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*) FROM subscriptions WHERE organization_id = @org";
        command.Parameters.AddWithValue("org", organizationId);
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    private const string SchemaSql =
        """
        CREATE TYPE "OrgPlan" AS ENUM ('trial', 'starter', 'professional', 'enterprise');
        CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');

        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            plan "OrgPlan" NOT NULL DEFAULT 'trial',
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE subscriptions (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL UNIQUE,
            stripe_customer_id text NULL UNIQUE,
            stripe_subscription_id text NULL UNIQUE,
            plan "OrgPlan" NOT NULL DEFAULT 'trial',
            status "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
            current_period_start timestamp(3) NULL,
            current_period_end timestamp(3) NULL,
            trial_ends_at timestamp(3) NULL,
            cancelled_at timestamp(3) NULL,
            last_stripe_event_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL DEFAULT now(),
            updated_at timestamp(3) NOT NULL DEFAULT now()
        );

        GRANT SELECT, INSERT, UPDATE ON subscriptions TO app_tenant;
        GRANT SELECT, UPDATE ON organizations TO app_tenant;

        -- RLS on subscriptions AND organizations (both FORCE, as in prod): the privileged (superuser/BYPASSRLS)
        -- webhook write — the subscription upsert AND the organizations.plan mirror — must succeed with no GUC
        -- set, while a tenant-scoped writer without the GUC is fail-closed (the RLS-necessity bite).
        ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON subscriptions
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON organizations
            USING (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // organizations for every org; existing subscriptions only where a test needs a prior row.
    // last_stripe_event_at 2021-06-01 on the "old" rows so a newer/older incoming event is unambiguous.
    private const string SeedSql =
        """
        INSERT INTO organizations (id, plan) VALUES
          ('10000000-0000-0000-0000-000000000001', 'trial'),
          ('10000000-0000-0000-0000-000000000002', 'trial'),
          ('10000000-0000-0000-0000-000000000003', 'professional'),
          ('10000000-0000-0000-0000-000000000004', 'starter'),
          ('10000000-0000-0000-0000-000000000005', 'professional'),
          ('10000000-0000-0000-0000-000000000006', 'starter'),
          ('10000000-0000-0000-0000-000000000007', 'trial'),
          ('10000000-0000-0000-0000-000000000008', 'starter'),
          ('10000000-0000-0000-0000-000000000009', 'trial'),
          ('10000000-0000-0000-0000-00000000000a', 'trial'),
          ('20000000-0000-0000-0000-000000000001', 'professional');

        INSERT INTO subscriptions
          (id, organization_id, stripe_customer_id, stripe_subscription_id, plan, status, last_stripe_event_at) VALUES
          ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'cus_update', 'sub_update', 'starter', 'active', '2021-06-01 00:00:00'),
          ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'cus_dup', 'sub_current', 'professional', 'active', '2021-06-01 00:00:00'),
          ('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'cus_stale', 'sub_stale', 'starter', 'active', '2021-06-01 00:00:00'),
          ('50000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'cus_nodown', 'sub_nodown', 'professional', 'active', '2021-06-01 00:00:00'),
          ('50000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', 'cus_resolve', 'sub_resolve', 'starter', 'active', '2021-06-01 00:00:00'),
          ('50000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000008', 'cus_old', 'sub_link', 'starter', 'active', '2021-06-01 00:00:00'),
          ('50000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', 'cus_b', 'sub_b', 'professional', 'active', '2021-06-01 00:00:00');
        """;
}

/// <summary>A superuser read of a subscription row (RLS bypassed) for the integration assertions.</summary>
public sealed record SubscriptionSnapshot(
    string? StripeCustomerId,
    string? StripeSubscriptionId,
    string Plan,
    string Status,
    DateTime? CurrentPeriodStart,
    DateTime? CurrentPeriodEnd,
    DateTime? CancelledAt,
    DateTime? LastStripeEventAt);
