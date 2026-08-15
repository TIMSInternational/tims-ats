using System.Globalization;
using Tims.Application.PlatformDashboard;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.PlatformDashboard;

/// <summary>
/// Unit coverage for the pure shaping logic of the FX-free dashboard reads (Phase-5 slice 23 / issue #81).
/// The month-series kernel and the Spanish month names assert against
/// <c>contracts/dashboard-fixtures/dashboard-kernels.json</c> — the SAME golden the TS suite reads
/// (<c>tests/parity/dashboard-fixtures.test.ts</c>), so the two stacks are pinned to one artifact.
/// </summary>
public sealed class PlatformDashboardReadUseCaseTests
{
    private static readonly Kernels Golden = Fx.Load<Kernels>("dashboard-fixtures", "dashboard-kernels.json");

    // ── Spanish short month names (the toLocaleDateString('es',{month:'short'}) trap) ─────────────────
    [Fact]
    public void SpanishShortMonths_match_Node_ICU_byte_for_byte()
    {
        // The whole point: Node emits "sept" (4 chars) for September, which a CultureInfo("es") lookup does
        // not. Asserting all twelve against the golden proves the hardcoded array, not a culture, is used.
        for (var m = 0; m < 12; m++)
        {
            Assert.Equal(Golden.SpanishShortMonths[m], PlatformDashboardReadUseCase.SpanishShortMonth(m));
        }
        Assert.Equal("sept", PlatformDashboardReadUseCase.SpanishShortMonth(8));
    }

    // ── the month-series kernel (port of buildMonthSeries) ───────────────────────────────────────────
    [Fact]
    public void MonthSeries_matches_the_TS_kernel_on_every_golden_case()
    {
        foreach (var c in Golden.MonthSeriesCases)
        {
            var endNow = DateTime.Parse(c.EndNowIso, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
            var rows = c.Rows.Select(r => new MonthCountRow(r.Month, r.Count)).ToList();

            var series = PlatformDashboardReadUseCase.MonthSeries(rows, c.Months, endNow);

            Assert.Equal(c.Series.Length, series.Count);
            for (var i = 0; i < series.Count; i++)
            {
                Assert.Equal(c.Series[i].Month, series[i].Month);
                Assert.Equal(c.Series[i].Count, series[i].Count);
            }
        }
    }

    // ── the "sept 26" label (a SECOND, different ICU format — PR 2) ───────────────────────────────────
    [Fact]
    public void SpanishShortMonthYear2_matches_the_golden_on_every_case()
    {
        foreach (var c in Golden.SpanishShortMonthYear2Cases)
        {
            Assert.Equal(c.Label, PlatformDashboardReadUseCase.SpanishShortMonthYear2(c.Year, c.MonthIndex));
        }

        // The two shapes the composition rule exists for, called out so a golden regenerated without them
        // cannot quietly weaken this test: the four-character month, and a zero-PADDED year.
        Assert.Equal("sept 26", PlatformDashboardReadUseCase.SpanishShortMonthYear2(2026, 8));
        Assert.Equal("ene 00", PlatformDashboardReadUseCase.SpanishShortMonthYear2(2000, 0));
    }

    // ── Number.prototype.toLocaleString() under the ICU default locale (PR 2) ────────────────────────
    [Fact]
    public void JsToLocaleString_matches_the_golden_on_every_case()
    {
        foreach (var c in Golden.NumberToLocaleStringCases)
        {
            Assert.Equal(c.Text, PlatformDashboardReadUseCase.JsToLocaleString(c.Value));
        }

        // Grouping ON, decimal point, no minimum fraction digits, maximum three — the four properties the
        // format string encodes, each on a value that isolates it.
        Assert.Equal("1,000", PlatformDashboardReadUseCase.JsToLocaleString(1000));
        Assert.Equal("1,234.5", PlatformDashboardReadUseCase.JsToLocaleString(1234.5));
        Assert.Equal("0", PlatformDashboardReadUseCase.JsToLocaleString(0));
        Assert.Equal("1,234.568", PlatformDashboardReadUseCase.JsToLocaleString(1234.5678));
    }

    // ── PLAN_PRICES, pinned to the same golden the TS suite pins the real constant to (PR 2) ─────────
    [Fact]
    public void PlanPrices_match_the_golden()
    {
        Assert.Equal(Golden.PlanPrices.Count, PlanPrices.Table.Count);
        foreach (var (plan, price) in Golden.PlanPrices)
        {
            Assert.Equal(price, PlanPrices.For(plan));
        }

        // `PLAN_PRICES[plan] || 0` — an unknown plan contributes nothing rather than throwing.
        Assert.Equal(0, PlanPrices.For("legacy"));
    }

    // ── JS Math.round (half toward +∞, NOT banker's and NOT away-from-zero) ──────────────────────────
    [Theory]
    [InlineData(0.5, 1)]      // .NET Math.Round default would give 0 (to-even)
    [InlineData(2.5, 3)]      // ...and 2 here
    [InlineData(1.4, 1)]
    [InlineData(1.6, 2)]
    [InlineData(0.0, 0)]
    public void JsRound_rounds_half_up_for_nonNegative(double input, int expected) =>
        Assert.Equal(expected, PlatformDashboardReadUseCase.JsRound(input));

    /// <summary>
    /// The negatives. JS rounds half toward +∞, so <c>Math.round(-125.5) === -125</c>; the original
    /// implementation used <see cref="MidpointRounding.AwayFromZero"/> and would answer -126.
    ///
    /// <para><b>No caller reaches this today</b> — <c>getMrrForecast</c>'s growth rate looked like the
    /// counter-example, but its historical series is monotone non-decreasing (pinned by
    /// <c>PlatformDashboardMrrUseCaseTests</c>), so the <c>-0.2</c> floor and this branch are both dead
    /// in TS as well. These rows pin JS's ACTUAL rule anyway, because the argument for why it cannot be
    /// reached lives in a different file and could stop holding without anything here changing.</para>
    /// </summary>
    [Theory]
    [InlineData(-125.5, -125)]  // AwayFromZero would give -126
    [InlineData(-0.5, 0)]       // JS gives -0; JSON-identical to 0, and an int cannot hold the sign
    [InlineData(-1.5, -1)]
    [InlineData(-2.5, -2)]
    [InlineData(-1.6, -2)]
    [InlineData(-1.4, -1)]
    public void JsRound_rounds_half_toward_positive_infinity_for_negatives(double input, int expected) =>
        Assert.Equal(expected, PlatformDashboardReadUseCase.JsRound(input));

    [Fact]
    public void JsNow_is_truncated_to_whole_milliseconds_like_a_JS_Date()
    {
        // A JS Date carries integer milliseconds; DateTime.UtcNow carries 100-nanosecond ticks, and the
        // remainder would leak into every floor(msDiff / 86400000) day count.
        Assert.Equal(0, PlatformDashboardReadUseCase.JsNow().Ticks % TimeSpan.TicksPerMillisecond);
        Assert.Equal(DateTimeKind.Utc, PlatformDashboardReadUseCase.JsNow().Kind);

        var ragged = new DateTime(2026, 8, 14, 12, 0, 0, DateTimeKind.Utc).AddTicks(9_999);
        Assert.Equal(
            new DateTime(2026, 8, 14, 12, 0, 0, DateTimeKind.Utc).AddMilliseconds(0),
            PlatformDashboardReadUseCase.TruncateToMilliseconds(ragged));
    }

    // ── the shared month-bucket key walk (PR 2 extracted it from MonthSeries) ────────────────────────
    [Fact]
    public void MonthBucketKeys_walks_backwards_across_the_year_boundary()
    {
        var keys = PlatformDashboardReadUseCase.MonthBucketKeys(12, new DateTime(2026, 2, 10, 0, 0, 0, DateTimeKind.Utc));

        Assert.Equal(12, keys.Count);
        Assert.Equal("2025-03", keys[0]);
        Assert.Equal("2026-02", keys[^1]);
        Assert.Equal("2025-12", keys[9]);

        // Zero-padded month, and ordinal string comparison therefore matches chronological order — which
        // getMrrForecast's `<=` cumulative filter depends on.
        Assert.True(string.CompareOrdinal(keys[0], keys[^1]) < 0);
        Assert.Empty(PlatformDashboardReadUseCase.MonthBucketKeys(0, DateTime.UtcNow));
    }

    [Fact]
    public void ParseMonthBucketKey_returns_a_zero_based_month()
    {
        Assert.Equal((2026, 8), PlatformDashboardReadUseCase.ParseMonthBucketKey("2026-09"));
        Assert.Equal((2025, 0), PlatformDashboardReadUseCase.ParseMonthBucketKey("2025-01"));
    }

    // ── getPlanDistribution bucketing ────────────────────────────────────────────────────────────────
    [Fact]
    public void BuildPlanDistribution_seeds_the_four_plans_in_order_and_computes_percentages()
    {
        // 2 professional, 1 trial, 1 enterprise, out of 4 total → trial 25, starter 0, professional 50,
        // enterprise 25, in seed order regardless of input order.
        var dist = PlatformDashboardReadUseCase.BuildPlanDistribution(
            ["professional", "trial", "professional", "enterprise"]);

        Assert.Equal(["trial", "starter", "professional", "enterprise"], dist.Select(d => d.Plan));
        Assert.Equal([1, 0, 2, 1], dist.Select(d => d.Count));
        Assert.Equal([25, 0, 50, 25], dist.Select(d => d.Percentage));
    }

    [Fact]
    public void BuildPlanDistribution_appends_an_unknown_plan_after_the_four_seeds()
    {
        var dist = PlatformDashboardReadUseCase.BuildPlanDistribution(["legacy", "trial"]);

        // 'legacy' is not a seed, so it lands AFTER enterprise — JS object insertion order.
        Assert.Equal(["trial", "starter", "professional", "enterprise", "legacy"], dist.Select(d => d.Plan));
        Assert.Equal(50, dist.Single(d => d.Plan == "legacy").Percentage);
    }

    [Fact]
    public void BuildPlanDistribution_onEmpty_is_four_zero_rows_no_divide_by_zero()
    {
        var dist = PlatformDashboardReadUseCase.BuildPlanDistribution([]);

        Assert.Equal(4, dist.Count);
        Assert.All(dist, d => Assert.Equal(0, d.Count));
        Assert.All(dist, d => Assert.Equal(0, d.Percentage)); // total defaulted to 1, so 0/1 = 0, not NaN
    }

    // ── getRecentActivity merge + stable sort ────────────────────────────────────────────────────────
    [Fact]
    public void BuildRecentActivity_merges_sorts_desc_and_caps_at_ten()
    {
        var t = new DateTime(2026, 8, 1, 12, 0, 0, DateTimeKind.Utc);
        var orgs = Enumerable.Range(0, 6)
            .Select(i => new RecentOrgRow($"o{i}", $"Org{i}", "trial", t.AddMinutes(i)))
            .ToList();
        var users = Enumerable.Range(0, 6)
            .Select(i => new RecentUserRow($"u{i}", "First", "Last", $"u{i}@b.test", t.AddMinutes(i), false))
            .ToList();

        var activity = PlatformDashboardReadUseCase.BuildRecentActivity(orgs, users);

        Assert.Equal(10, activity.Count); // 12 merged, capped at 10
        Assert.Equal("Nueva organizacion: Org5", activity[0].Title); // newest org (o5 @ +5min)
        Assert.Equal("org_created", activity[0].Type);
        Assert.Equal("trial", activity[0].Meta);
    }

    [Fact]
    public void BuildRecentActivity_keeps_orgs_before_users_on_a_timestamp_tie()
    {
        var t = new DateTime(2026, 8, 1, 12, 0, 0, DateTimeKind.Utc); // identical timestamp on both
        var orgs = new List<RecentOrgRow> { new("o1", "Acme", "starter", t) };
        var users = new List<RecentUserRow> { new("u1", "Jane", "Doe", "jane@b.test", t, true) };

        var activity = PlatformDashboardReadUseCase.BuildRecentActivity(orgs, users);

        // Stable sort + orgs-pushed-first ⇒ the org wins the tie, matching TS's stable Array.sort.
        Assert.Equal("o1", activity[0].Id);
        Assert.Equal("platform_owner", activity[1].Type); // the platform-owner user is second
    }

    [Fact]
    public void BuildRecentActivity_onEmpty_is_an_empty_list_not_a_throw()
    {
        // The one endpoint whose parity PASS is vacuous on empty tables (surfaces.ts caveat 3) — so the
        // empty path is pinned HERE instead. TS returns [] from the sort+slice of an empty array.
        Assert.Empty(PlatformDashboardReadUseCase.BuildRecentActivity([], []));
    }

    [Fact]
    public void BuildRecentActivity_with_fewer_than_ten_returns_all_of_them_sorted()
    {
        var t = new DateTime(2026, 8, 1, 12, 0, 0, DateTimeKind.Utc);
        var orgs = new List<RecentOrgRow> { new("o1", "Acme", "starter", t.AddMinutes(1)) };
        var users = new List<RecentUserRow>
        {
            new("u1", "Jane", "Doe", "jane@b.test", t.AddMinutes(2), false),
            new("u2", "Sam", "Lee", "sam@b.test", t, false),
        };

        var activity = PlatformDashboardReadUseCase.BuildRecentActivity(orgs, users);

        // Take(10) over 3 items returns all 3 — no padding, no minimum.
        Assert.Equal(["u1", "o1", "u2"], activity.Select(a => a.Id));
    }

    // ── the static SEARCH_PAGES list, pinned to the same golden as the TS constant (PR 2) ────────────
    [Fact]
    public void SearchPages_match_the_golden_exactly()
    {
        Assert.Equal(Golden.SearchPages.Length, PlatformDashboardSearchUseCase.SearchPages.Count);

        for (var i = 0; i < Golden.SearchPages.Length; i++)
        {
            Assert.Equal(Golden.SearchPages[i].Name, PlatformDashboardSearchUseCase.SearchPages[i].Name);
            Assert.Equal(Golden.SearchPages[i].Href, PlatformDashboardSearchUseCase.SearchPages[i].Href);
            Assert.Equal(Golden.SearchPages[i].Keywords, PlatformDashboardSearchUseCase.SearchPages[i].Keywords);
        }
    }

    // ── fixture DTOs ─────────────────────────────────────────────────────────────────────────────────
    internal sealed record Kernels(
        Dictionary<string, int> PlanPrices,
        string[] SpanishShortMonths,
        MonthYearCase[] SpanishShortMonthYear2Cases,
        NumberCase[] NumberToLocaleStringCases,
        SearchPageCase[] SearchPages,
        MonthSeriesCase[] MonthSeriesCases);
    internal sealed record MonthSeriesCase(string Name, MonthRow[] Rows, int Months, string EndNowIso, MonthRow[] Series);
    internal sealed record MonthRow(string Month, int Count);
    internal sealed record MonthYearCase(int Year, int MonthIndex, string Label);
    internal sealed record NumberCase(double Value, string Text);
    internal sealed record SearchPageCase(string Name, string Href, string Keywords);
}
