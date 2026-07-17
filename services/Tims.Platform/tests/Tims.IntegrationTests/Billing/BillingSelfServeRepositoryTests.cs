using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Billing;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Phase-5 Slice 4b Testcontainers proof (real Postgres, native enums, real RLS + FORCE — NEVER mocked) of the
/// tenant self-serve billing repository: getOrgBillingContext reads the org identity + subscription linkage
/// under TenantScope; and setStripeCustomerIdIfAbsent is a COMPARE-AND-SET — it creates a row when none
/// exists, claims the customer when unset, and NEVER overwrites an existing linkage (returning the
/// authoritative id). All under app_tenant + org GUC (the request path), never privileged.
/// </summary>
public sealed class BillingSelfServeRepositoryTests : IAsyncLifetime
{
    private static readonly Guid OrgRead = Guid.Parse("11111111-1111-1111-1111-000000000001");
    private static readonly Guid OrgNoSub = Guid.Parse("11111111-1111-1111-1111-000000000002");
    private static readonly Guid OrgCreate = Guid.Parse("11111111-1111-1111-1111-000000000003");
    private static readonly Guid OrgClaimNull = Guid.Parse("11111111-1111-1111-1111-000000000004");
    private static readonly Guid OrgClaimExisting = Guid.Parse("11111111-1111-1111-1111-000000000005");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres").WithPassword("postgres").WithDatabase("tims_billing_selfserve").Build();

    private NpgsqlDataSource? _dataSource;
    private string _connectionString = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = SchemaSql + SeedSql;
        await cmd.ExecuteNonQueryAsync();

        _dataSource = BillingSelfServeDataSource.Build(_connectionString);
    }

    public async Task DisposeAsync()
    {
        if (_dataSource is not null)
        {
            await _dataSource.DisposeAsync();
        }

        await _container.DisposeAsync();
    }

    private BillingSelfServeRepository Repo() =>
        new(new BillingSelfServeDbContext(new DbContextOptionsBuilder<BillingSelfServeDbContext>().UseNpgsql(_dataSource!).Options));

    private async Task<string?> ReadCustomerAsync(Guid org)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT stripe_customer_id FROM subscriptions WHERE organization_id = @org";
        cmd.Parameters.AddWithValue("org", org);
        var value = await cmd.ExecuteScalarAsync();
        return value is null or DBNull ? null : (string)value;
    }

    [Fact]
    public async Task GetOrgBillingContext_returns_org_and_subscription()
    {
        var ctx = await Repo().GetOrgBillingContextAsync(OrgRead.ToString(), CancellationToken.None);

        Assert.NotNull(ctx);
        Assert.Equal(OrgRead.ToString(), ctx!.Id);
        Assert.Equal("Read Org", ctx.Name);
        Assert.Equal("billing@read.example", ctx.BillingEmail);
        Assert.NotNull(ctx.Subscription);
        Assert.Equal("cus_read", ctx.Subscription!.StripeCustomerId);
        Assert.Equal("sub_read", ctx.Subscription.StripeSubscriptionId);
        Assert.Equal("professional", ctx.Subscription.Plan);
        Assert.Equal("active", ctx.Subscription.Status);
    }

    [Fact]
    public async Task GetOrgBillingContext_unknown_org_is_null()
    {
        Assert.Null(await Repo().GetOrgBillingContextAsync(Guid.NewGuid().ToString(), CancellationToken.None));
    }

    [Fact]
    public async Task GetOrgBillingContext_org_without_subscription_has_null_subscription()
    {
        var ctx = await Repo().GetOrgBillingContextAsync(OrgNoSub.ToString(), CancellationToken.None);

        Assert.NotNull(ctx);
        Assert.Null(ctx!.Subscription);
    }

    [Fact]
    public async Task SetStripeCustomerIdIfAbsent_creates_row_when_none_exists()
    {
        var result = await Repo().SetStripeCustomerIdIfAbsentAsync(OrgCreate.ToString(), "cus_created", CancellationToken.None);

        Assert.Equal("cus_created", result);
        Assert.Equal("cus_created", await ReadCustomerAsync(OrgCreate));
    }

    [Fact]
    public async Task SetStripeCustomerIdIfAbsent_claims_when_unset()
    {
        var result = await Repo().SetStripeCustomerIdIfAbsentAsync(OrgClaimNull.ToString(), "cus_claimed", CancellationToken.None);

        Assert.Equal("cus_claimed", result);
        Assert.Equal("cus_claimed", await ReadCustomerAsync(OrgClaimNull));
    }

    [Fact]
    public async Task SetStripeCustomerIdIfAbsent_never_overwrites_an_existing_customer()
    {
        // The org already has cus_existing; a concurrent create must NOT clobber it — return the existing id.
        var result = await Repo().SetStripeCustomerIdIfAbsentAsync(OrgClaimExisting.ToString(), "cus_new_loser", CancellationToken.None);

        Assert.Equal("cus_existing", result); // authoritative existing id, not the new one
        Assert.Equal("cus_existing", await ReadCustomerAsync(OrgClaimExisting));
    }

    private const string SchemaSql =
        """
        CREATE TYPE "OrgPlan" AS ENUM ('trial', 'starter', 'professional', 'enterprise');
        CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');
        CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
        GRANT app_tenant TO postgres;

        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            billing_email text NULL
        );
        CREATE TABLE subscriptions (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL UNIQUE,
            stripe_customer_id text NULL UNIQUE,
            stripe_subscription_id text NULL UNIQUE,
            plan "OrgPlan" NOT NULL DEFAULT 'trial',
            status "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
            created_at timestamp(3) NOT NULL DEFAULT now(),
            updated_at timestamp(3) NOT NULL DEFAULT now()
        );
        GRANT SELECT ON organizations TO app_tenant;
        GRANT SELECT, INSERT, UPDATE ON subscriptions TO app_tenant;

        ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON organizations
            USING (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON subscriptions
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string SeedSql =
        """
        INSERT INTO organizations (id, name, billing_email) VALUES
          ('11111111-1111-1111-1111-000000000001', 'Read Org', 'billing@read.example'),
          ('11111111-1111-1111-1111-000000000002', 'No Sub Org', NULL),
          ('11111111-1111-1111-1111-000000000003', 'Create Org', NULL),
          ('11111111-1111-1111-1111-000000000004', 'Claim Null Org', NULL),
          ('11111111-1111-1111-1111-000000000005', 'Claim Existing Org', NULL);

        INSERT INTO subscriptions (id, organization_id, stripe_customer_id, stripe_subscription_id, plan, status) VALUES
          ('5b000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-000000000001', 'cus_read', 'sub_read', 'professional', 'active'),
          ('5b000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-000000000004', NULL, NULL, 'trial', 'trialing'),
          ('5b000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-000000000005', 'cus_existing', NULL, 'starter', 'active');
        """;
}
