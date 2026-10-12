using Npgsql;
using Tims.Infrastructure.CvParsing;

namespace Tims.IntegrationTests.CvParsing;

[Collection(nameof(CvParseLeaseCollection))]
public sealed class CvAiBudgetLedgerTests(CvParseLeaseFixture fixture)
{
    private static readonly DateTime Now = new(2026, 10, 10, 22, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Tenant_budget_and_usage_are_enforced_on_real_postgresql()
    {
        await fixture.ResetAsync();
        var agent = Guid.NewGuid();
        var firstOrg = Guid.NewGuid();
        var secondOrg = Guid.NewGuid();
        await fixture.SeedAgentAsync(agent);
        await fixture.SeedOrgConfigAsync(agent, firstOrg, enabled: true, monthlyBudget: 0.001);
        await fixture.SeedOrgConfigAsync(agent, secondOrg, enabled: false, monthlyBudget: 25);

        var ledger = new CvAiBudgetLedger(fixture.Source);
        Assert.Equal(agent, await ledger.AuthorizeAsync(firstOrg, Now, CancellationToken.None));
        await ledger.RecordAsync(agent, firstOrg, 800, 100, 300, true, Now, CancellationToken.None);
        // 0.0008 + 0.0005 = 0.0013: over the configured $0.001 budget.
        await Assert.ThrowsAsync<CvAiBudgetDeniedException>(() =>
            ledger.AuthorizeAsync(firstOrg, Now.AddSeconds(1), CancellationToken.None));
        await Assert.ThrowsAsync<CvAiBudgetDeniedException>(() =>
            ledger.AuthorizeAsync(secondOrg, Now, CancellationToken.None));

        await using var verify = await fixture.Source.OpenConnectionAsync();
        await using var check = new NpgsqlCommand("""
            SELECT organization_id, input_tokens, output_tokens, cost_usd, success
            FROM ai_agent_usage_logs WHERE agent_id = @agent
            """, verify);
        check.Parameters.AddWithValue("agent", agent);
        await using var reader = await check.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal(firstOrg, reader.GetGuid(0));
        Assert.Equal(800, reader.GetInt32(1));
        Assert.Equal(100, reader.GetInt32(2));
        Assert.Equal(0.0013, reader.GetDouble(3), 7);
        Assert.True(reader.GetBoolean(4));
        Assert.False(await reader.ReadAsync());
    }

    [Fact]
    public async Task Inactive_catalog_agent_denies_like_a_budget_condition()
    {
        await fixture.ResetAsync();
        var agent = Guid.NewGuid();
        await fixture.SeedAgentAsync(agent, status: "stub");
        await Assert.ThrowsAsync<CvAiBudgetDeniedException>(() =>
            new CvAiBudgetLedger(fixture.Source).AuthorizeAsync(Guid.NewGuid(), Now, CancellationToken.None));
    }
}
