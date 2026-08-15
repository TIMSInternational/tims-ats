using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Tims.IntegrationTests.PlatformDashboard;

/// <summary>
/// Proof that <c>PlatformDashboardDataSource</c> is load-bearing rather than decorative (TRAP 3) — the
/// slice-23 analog of <c>PlatformInvitationsReadDbContextTests</c>.
///
/// <para>This context maps the native <c>OrgPlan</c> enum onto C# <c>string</c> on TWO tables:
/// <c>subscriptions.plan</c> and <c>organizations.plan</c>. EFCore.PG cannot materialise an unmapped enum
/// into a string, so on a plain connection string <c>getPlanDistribution</c> and <c>getRecentActivity</c>
/// would throw <c>InvalidCastException</c> on their first row the moment the flag was flipped — with every
/// unit test green, because the fault exists only against a real Postgres. (<c>getUserGrowth</c> is raw SQL
/// projecting text + bigint and genuinely does not care.)</para>
///
/// <para>The tests are a set: the configured path WORKS, the unconfigured path THROWS (so removing the
/// data source cannot pass silently), and the PREMISE holds (the columns are really native enums, so a
/// fixture drifting to <c>text</c> cannot make the first two pass for the wrong reason).</para>
/// </summary>
[Collection("PlatformDashboardRead")]
public sealed class PlatformDashboardReadDbContextTests(PlatformDashboardReadFixture fixture)
{
    private readonly PlatformDashboardReadFixture _fixture = fixture;

    [Fact]
    public async Task Reads_the_native_OrgPlan_enum_into_strings_on_both_tables_on_the_configured_data_source()
    {
        await using var db = _fixture.NewReadContext();

        var subscriptionPlans = await db.Subscriptions.AsNoTracking().Select(s => s.Plan).ToListAsync();
        Assert.Equal(8, subscriptionPlans.Count);
        Assert.Contains("enterprise", subscriptionPlans);

        var organization = await db.Organizations
            .AsNoTracking()
            .FirstOrDefaultAsync(o => o.Id == PlatformDashboardReadFixture.OrgH);
        Assert.NotNull(organization);
        Assert.Equal("enterprise", organization!.Plan);
    }

    [Theory]
    [InlineData("subscriptions")]
    [InlineData("organizations")]
    public async Task Fails_on_a_plain_connection_string_which_is_how_slice_19_shipped(string table)
    {
        await using var db = _fixture.NewReadContextWithoutUnmappedTypes();

        var failure = await Assert.ThrowsAsync<InvalidCastException>(() =>
            table == "subscriptions"
                ? db.Subscriptions.AsNoTracking().Select(s => s.Plan).ToListAsync()
                : db.Organizations.AsNoTracking().Select(o => o.Plan).ToListAsync());

        Assert.Contains("System.String", failure.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// The raw month group-by at repository level: the window bound is INCLUSIVE (the owner sits at exactly
    /// <c>from</c> and is counted), the 1s-earlier row is excluded, and rows land in their UTC month.
    /// The repository returns only NON-EMPTY months (gap-filling is the use case's job), so exactly three
    /// rows come back for the seed.
    /// </summary>
    [Fact]
    public async Task UserGrowth_raw_sql_respects_the_inclusive_window_and_groups_by_utc_month()
    {
        await using var db = _fixture.NewReadContext();
        var repository = new Tims.Infrastructure.PlatformDashboard.PlatformDashboardReadRepository(db);

        var m0 = _fixture.MonthStartUtc;
        var from = m0.AddMonths(-5);
        var rows = await repository.GetUserGrowthCountsAsync(from, CancellationToken.None);

        var byMonth = rows.ToDictionary(r => r.Month, r => r.Count);
        Assert.Equal(3, byMonth.Count);
        Assert.Equal(1, byMonth[$"{from:yyyy-MM}"]);              // the owner, at exactly `from`
        Assert.Equal(1, byMonth[$"{m0.AddMonths(-1):yyyy-MM}"]);  // 1s before the current month boundary
        Assert.Equal(5, byMonth[$"{m0:yyyy-MM}"]);                // the five current-month users
    }

    [Theory]
    [InlineData("subscriptions", "plan", "OrgPlan")]
    [InlineData("organizations", "plan", "OrgPlan")]
    public async Task The_plan_columns_really_are_native_enums_not_text(string table, string column, string expectedUdt)
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT udt_name FROM information_schema.columns WHERE table_name = @table AND column_name = @column";
        command.Parameters.AddWithValue("table", table);
        command.Parameters.AddWithValue("column", column);

        Assert.Equal(expectedUdt, (string?)await command.ExecuteScalarAsync());
    }
}
