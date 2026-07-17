using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Audit;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Phase-5 Slice 4b Testcontainers proof (real Postgres + real RLS, NEVER mocked) of the FIRST C# writer to
/// <c>audit_logs</c>: the billing audit APPENDS one row (<c>entity='billing'</c>, attributed actor, queryable
/// jsonb metadata) UNDER TenantScope; and — the load-bearing invariant — it is BEST-EFFORT / fail-SOFT: a
/// write failure (a DB with no <c>audit_logs</c> table) is swallowed, never surfacing to fail the billing action.
/// </summary>
public sealed class BillingAuditWriterTests : IAsyncLifetime
{
    private const string Database = "tims_billing_audit";
    private const string NoTableDatabase = "tims_billing_audit_notable";
    private static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Actor = Guid.Parse("a0000000-0000-0000-0000-000000000001");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres").WithPassword("postgres").WithDatabase(Database).Build();

    private string _connectionString = string.Empty;
    private string _noTableConnectionString = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();
        _noTableConnectionString = new NpgsqlConnectionStringBuilder(_connectionString) { Database = NoTableDatabase }.ConnectionString;

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText =
                """
                CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
                GRANT app_tenant TO postgres;

                CREATE TABLE audit_logs (
                    id uuid PRIMARY KEY,
                    organization_id uuid NOT NULL,
                    user_id uuid NULL,
                    actor_id uuid NULL,
                    action text NOT NULL,
                    entity text NOT NULL,
                    entity_id text NULL,
                    changes jsonb NULL,
                    metadata jsonb NULL,
                    ip_address text NULL,
                    user_agent text NULL,
                    created_at timestamp(3) NOT NULL DEFAULT now()
                );
                GRANT SELECT, INSERT ON audit_logs TO app_tenant;
                ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
                ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON audit_logs
                    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
                    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
                """;
            await cmd.ExecuteNonQueryAsync();
        }

        // CREATE DATABASE cannot run in a batch/pipeline — issue it as its own command.
        await using (var createDb = connection.CreateCommand())
        {
            createDb.CommandText = $"CREATE DATABASE {NoTableDatabase}";
            await createDb.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    private BillingAuditWriter Writer(string? connectionString = null) =>
        new(new AuditLogDbContext(new DbContextOptionsBuilder<AuditLogDbContext>()
            .UseNpgsql(connectionString ?? _connectionString).Options));

    [Fact]
    public async Task Appends_one_billing_audit_row_under_rls_with_queryable_metadata()
    {
        var metadata = new JsonObject { ["customerId"] = "cus_x", ["impersonatedUserId"] = "user-target" };

        await Writer().WriteAsync(OrgA.ToString(), Actor.ToString(), "billing.portal_opened", metadata, CancellationToken.None);

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var query = connection.CreateCommand();
        query.CommandText =
            "SELECT actor_id, entity, action, metadata ->> 'customerId', metadata ->> 'impersonatedUserId' FROM audit_logs WHERE organization_id = @org";
        query.Parameters.AddWithValue("org", OrgA);
        await using var reader = await query.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal(Actor, reader.GetGuid(0));
        Assert.Equal("billing", reader.GetString(1)); // entity hardcoded
        Assert.Equal("billing.portal_opened", reader.GetString(2));
        Assert.Equal("cus_x", reader.GetString(3)); // metadata stored as queryable jsonb
        Assert.Equal("user-target", reader.GetString(4)); // impersonation attribution carried in metadata
        Assert.False(await reader.ReadAsync()); // exactly one row
    }

    [Fact]
    public async Task Fail_soft_swallows_a_write_failure_and_never_throws()
    {
        // Point the writer at a DB WITHOUT audit_logs → the INSERT fails, but fail-soft swallows it: no throw.
        var metadata = new JsonObject { ["subscriptionId"] = "sub_x", ["cancelAtPeriodEnd"] = true };

        var exception = await Record.ExceptionAsync(() =>
            Writer(_noTableConnectionString).WriteAsync(
                OrgA.ToString(), Actor.ToString(), "billing.subscription_cancel_scheduled", metadata, CancellationToken.None));

        Assert.Null(exception); // never surfaces (best-effort parity with the TS recordBillingAudit .catch)
    }
}
