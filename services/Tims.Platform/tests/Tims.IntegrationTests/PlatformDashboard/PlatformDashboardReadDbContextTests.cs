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

    /// <summary>
    /// PR 2's regression pin for <see cref="Tims.Infrastructure.PlatformDashboard.PlatformDashboardTimestamps"/>:
    /// a <see cref="DateTimeKind.Utc"/> bound against a mapped <c>timestamp without time zone</c> column
    /// is REJECTED by Npgsql, so the Unspecified re-kinding at the repository boundary is load-bearing.
    ///
    /// <para>Without this test, "simplifying" <c>ToNaive(nowUtc)</c> back to <c>nowUtc</c> would compile,
    /// pass every unit test, and 500 four endpoints the moment the flag was flipped — the same shape as
    /// slice 22's <c>EF.Constant</c> pin, and the mapped-column sibling of slice 23's TRAP 10.</para>
    ///
    /// <para>Both directions are asserted: the naive bound WORKS and returns the expected row, and the
    /// UTC-kind bound THROWS. A one-sided test would pass against a provider that silently coerced.</para>
    /// </summary>
    [Fact]
    public async Task A_UtcKind_bound_against_a_timestamp_column_is_rejected_which_is_why_the_repository_re_kinds()
    {
        await using var db = _fixture.NewReadContext();

        var utcKind = DateTime.SpecifyKind(_fixture.SeedNowUtc, DateTimeKind.Utc);
        var naive = DateTime.SpecifyKind(_fixture.SeedNowUtc, DateTimeKind.Unspecified);

        // The form the repositories actually use: naive, and it answers.
        var overdue = await db.Invoices
            .AsNoTracking()
            .Where(i => i.Status == "pending" && i.DueDate < naive)
            .CountAsync();
        Assert.Equal(2, overdue);

        // The form a "simplification" would produce: UTC-kind, and Npgsql refuses to write it.
        var failure = await Assert.ThrowsAnyAsync<Exception>(() => db.Invoices
            .AsNoTracking()
            .Where(i => i.Status == "pending" && i.DueDate < utcKind)
            .CountAsync());

        // Npgsql's wording, verbatim: "Cannot write DateTime with Kind=UTC to PostgreSQL type 'timestamp
        // without time zone'". Note the UPPERCASE "UTC" — it is not the DateTimeKind member name.
        var message = failure.InnerException?.Message ?? failure.Message;
        Assert.Contains("Kind=UTC", message, StringComparison.Ordinal);
        Assert.Contains("timestamp without time zone", message, StringComparison.Ordinal);
    }

    /// <summary>
    /// The enum predicates in these repositories are LITERALS, which Postgres coerces to the column's
    /// enum type. A captured VARIABLE would be parameterised as <c>text</c> and fail with
    /// <c>operator does not exist</c> — slice 22's TRAP 8, pinned here on a different enum column so the
    /// hazard stays visible in this slice too.
    /// </summary>
    [Fact]
    public async Task A_parameterised_enum_comparison_fails_which_is_why_the_repositories_use_literals()
    {
        await using var db = _fixture.NewReadContext();

        // Literal in the expression tree — works. THREE invoices are pending: the two overdue ones and
        // the decoy that is still in date (only the due_date predicate separates them).
        Assert.Equal(3, await db.Invoices.AsNoTracking().CountAsync(i => i.Status == "pending"));

        // Captured variable — parameterised as text, and Postgres has no "InvoiceStatus" = text operator.
        var status = "pending";
        var failure = await Assert.ThrowsAnyAsync<Exception>(() =>
            db.Invoices.AsNoTracking().CountAsync(i => i.Status == status));

        var message = failure.InnerException?.Message ?? failure.Message;
        Assert.Contains("operator does not exist", message, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("subscriptions", "plan", "OrgPlan")]
    [InlineData("organizations", "plan", "OrgPlan")]
    [InlineData("subscriptions", "status", "SubscriptionStatus")]
    [InlineData("invoices", "status", "InvoiceStatus")]
    [InlineData("platform_invitations", "status", "InvitationStatus")]
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
