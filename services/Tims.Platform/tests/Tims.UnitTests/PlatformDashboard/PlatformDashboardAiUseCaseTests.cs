using Tims.Application.PlatformDashboard;

namespace Tims.UnitTests.PlatformDashboard;

/// <summary>
/// Unit coverage for <c>getAiCostAnomalies</c>' kernel (Phase-5 slice 23 / issue #81, the final read) —
/// the stub skip, the two INDEPENDENT anomaly branches, the JS truthiness of <c>monthlyBudget</c>, the
/// savings-descending stable sort, the scan-order total — and for <c>JsToFixed2</c>, whose whole reason
/// to exist is that <c>ToString("F2")</c> resolves the exact tie the other way.
/// </summary>
public sealed class PlatformDashboardAiUseCaseTests
{
    private static readonly Guid Agent1 = Guid.Parse("aa000000-0000-0000-0000-000000000001");
    private static readonly Guid Agent2 = Guid.Parse("aa000000-0000-0000-0000-000000000002");
    private static readonly Guid Org1 = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Org2 = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static EnabledAgentConfigRow Config(
        Guid? agentId = null,
        Guid? orgId = null,
        double? budget = null,
        double costPerCall = 0.05,
        string status = "active",
        string agentName = "CV Parser",
        string agentSlug = "cv-parser",
        string orgName = "Acme") =>
        new(agentId ?? Agent1, orgId ?? Org1, budget, agentName, agentSlug, costPerCall, status, orgName);

    private static AgentUsageRow Usage(Guid? agentId = null, Guid? orgId = null, double? cost = 0, int calls = 1) =>
        new(agentId ?? Agent1, orgId ?? Org1, cost, calls);

    // ── the kernel ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_stub_agent_is_skipped_entirely_even_with_zero_usage()
    {
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies(
            [Config(status: "stub", budget: 50)],
            []);

        Assert.Empty(result.Anomalies);
        Assert.Equal(0, result.TotalPotentialSavings);
    }

    [Fact]
    public void Any_non_stub_status_participates_not_just_active()
    {
        // The TS guard is `=== 'stub'`, not `!== 'active'` — a 'beta' agent with no usage anomalises.
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies([Config(status: "beta")], []);

        Assert.Single(result.Anomalies);
        Assert.Equal("zero_usage", result.Anomalies[0].Type);
    }

    [Fact]
    public void Zero_usage_emits_costPerCall_times_ten_with_the_constant_detail()
    {
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies([Config(costPerCall: 0.05)], []);

        var anomaly = Assert.Single(result.Anomalies);
        Assert.Equal("zero_usage", anomaly.Type);
        Assert.Equal("Enabled but 0 calls in 30 days", anomaly.Detail);
        Assert.Equal(0, anomaly.MonthlyCost);
        Assert.Null(anomaly.MonthlyBudget);
        Assert.Equal(0.5, anomaly.PotentialSavings);
        Assert.Equal(1, result.ZeroUsageCount);
        Assert.Equal(0, result.OverBudgetCount);
    }

    [Fact]
    public void Over_budget_emits_the_overage_and_the_toFixed_detail()
    {
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies(
            [Config(budget: 100)],
            [Usage(cost: 150.25, calls: 3)]);

        var anomaly = Assert.Single(result.Anomalies);
        Assert.Equal("over_budget", anomaly.Type);
        Assert.Equal("$150.25 spent vs $100.00 budget", anomaly.Detail);
        Assert.Equal(150.25, anomaly.MonthlyCost);
        Assert.Equal(100, anomaly.MonthlyBudget);
        Assert.Equal(50.25, anomaly.PotentialSavings);
    }

    [Fact]
    public void A_negative_budget_with_no_usage_yields_BOTH_anomalies_from_one_config()
    {
        // 0 > -5 holds and a negative number is JS-truthy, so the zero-usage AND over-budget branches
        // both fire — which is only possible because they are independent `if`s. Collapsing them to an
        // `else if` is the natural refactor this test exists to kill.
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies(
            [Config(budget: -5, costPerCall: 0.2)],
            []);

        Assert.Equal(2, result.Anomalies.Count);
        // Sorted by savings: the overage (5) outranks the estimated waste (2).
        Assert.Equal("over_budget", result.Anomalies[0].Type);
        Assert.Equal("$0.00 spent vs $-5.00 budget", result.Anomalies[0].Detail);
        Assert.Equal(5, result.Anomalies[0].PotentialSavings);
        Assert.Equal("zero_usage", result.Anomalies[1].Type);
        Assert.Equal(2, result.Anomalies[1].PotentialSavings);
        Assert.Equal(7, result.TotalPotentialSavings);
        Assert.Equal(1, result.ZeroUsageCount);
        Assert.Equal(1, result.OverBudgetCount);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0d)]
    public void A_null_or_zero_budget_is_never_exceeded_because_JS_truthiness_says_so(double? budget)
    {
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies(
            [Config(budget: budget)],
            [Usage(cost: 999.5, calls: 4)]);

        // Real spend, real calls — no zero-usage anomaly either, so the payload is empty.
        Assert.Empty(result.Anomalies);
    }

    [Fact]
    public void Usage_at_or_under_budget_is_no_anomaly()
    {
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies(
            [Config(budget: 100)],
            [Usage(cost: 100, calls: 2)]);

        // Strictly `>` — spending EXACTLY the budget is fine.
        Assert.Empty(result.Anomalies);
    }

    [Fact]
    public void A_usage_row_with_no_matching_config_contributes_nothing()
    {
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies(
            [Config(agentId: Agent1, orgId: Org1, budget: 100)],
            [Usage(agentId: Agent2, orgId: Org2, cost: 500, calls: 9), Usage(cost: 10, calls: 1)]);

        // Agent2@Org2's spend is unreachable from any config; Agent1@Org1 is under budget with calls.
        Assert.Empty(result.Anomalies);
    }

    [Fact]
    public void A_null_cost_sum_coalesces_to_zero_spend_but_its_calls_still_count()
    {
        // `_sum.costUsd ?? 0` — dead in production (a group always has rows), reproduced faithfully:
        // calls > 0 suppresses zero_usage, and a 0 spend exceeds no positive budget.
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies(
            [Config(budget: 100)],
            [Usage(cost: null, calls: 2)]);

        Assert.Empty(result.Anomalies);
    }

    [Fact]
    public void Ties_on_savings_keep_config_scan_order_and_the_sort_is_descending()
    {
        // Two zero-usage configs with the SAME costPerCall tie at 0.5; the third outranks both. JS
        // Array.prototype.sort is stable and so is OrderByDescending — scan order breaks the tie.
        var first = Config(agentId: Agent1, orgId: Org1, agentSlug: "first");
        var second = Config(agentId: Agent1, orgId: Org2, agentSlug: "second", orgName: "Globex");
        var big = Config(agentId: Agent2, orgId: Org1, agentSlug: "big", costPerCall: 1);

        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies([first, second, big], []);

        Assert.Equal(["big", "first", "second"], result.Anomalies.Select(a => a.AgentSlug).ToArray());
        Assert.Equal(11, result.TotalPotentialSavings); // 0.5 + 0.5 + 10
    }

    [Fact]
    public void The_detail_string_goes_through_JsToFixed2_not_F2()
    {
        // The exact-tie doubles are the only values where the two formatters disagree, so this is the
        // test that dies if the kernel is "simplified" to ToString("F2"): 0.125 spent against an 0.115
        // budget must read "$0.13 spent vs $0.12 budget" (0.115's expansion is 0.11500000000000000499…,
        // just above its half; 0.125 ties and rounds up) — F2 renders the first as "0.12".
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies(
            [Config(budget: 0.115)],
            [Usage(cost: 0.125, calls: 1)]);

        Assert.Equal("$0.13 spent vs $0.12 budget", result.Anomalies[0].Detail);
    }

    [Fact]
    public void The_total_accumulates_in_CONFIG_SCAN_order_not_sorted_order()
    {
        // Double addition is not associative, and TS accumulates totalPotentialSavings while SCANNING
        // configs — before the sort. Wastes 0.1 + 0.2 + 0.3 in scan order give 0.6000000000000001;
        // summing the sorted-DESC list (0.3 + 0.2 + 0.1) gives exactly 0.6 (verified in Node). A
        // refactor to `sorted.Sum(a => a.PotentialSavings)` produces the wrong wire value here.
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies(
            [
                Config(agentId: Agent1, orgId: Org1, costPerCall: 0.01),
                Config(agentId: Agent1, orgId: Org2, costPerCall: 0.02),
                Config(agentId: Agent2, orgId: Org1, costPerCall: 0.03),
            ],
            []);

        Assert.Equal(0.6000000000000001, result.TotalPotentialSavings);
        Assert.NotEqual(0.6, result.TotalPotentialSavings);
    }

    [Fact]
    public void OrgId_is_the_organization_guid_as_text()
    {
        var result = PlatformDashboardAiUseCase.BuildAiCostAnomalies([Config(orgId: Org2)], []);

        Assert.Equal(Org2.ToString(), result.Anomalies[0].OrgId);
    }

    // ── JsToFixed2 ───────────────────────────────────────────────────────────────────────────────────
    // Every expectation here is the OUTPUT OF NODE for `v.toFixed(2)`, captured 2026-08-16 — not a
    // decimal intuition. The three-way split the docblock describes is pinned by the first case:
    // 0.125 is an EXACT double, its expansion ties at the half, ECMAScript rounds the tie UP ("0.13"),
    // .NET "F2" rounds it to EVEN ("0.12"), and naive decimal reading agrees with neither in general.

    [Theory]
    [InlineData(0.125, "0.13")]   // exact tie → up; .NET "F2" says "0.12" — THE case this helper exists for
    [InlineData(-0.125, "-0.13")] // negative magnitude rounds away from zero, per spec
    [InlineData(1.005, "1.00")]   // the famous one: the double is 1.00499999999999989…, BELOW the half
    [InlineData(9.995, "9.99")]   // 9.99499999999999921… — below the half despite how it reads
    [InlineData(0.005, "0.01")]   // 0.00500000000000000010… — just ABOVE the half
    [InlineData(0.004999999999999999, "0.00")] // 0.00499999999999999924… — just BELOW; a rounded (non-exact) expansion misreads this one
    [InlineData(0.015, "0.01")]   // 0.01499999999999999944… — below
    [InlineData(2.675, "2.67")]   // 2.67499999999999982… — below
    [InlineData(0.999999999999, "1.00")]  // carry across the point
    [InlineData(99.999, "100.00")]        // carry into a longer integer part
    [InlineData(100, "100.00")]
    [InlineData(0, "0.00")]
    [InlineData(-5, "-5.00")]
    [InlineData(1234.5, "1234.50")]
    [InlineData(150.25, "150.25")]
    [InlineData(double.NaN, "NaN")]
    public void JsToFixed2_matches_Node(double value, string expected) =>
        Assert.Equal(expected, PlatformDashboardAiUseCase.JsToFixed2(value));

    [Fact]
    public void JsToFixed2_is_not_ToStringF2()
    {
        // The guard for the guard: if .NET formatting ever changed to half-up, the helper would become
        // dead weight and this test would say so. Today the two disagree on the exact tie.
        Assert.Equal("0.12", (0.125).ToString("F2", System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal("0.13", PlatformDashboardAiUseCase.JsToFixed2(0.125));
    }

    [Fact]
    public void Negative_zero_formats_as_positive_zero()
    {
        // JS: (-0).toFixed(2) === "0.00" — negative zero is not < 0.
        Assert.Equal("0.00", PlatformDashboardAiUseCase.JsToFixed2(-0d));
    }
}
