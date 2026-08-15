using System.Text.Json;
using Tims.Application.PlatformDashboard;

namespace Tims.UnitTests.PlatformDashboard;

/// <summary>
/// Unit coverage for <c>getCustomerHealth</c> and <c>getUpsellOpportunities</c> (Phase-5 slice 23 /
/// issue #81, PR 2 of 3) — the health bands and their precedence, the 999-day sentinel, the trial
/// countdown, and the upsell scoring thresholds including the floating-point active-user rule.
/// </summary>
public sealed class PlatformDashboardAccountsUseCaseTests
{
    private static readonly DateTime Now = new(2026, 8, 14, 12, 0, 0, DateTimeKind.Utc);

    private static CustomerHealthOrgRow Health(
        string id = "org-1",
        string? plan = "professional",
        string? status = "active",
        DateTime? trialEndsAt = null,
        int overdue = 0,
        int activeUsers = 10,
        int recentLogins = 10,
        DateTime? lastLoginAt = null) =>
        new(id, "Acme", plan, status, trialEndsAt, overdue, activeUsers, recentLogins, lastLoginAt ?? Now);

    private static UpsellOrgRow Upsell(
        string id = "org-1",
        string orgPlan = "starter",
        string? subPlan = "starter",
        string? status = "active",
        int totalUsers = 0,
        int activeRecent = 0,
        int features = 0,
        int vacancies = 0) =>
        new(id, "Acme", orgPlan, subPlan, status, totalUsers, activeRecent, features, vacancies);

    // ── getCustomerHealth: banding ──────────────────────────────────────────────────────────────────
    [Fact]
    public void Health_isCritical_when_any_invoice_is_overdue_even_with_perfect_logins()
    {
        var items = PlatformDashboardAccountsUseCase.BuildCustomerHealth([Health(overdue: 1)], Now);

        Assert.Equal("critical", items[0].Health);
        Assert.Equal(100, items[0].Signals.LoginRate); // the at_risk rules never get a look in
    }

    [Fact]
    public void Health_isCritical_at_exactly_fourteen_days_since_the_last_login()
    {
        var atBoundary = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(lastLoginAt: Now.AddDays(-14))], Now);
        var justInside = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(lastLoginAt: Now.AddDays(-14).AddMinutes(1))], Now);

        // `daysSinceLastLogin >= 14` — inclusive.
        Assert.Equal("critical", atBoundary[0].Health);
        Assert.Equal(14, atBoundary[0].Signals.DaysSinceLastLogin);
        Assert.Equal(13, justInside[0].Signals.DaysSinceLastLogin);
        Assert.Equal("healthy", justInside[0].Health);
    }

    [Fact]
    public void Health_withNoLoginEver_uses_the_999_sentinel_and_lands_critical()
    {
        // Constructed inline rather than through the Health() helper: that helper defaults a null
        // lastLoginAt to Now, which is exactly the value this test needs to be genuinely absent.
        var items = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [new CustomerHealthOrgRow("org-1", "Acme", "professional", "active", null, 0, 4, 0, null)], Now);

        // 999 is a real number on the wire, not a null — and it satisfies `>= 14`.
        Assert.Equal(999, items[0].Signals.DaysSinceLastLogin);
        Assert.Equal("critical", items[0].Health);
    }

    [Fact]
    public void Health_isAtRisk_below_a_thirty_percent_login_rate()
    {
        var atRisk = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(activeUsers: 10, recentLogins: 2)], Now);
        var healthy = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(activeUsers: 10, recentLogins: 3)], Now);

        Assert.Equal(20, atRisk[0].Signals.LoginRate);
        Assert.Equal("at_risk", atRisk[0].Health);
        // Exactly 30 is NOT at risk — the test is `< 30`.
        Assert.Equal(30, healthy[0].Signals.LoginRate);
        Assert.Equal("healthy", healthy[0].Health);
    }

    [Fact]
    public void Health_loginRate_uses_JS_rounding_on_an_exact_midpoint()
    {
        // 1 of 8 = 12.5% → 13 under JS Math.round, 12 under .NET's banker's default.
        var items = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(activeUsers: 8, recentLogins: 1)], Now);

        Assert.Equal(13, items[0].Signals.LoginRate);
    }

    [Fact]
    public void Health_withNoActiveUsers_reports_a_zero_rate_not_NaN()
    {
        var items = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(activeUsers: 0, recentLogins: 0)], Now);

        // 0/0 would be NaN, which serialises as null and breaks the number contract.
        Assert.Equal(0, items[0].Signals.LoginRate);
        Assert.Equal("at_risk", items[0].Health); // 0 < 30
    }

    // ── getCustomerHealth: the trial countdown ──────────────────────────────────────────────────────
    [Fact]
    public void Health_trialDaysLeft_isNull_unless_the_subscription_is_TRIALING()
    {
        var active = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(status: "active", trialEndsAt: Now.AddDays(3))], Now);
        var trialing = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(status: "trialing", trialEndsAt: Now.AddDays(3))], Now);

        // A trial end date on a non-trialing subscription is ignored entirely.
        Assert.Null(active[0].Signals.TrialDaysLeft);
        Assert.Equal("healthy", active[0].Health);
        Assert.Equal(3, trialing[0].Signals.TrialDaysLeft);
        Assert.Equal("at_risk", trialing[0].Health); // < 5 days left
    }

    [Fact]
    public void Health_trialDaysLeft_isNull_when_a_trialing_subscription_has_no_end_date()
    {
        var items = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(status: "trialing", trialEndsAt: null)], Now);

        Assert.Null(items[0].Signals.TrialDaysLeft);
        Assert.Equal("healthy", items[0].Health);
    }

    [Fact]
    public void Health_trialDaysLeft_goes_NEGATIVE_for_an_expired_trial_rather_than_clamping()
    {
        var items = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(status: "trialing", trialEndsAt: Now.AddDays(-3))], Now);

        Assert.Equal(-3, items[0].Signals.TrialDaysLeft);
        Assert.Equal("at_risk", items[0].Health);
    }

    [Fact]
    public void Health_trialDaysLeft_is_at_risk_below_five_and_healthy_at_five()
    {
        var four = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(status: "trialing", trialEndsAt: Now.AddDays(4))], Now);
        var five = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(status: "trialing", trialEndsAt: Now.AddDays(5))], Now);

        Assert.Equal("at_risk", four[0].Health);
        Assert.Equal("healthy", five[0].Health);
    }

    // ── getCustomerHealth: plan fallback, ordering, serialization ───────────────────────────────────
    [Fact]
    public void Health_withNoSubscription_reports_the_trial_plan()
    {
        var items = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [Health(plan: null, status: null)], Now);

        Assert.Equal("trial", items[0].Plan);
        Assert.Null(items[0].Signals.TrialDaysLeft);
    }

    [Fact]
    public void Health_orders_critical_then_atRisk_then_healthy_preserving_input_order_within_a_band()
    {
        var items = PlatformDashboardAccountsUseCase.BuildCustomerHealth(
            [
                Health("healthy-1"),
                Health("critical-1", overdue: 1),
                Health("at-risk-1", activeUsers: 10, recentLogins: 1),
                Health("healthy-2"),
                Health("critical-2", overdue: 2),
            ],
            Now);

        Assert.Equal(
            ["critical-1", "critical-2", "at-risk-1", "healthy-1", "healthy-2"],
            items.Select(i => i.OrgId));
    }

    [Fact]
    public void Health_serialises_trialDaysLeft_as_an_explicit_null_never_omitting_it()
    {
        var items = PlatformDashboardAccountsUseCase.BuildCustomerHealth([Health()], Now);
        var json = JsonDocument.Parse(JsonSerializer.Serialize(items[0], new JsonSerializerOptions(JsonSerializerDefaults.Web))).RootElement;

        // TS declares `let trialDaysLeft: number | null = null`, so the key is ALWAYS written.
        var signals = json.GetProperty("signals");
        Assert.Equal(JsonValueKind.Null, signals.GetProperty("trialDaysLeft").ValueKind);
        Assert.Equal(4, signals.EnumerateObject().Count());
        Assert.Equal(5, json.EnumerateObject().Count());
    }

    // ── getUpsellOpportunities: the thresholds ──────────────────────────────────────────────────────
    [Theory]
    [InlineData(8, 6)]
    [InlineData(20, 14)]
    [InlineData(3, 3)]
    public void ActiveUserThreshold_is_ceil_of_seventy_percent_including_the_floatingPoint_case(int minUsers, int expected)
    {
        // 3 × 0.7 is 2.0999999999999996 in IEEE-754, so the trial rule's threshold is 3, NOT the 2 a
        // decimal reading gives. 20 × 0.7 lands exactly on 14. Both stacks evaluate the same double
        // multiplication, so the expression is reproduced rather than the numbers tabulated.
        Assert.Equal(expected, PlatformDashboardAccountsUseCase.ActiveUserThreshold(minUsers));
    }

    [Fact]
    public void Upsell_skips_an_org_whose_subscription_is_neither_active_nor_trialing()
    {
        var result = PlatformDashboardAccountsUseCase.BuildUpsellOpportunities(
            [Upsell(status: "past_due", totalUsers: 100, features: 100, vacancies: 100)]);

        Assert.Empty(result.Opportunities);
    }

    [Fact]
    public void Upsell_skips_an_org_with_no_subscription_at_all()
    {
        var result = PlatformDashboardAccountsUseCase.BuildUpsellOpportunities(
            [Upsell(subPlan: null, status: null, totalUsers: 100, features: 100)]);

        Assert.Empty(result.Opportunities);
    }

    [Fact]
    public void Upsell_needs_at_least_forty_points()
    {
        // features alone = 30 → below the bar.
        Assert.Empty(PlatformDashboardAccountsUseCase.BuildUpsellOpportunities([Upsell(features: 5)]).Opportunities);
        // features + vacancies = 40 → exactly at the bar, and 'low' confidence.
        var justEnough = PlatformDashboardAccountsUseCase.BuildUpsellOpportunities([Upsell(features: 5, vacancies: 3)]);
        Assert.Equal("low", justEnough.Opportunities[0].Confidence);
        // reasons[0] is the FIRST satisfied condition in condition order — features, not vacancies.
        Assert.Equal("5 features adopted (threshold: 5)", justEnough.Opportunities[0].Reason);
    }

    /// <summary>
    /// The score → confidence bands, with the expected band written out per row rather than recomputed
    /// from the same rule the code applies. Points: users 40, features 30, active-in-7d 20, vacancies 10;
    /// bands ≥70 high, ≥50 medium, ≥40 low, below 40 not emitted at all. Thresholds for the starter rule
    /// are 8 users / 5 features / 6 active (ceil(8 × 0.7)) / 3 vacancies.
    /// </summary>
    [Theory]
    [InlineData(8, 0, 0, 0, 40, "low")]
    [InlineData(0, 5, 0, 3, 40, "low")]
    [InlineData(0, 5, 6, 0, 50, "medium")]
    [InlineData(8, 0, 6, 0, 60, "medium")]
    [InlineData(8, 5, 0, 0, 70, "high")]
    [InlineData(8, 0, 6, 3, 70, "high")]
    [InlineData(8, 5, 6, 3, 100, "high")]
    public void Upsell_confidence_bands_follow_the_score(
        int users,
        int features,
        int active,
        int vacancies,
        int documentedScore,
        string expectedConfidence)
    {
        var result = PlatformDashboardAccountsUseCase.BuildUpsellOpportunities(
            [Upsell(totalUsers: users, features: features, activeRecent: active, vacancies: vacancies)]);

        Assert.Equal(expectedConfidence, Assert.Single(result.Opportunities).Confidence);

        // The score column is documentation, kept honest by checking it against the band boundaries it
        // claims to sit in — it never touches the code under test.
        Assert.True(documentedScore >= 40);
        Assert.Equal(expectedConfidence, documentedScore >= 70 ? "high" : documentedScore >= 50 ? "medium" : "low");
    }

    [Theory]
    [InlineData(7, 0, 0, 0)]  // 7 users is below the threshold: 0 points
    [InlineData(0, 4, 5, 2)]  // nothing clears its bar
    [InlineData(0, 0, 6, 3)]  // active + vacancies = 30, under the 40 floor
    public void Upsell_emits_nothing_below_forty_points(int users, int features, int active, int vacancies) =>
        Assert.Empty(PlatformDashboardAccountsUseCase.BuildUpsellOpportunities(
            [Upsell(totalUsers: users, features: features, activeRecent: active, vacancies: vacancies)]).Opportunities);

    [Fact]
    public void Upsell_reason_strings_carry_the_measured_value_and_the_threshold()
    {
        var result = PlatformDashboardAccountsUseCase.BuildUpsellOpportunities(
            [Upsell(totalUsers: 12, features: 7, activeRecent: 9, vacancies: 4)]);

        var opportunity = Assert.Single(result.Opportunities);
        Assert.Equal("12 users (threshold: 8)", opportunity.Reason);
        Assert.Equal("professional", opportunity.TargetPlan);
        Assert.Equal("starter", opportunity.CurrentPlan);
        Assert.Equal(500, opportunity.MrrIncrease); // 999 − 499
        Assert.Equal(new UpsellSignals(9, 12, 7, 4), opportunity.Signals);
    }

    [Theory]
    [InlineData("starter", "professional", 500)]
    [InlineData("professional", "enterprise", 1500)]
    [InlineData("trial", "starter", 499)]
    public void Upsell_rules_target_the_next_plan_up_at_the_price_difference(string current, string target, int increase)
    {
        var result = PlatformDashboardAccountsUseCase.BuildUpsellOpportunities(
            [Upsell(orgPlan: current, subPlan: current, totalUsers: 100, features: 100, activeRecent: 100, vacancies: 100)]);

        var opportunity = Assert.Single(result.Opportunities);
        Assert.Equal(target, opportunity.TargetPlan);
        Assert.Equal(increase, opportunity.MrrIncrease);
    }

    /// <summary>
    /// The SUBSCRIPTION plan wins over the ORGANIZATION plan when the two disagree.
    ///
    /// <para>Added because the panel found the precedence entirely unpinned: every fixture organization
    /// carries an <c>organizations.plan</c> equal to its own subscription's, and every unit row used the
    /// equal defaults — so reversing the operands to <c>OrgPlan ?? SubscriptionPlan</c> was a
    /// green-suite change. The drift is reachable in production: <c>platform/organizations.ts:269</c>
    /// updates <c>organizations.plan</c> without touching <c>subscriptions.plan</c>.</para>
    ///
    /// <para>Reversed operands would score this org against the professional→enterprise rule (20 users,
    /// 8 features) instead of starter→professional (8 users, 5 features), so it would emit NOTHING —
    /// which is why the assertion checks both the plan AND that an opportunity exists at all.</para>
    /// </summary>
    [Fact]
    public void Upsell_prefers_the_SUBSCRIPTION_plan_over_the_organization_plan_when_they_differ()
    {
        var result = PlatformDashboardAccountsUseCase.BuildUpsellOpportunities(
            [Upsell(orgPlan: "professional", subPlan: "starter", totalUsers: 12, features: 7, activeRecent: 9, vacancies: 4)]);

        var opportunity = Assert.Single(result.Opportunities);
        Assert.Equal("starter", opportunity.CurrentPlan);
        Assert.Equal("professional", opportunity.TargetPlan);
        Assert.Equal(500, opportunity.MrrIncrease);
    }

    [Fact]
    public void Upsell_falls_back_to_the_ORG_plan_when_the_subscription_carries_none()
    {
        // `org.subscription?.plan ?? org.plan ?? 'trial'` — a trialing subscription row whose own plan is
        // absent still scores against the organization's plan.
        var result = PlatformDashboardAccountsUseCase.BuildUpsellOpportunities(
            [Upsell(orgPlan: "trial", subPlan: null, status: "trialing", totalUsers: 5, activeRecent: 3)]);

        var opportunity = Assert.Single(result.Opportunities);
        Assert.Equal("trial", opportunity.CurrentPlan);
        Assert.Equal("starter", opportunity.TargetPlan);
    }

    [Fact]
    public void Upsell_sorts_by_mrrIncrease_descending_and_totals_only_high_and_medium()
    {
        var result = PlatformDashboardAccountsUseCase.BuildUpsellOpportunities(
            [
                Upsell("a", "starter", "starter", totalUsers: 8),                      // +500, low
                Upsell("b", "professional", "professional", totalUsers: 20),            // +1500, low
                Upsell("c", "trial", "trial", status: "trialing", totalUsers: 3, features: 2, activeRecent: 3), // +499, high
            ]);

        Assert.Equal(["b", "a", "c"], result.Opportunities.Select(o => o.OrgId));
        Assert.Equal(500 + 1500 + 499, result.TotalPotentialMrr);
        Assert.Equal(1, result.HighConfidence);
        Assert.Equal(0, result.MediumConfidence);
        // Two 'low' opportunities are counted in NEITHER band — the totals deliberately do not
        // reconcile with Opportunities.Count, matching TS.
        Assert.Equal(3, result.Opportunities.Count);
    }

    [Fact]
    public void Upsell_onEmpty_is_an_empty_list_with_zero_totals()
    {
        var result = PlatformDashboardAccountsUseCase.BuildUpsellOpportunities([]);

        Assert.Empty(result.Opportunities);
        Assert.Equal(0, result.TotalPotentialMrr);
        Assert.Equal(0, result.HighConfidence);
        Assert.Equal(0, result.MediumConfidence);
    }
}
