using Tims.Application.PlatformDashboard;

namespace Tims.UnitTests.PlatformDashboard;

/// <summary>
/// Unit coverage for <c>getMrrTrend</c> and <c>getMrrForecast</c> (Phase-5 slice 23 / issue #81, PR 2 of
/// 3) — the cumulative walk, the baseline rule (including the future-dated row TS mis-handles), the growth
/// average and its cap, and the negative-rounding path that forced <c>JsRound</c> to change.
/// </summary>
public sealed class PlatformDashboardMrrUseCaseTests
{
    /// <summary>August 2026, so the twelve buckets run 2025-09 … 2026-08.</summary>
    private static readonly DateTime Now = new(2026, 8, 14, 12, 0, 0, DateTimeKind.Utc);

    // ── getMrrTrend ─────────────────────────────────────────────────────────────────────────────────
    [Fact]
    public void Trend_returns_twelve_labelled_buckets_oldest_first()
    {
        var trend = PlatformDashboardMrrUseCase.BuildMrrTrend([], Now);

        Assert.Equal(12, trend.Count);
        Assert.Equal("sept 25", trend[0].Month); // the four-character month AND the two-digit year
        Assert.Equal("ago 26", trend[^1].Month);
        Assert.All(trend, p => Assert.Equal(0, p.Mrr));
    }

    [Fact]
    public void Trend_accumulates_forward_and_never_decreases()
    {
        var trend = PlatformDashboardMrrUseCase.BuildMrrTrend(
            [
                new ActivePlanMonthCount("2026-06", "starter", 2),      // 998
                new ActivePlanMonthCount("2026-08", "professional", 1), // 999
            ],
            Now);

        // Buckets: …, 2026-06 (index 9), 2026-07 (10), 2026-08 (11).
        Assert.Equal(0, trend[8].Mrr);
        Assert.Equal(998, trend[9].Mrr);
        Assert.Equal(998, trend[10].Mrr);   // nothing new in July, the running total carries
        Assert.Equal(1997, trend[11].Mrr);
    }

    [Fact]
    public void Trend_folds_rows_older_than_the_window_into_a_baseline_present_in_every_bucket()
    {
        var trend = PlatformDashboardMrrUseCase.BuildMrrTrend(
            [new ActivePlanMonthCount("2020-01", "enterprise", 2)], // 4998, long before the window
            Now);

        Assert.All(trend, p => Assert.Equal(4998, p.Mrr));
    }

    [Fact]
    public void Trend_ALSO_folds_a_FUTURE_dated_row_into_the_baseline_which_is_a_TS_defect_reproduced()
    {
        // `if (!bucketSet.has(month))` is a set-membership test, not an ordering test, so a subscription
        // created AFTER the window fails it exactly like one created before — and is therefore counted in
        // all twelve months, including ones that precede its own creation. Faithful port of a real bug:
        // "fixing" it here would make the C# diverge from production on precisely the rows that trigger it.
        var trend = PlatformDashboardMrrUseCase.BuildMrrTrend(
            [new ActivePlanMonthCount("2027-01", "starter", 1)],
            Now);

        Assert.All(trend, p => Assert.Equal(499, p.Mrr));
    }

    [Fact]
    public void Trend_prices_an_unknown_plan_at_zero()
    {
        var trend = PlatformDashboardMrrUseCase.BuildMrrTrend(
            [new ActivePlanMonthCount("2026-08", "legacy", 40)],
            Now);

        Assert.Equal(0, trend[^1].Mrr);
    }

    // ── getMrrForecast: the historical half ─────────────────────────────────────────────────────────
    [Fact]
    public void Forecast_historical_is_cumulative_by_creation_month_not_baseline_plus_increments()
    {
        var result = PlatformDashboardMrrUseCase.BuildMrrForecast(
            [new ActivePlanMonthCount("2027-01", "starter", 1)], // FUTURE — outside every bucket
            0,
            Now);

        // Unlike the trend, the forecast's per-bucket filter is `createdAt < end`, an ORDERING test, so a
        // future-dated row contributes to NOTHING. The two procedures genuinely disagree on this input;
        // both behaviours are ported as written.
        Assert.All(result.Historical, p => Assert.Equal(0, p.Mrr));
        Assert.Equal(0, result.CurrentMrr);
        // …but planBreakdown has NO date bound at all, so the same row IS counted there.
        Assert.Equal(1, result.PlanBreakdown["starter"].Count);
        Assert.Equal(499, result.PlanBreakdown["starter"].Mrr);
    }

    [Fact]
    public void Forecast_historical_and_projected_are_twelve_each_and_carry_their_type_discriminator()
    {
        var result = PlatformDashboardMrrUseCase.BuildMrrForecast([], 0, Now);

        Assert.Equal(12, result.Historical.Count);
        Assert.Equal(12, result.Projected.Count);
        Assert.All(result.Historical, p => Assert.Equal("historical", p.Type));
        Assert.All(result.Projected, p => Assert.Equal("projected", p.Type));
        // Projection continues the calendar walk: last historical is ago 26, first projected is sept 26.
        Assert.Equal("ago 26", result.Historical[^1].Month);
        Assert.Equal("sept 26", result.Projected[0].Month);
        Assert.Equal("ago 27", result.Projected[^1].Month);
    }

    // ── getMrrForecast: growth ──────────────────────────────────────────────────────────────────────
    [Fact]
    public void Forecast_growth_is_zero_when_fewer_than_two_months_are_nonzero()
    {
        var result = PlatformDashboardMrrUseCase.BuildMrrForecast(
            [new ActivePlanMonthCount("2026-08", "starter", 1)], // only the last bucket is non-zero
            0,
            Now);

        Assert.Equal(0d, result.MonthlyGrowthPct);
        Assert.Equal(499, result.CurrentMrr);
        Assert.All(result.Projected, p => Assert.Equal(499, p.Mrr)); // flat at zero growth
    }

    [Fact]
    public void Forecast_growth_is_capped_at_thirty_percent()
    {
        // Two subscribers added in the last two months from a base of one → a huge month-over-month rate
        // that the cap must pull back to exactly +30%.
        var result = PlatformDashboardMrrUseCase.BuildMrrForecast(
            [
                new ActivePlanMonthCount("2026-07", "starter", 1),
                new ActivePlanMonthCount("2026-08", "enterprise", 4),
            ],
            0,
            Now);

        Assert.Equal(30d, result.MonthlyGrowthPct);
        // 10495 × 1.3 = 13643.5 → JS Math.round takes a .5 UP.
        Assert.Equal(10495, result.CurrentMrr);
        Assert.Equal(13644, result.Projected[0].Mrr);
    }

    /// <summary>
    /// The historical series can never DECREASE, which is why the <c>-0.2</c> floor and the negative
    /// branch of <c>Math.round</c> are dead code in both stacks.
    ///
    /// <para>Recorded as a test rather than a comment because it is the premise the growth cap's whole
    /// lower half rests on, it is not local to this file (it follows from the per-bucket filter only ever
    /// widening), and a future change that made the buckets non-cumulative would break it silently. If
    /// this test ever goes red, <c>MinMonthlyGrowth</c> has become live and its rounding needs a look.
    /// </para>
    /// </summary>
    [Fact]
    public void Forecast_historical_is_monotone_nonDecreasing_so_the_negative_growth_cap_is_dead_code()
    {
        var months = new[] { "2025-01", "2025-11", "2026-01", "2026-04", "2026-06", "2026-08", "2027-02" };
        var plans = new[] { "trial", "starter", "professional", "enterprise" };

        // Every single-row shape, plus a dense multi-row one — enough to cover before-window, in-window
        // and after-window creation months against each price.
        var shapes = months
            .SelectMany(m => plans.Select(p => (IReadOnlyList<ActivePlanMonthCount>)[new ActivePlanMonthCount(m, p, 3)]))
            .Append(months.Select((m, i) => new ActivePlanMonthCount(m, plans[i % plans.Length], i + 1)).ToList())
            .ToList();

        foreach (var rows in shapes)
        {
            var result = PlatformDashboardMrrUseCase.BuildMrrForecast(rows, 0, Now);

            for (var i = 1; i < result.Historical.Count; i++)
            {
                Assert.True(
                    result.Historical[i].Mrr >= result.Historical[i - 1].Mrr,
                    $"historical must never decrease, but bucket {i} fell to {result.Historical[i].Mrr}");
            }

            Assert.True(result.MonthlyGrowthPct >= 0, "a non-decreasing history cannot yield negative growth");
        }
    }

    [Fact]
    public void Forecast_compounds_the_capped_rate_rather_than_adding_it()
    {
        var result = PlatformDashboardMrrUseCase.BuildMrrForecast(
            [
                new ActivePlanMonthCount("2026-06", "starter", 1),
                new ActivePlanMonthCount("2026-07", "starter", 1),
                new ActivePlanMonthCount("2026-08", "starter", 1),
            ],
            0,
            Now);

        // 499 → 998 (+100%) → 1497 (+50%); mean +75%, capped to +30%.
        Assert.Equal(30d, result.MonthlyGrowthPct);
        Assert.Equal(1497, result.CurrentMrr);

        // Compounding: 1497 × 1.3^12 = 34 877.29… → 34 877, five times the 1497 × (1 + 12 × 0.3) = 6886
        // that linear growth would give. The expected values are LITERALS taken from running the TS
        // expression in Node, not from re-deriving the formula here — a test that recomputes the thing it
        // checks agrees with any implementation, including a wrong one.
        Assert.Equal(34_877, result.ProjectedMrr12m);
        Assert.Equal(418_524, result.ProjectedArr);
        Assert.Equal(1946, result.Projected[0].Mrr); // 1497 × 1.3 = 1946.1 → 1946
    }

    [Fact]
    public void Forecast_growth_is_reported_to_one_decimal_place()
    {
        // 499 → 998 → 1497 → 1996: rates 1.0, 0.5, 0.333… → mean 0.6111…, capped to 0.3 → 30.0.
        // A mean that survives the cap is what exercises the /10 rounding, so use a gentler ramp:
        // 10 000 → 10 100 → 10 201 is +1% twice.
        var result = PlatformDashboardMrrUseCase.BuildMrrForecast(
            [
                new ActivePlanMonthCount("2026-06", "enterprise", 4),  //  9 996
                new ActivePlanMonthCount("2026-07", "starter", 1),     // 10 495  (+4.99%)
                new ActivePlanMonthCount("2026-08", "starter", 1),     // 10 994  (+4.75%)
            ],
            0,
            Now);

        // Both rates are under the cap, so the mean survives and lands on one decimal.
        Assert.Equal(4.9d, result.MonthlyGrowthPct);
    }

    // ── getMrrForecast: the trailing fields ─────────────────────────────────────────────────────────
    [Fact]
    public void Forecast_planBreakdown_counts_every_active_subscription_by_plan()
    {
        var result = PlatformDashboardMrrUseCase.BuildMrrForecast(
            [
                new ActivePlanMonthCount("2026-06", "starter", 2),
                new ActivePlanMonthCount("2026-08", "starter", 3),
                new ActivePlanMonthCount("2026-08", "enterprise", 1),
            ],
            0,
            Now);

        // The two starter months merge into ONE key — the breakdown is by plan, not by (plan, month).
        Assert.Equal(2, result.PlanBreakdown.Count);
        Assert.Equal(5, result.PlanBreakdown["starter"].Count);
        Assert.Equal(2495, result.PlanBreakdown["starter"].Mrr);
        Assert.Equal(1, result.PlanBreakdown["enterprise"].Count);
        // A plan with no active subscriber is ABSENT, not zero.
        Assert.False(result.PlanBreakdown.ContainsKey("professional"));
    }

    [Fact]
    public void Forecast_onEmpty_is_all_zeroes_and_an_empty_breakdown_object()
    {
        var result = PlatformDashboardMrrUseCase.BuildMrrForecast([], 0, Now);

        Assert.Equal(0, result.CurrentMrr);
        Assert.Equal(0, result.ProjectedMrr12m);
        Assert.Equal(0, result.ProjectedArr);
        Assert.Equal(0d, result.MonthlyGrowthPct);
        Assert.Empty(result.PlanBreakdown);
        Assert.Equal(0, result.PendingTrials);
        Assert.Equal(0, result.PotentialMrrFromTrials);
    }

    [Fact]
    public void Forecast_values_trials_at_the_starter_price()
    {
        var result = PlatformDashboardMrrUseCase.BuildMrrForecast([], 7, Now);

        Assert.Equal(7, result.PendingTrials);
        Assert.Equal(7 * 499, result.PotentialMrrFromTrials);
    }
}
