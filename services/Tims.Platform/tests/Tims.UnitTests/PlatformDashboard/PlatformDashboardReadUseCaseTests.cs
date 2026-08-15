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

    // ── JS Math.round (half toward +∞, NOT banker's) ─────────────────────────────────────────────────
    [Theory]
    [InlineData(0.5, 1)]      // .NET Math.Round default would give 0 (to-even)
    [InlineData(2.5, 3)]      // ...and 2 here
    [InlineData(1.4, 1)]
    [InlineData(1.6, 2)]
    [InlineData(0.0, 0)]
    public void JsRound_rounds_half_up_for_nonNegative(double input, int expected) =>
        Assert.Equal(expected, PlatformDashboardReadUseCase.JsRound(input));

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

    // ── fixture DTOs ─────────────────────────────────────────────────────────────────────────────────
    internal sealed record Kernels(string[] SpanishShortMonths, MonthSeriesCase[] MonthSeriesCases);
    internal sealed record MonthSeriesCase(string Name, MonthRow[] Rows, int Months, string EndNowIso, MonthRow[] Series);
    internal sealed record MonthRow(string Month, int Count);
}
