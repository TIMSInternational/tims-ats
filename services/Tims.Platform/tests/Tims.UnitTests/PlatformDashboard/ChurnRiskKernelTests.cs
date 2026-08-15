using Tims.Application.PlatformDashboard;

namespace Tims.UnitTests.PlatformDashboard;

/// <summary>
/// Unit coverage for the pure <c>getChurnRisk</c> scoring kernel (Phase-5 slice 23 / issue #81, PR 3 of 3)
/// — the five signals and every band boundary, the risk STRINGS byte-for-byte, the two different
/// pluralization rules, the 999-day sentinel's asymmetry between scoring and the wire, and the summary.
/// </summary>
public sealed class ChurnRiskKernelTests
{
    private static readonly DateTime Now = new(2026, 8, 14, 12, 0, 0, DateTimeKind.Utc);

    private static ChurnOrgConverted Org(
        string id = "org-1",
        string name = "Acme",
        string? plan = "professional",
        string? status = "active",
        DateTime? trialEndsAt = null,
        int overdueCount = 0,
        double overdueAmount = 0,
        bool overdueConverted = false,
        int activeUsers = 10,
        int recentLogins = 10,
        DateTime? lastLoginAt = null,
        // A separate flag rather than `lastLoginAt: null`, because the default IS null and the `??` below
        // would swallow it — the never-logged-in case would silently become "logged in just now" and the
        // sentinel test would assert nothing. The first draft of this helper did exactly that.
        bool neverLoggedIn = false,
        int featureCount = 8,
        int ageDays = 400)
    {
        var invoices = Enumerable.Range(0, overdueCount)
            .Select(_ => new DashboardMoneyRow(1, "USD"))
            .ToList();

        return new ChurnOrgConverted(
            new ChurnOrgRow(
                id,
                name,
                Now.AddDays(-ageDays),
                plan,
                status,
                trialEndsAt,
                invoices,
                activeUsers,
                recentLogins,
                neverLoggedIn ? null : lastLoginAt ?? Now,
                featureCount),
            overdueAmount,
            overdueConverted);
    }

    private static ChurnRiskOrganization Single(ChurnOrgConverted org) =>
        ChurnRiskKernel.Build([org], Now).Organizations[0];

    // ── the whole shape, on one deliberately messy organization ──────────────────────────────────────

    [Fact]
    public void A_struggling_organization_scores_and_describes_itself_exactly()
    {
        var row = Single(Org(
            overdueCount: 1,
            overdueAmount: 1234.5,
            activeUsers: 4,
            recentLogins: 1,
            lastLoginAt: Now.AddDays(-10),
            featureCount: 2,
            ageDays: 100));

        // login 0.25×30 → 8 (JS half-up, not banker's); invoice 1 → 10; recency 10d → 6; adoption 2 → 4;
        // tenure 100d → 8.
        Assert.Equal(new ChurnRiskSignals(8, 10, 6, 4, 8), row.Signals);
        Assert.Equal(36, row.HealthScore);
        Assert.Equal("red", row.Tier);

        // The wire carries the PERCENTAGE, while the scoring used the fraction.
        Assert.Equal(25, row.LoginRate);
        Assert.Equal(10, row.DaysSinceLastLogin);

        Assert.Equal(
            [
                "1 overdue invoice (USD 1,234.5)",
                "Last login 10 days ago",
                "Only 25% login rate (1/4 users)",
                "Only 2 features adopted",
            ],
            row.Risks);
        Assert.Equal(["send_dunning", "check_in", "adoption_call", "onboarding_session"], row.Actions);

        // primaryRisk is risks[0] — the first condition in SOURCE order, not the most damaging one.
        Assert.Equal("1 overdue invoice (USD 1,234.5)", row.PrimaryRisk);
    }

    [Fact]
    public void A_healthy_organization_reports_the_Healthy_placeholder_and_no_actions()
    {
        var row = Single(Org());

        Assert.Equal(100, row.HealthScore);
        Assert.Equal("green", row.Tier);
        Assert.Empty(row.Risks);
        Assert.Empty(row.Actions);
        Assert.Equal("Healthy", row.PrimaryRisk);
    }

    // ── signal boundaries ────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, 25)]
    [InlineData(1, 10)]
    [InlineData(2, 0)]
    [InlineData(3, 0)]
    public void The_invoice_signal_scores_the_COUNT_not_the_amount(int overdueCount, int expected)
    {
        Assert.Equal(expected, Single(Org(overdueCount: overdueCount, overdueAmount: 1_000_000)).Signals.InvoiceScore);
    }

    [Theory]
    [InlineData(0, 20)]
    [InlineData(1, 20)]
    [InlineData(2, 16)]
    [InlineData(3, 16)]
    [InlineData(4, 12)]
    [InlineData(7, 12)]
    [InlineData(8, 6)]
    [InlineData(14, 6)]
    [InlineData(15, 0)]
    public void The_recency_signal_bands_are_inclusive_at_the_top(int daysAgo, int expected)
    {
        Assert.Equal(expected, Single(Org(lastLoginAt: Now.AddDays(-daysAgo))).Signals.RecencyScore);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 4)]
    [InlineData(3, 8)]
    [InlineData(5, 12)]
    [InlineData(8, 15)]
    [InlineData(50, 15)]
    public void The_adoption_signal_bands_on_the_feature_count(int features, int expected)
    {
        Assert.Equal(expected, Single(Org(featureCount: features)).Signals.AdoptionScore);
    }

    [Theory]
    [InlineData(0, 2)]
    [InlineData(29, 2)]
    [InlineData(30, 5)]
    [InlineData(90, 8)]
    [InlineData(180, 10)]
    public void The_tenure_signal_never_scores_zero(int ageDays, int expected)
    {
        // The floor is 2, not 0 — a brand-new organization is not treated as having no tenure at all.
        Assert.Equal(expected, Single(Org(ageDays: ageDays)).Signals.TenureScore);
    }

    [Fact]
    public void An_organization_with_no_active_users_scores_a_zero_login_rate_rather_than_NaN()
    {
        var row = Single(Org(activeUsers: 0, recentLogins: 0));

        Assert.Equal(0, row.Signals.LoginScore);
        Assert.Equal(0, row.LoginRate);

        // totalUsers > 1 guards the adoption risk, so a zero-user tenant does not emit one.
        Assert.DoesNotContain(row.Risks, r => r.Contains("login rate", StringComparison.Ordinal));
    }

    [Fact]
    public void The_never_logged_in_sentinel_scores_as_999_but_reports_as_null()
    {
        var row = Single(Org(neverLoggedIn: true, activeUsers: 3, recentLogins: 0));

        Assert.Null(row.DaysSinceLastLogin);
        Assert.Equal(0, row.Signals.RecencyScore);
        Assert.Contains("No login in 999 days", row.Risks);
    }

    // ── the two pluralization rules, which are deliberately different ────────────────────────────────

    [Fact]
    public void The_invoice_risk_pluralizes_on_MORE_THAN_ONE()
    {
        Assert.Equal("1 overdue invoice (USD 0)", Single(Org(overdueCount: 1)).Risks[0]);
        Assert.Equal("2 overdue invoices (USD 0)", Single(Org(overdueCount: 2)).Risks[0]);
    }

    [Theory]
    [InlineData(1, "Trial expires in 1 day")]
    [InlineData(2, "Trial expires in 2 days")]
    [InlineData(7, "Trial expires in 7 days")]
    public void The_trial_risk_pluralizes_on_NOT_EXACTLY_ONE(int daysLeft, string expected)
    {
        var row = Single(Org(status: "trialing", trialEndsAt: Now.AddDays(daysLeft)));

        Assert.Contains(expected, row.Risks);
        Assert.Contains("conversion_call", row.Actions);
    }

    [Fact]
    public void An_already_expired_trial_reports_a_NEGATIVE_countdown_rather_than_being_clamped()
    {
        // Math.ceil of a negative remainder rounds TOWARD ZERO, and the `<= 7` guard still passes — so a
        // long-dead trial keeps emitting a risk, with a plural "days". Reproduced, not corrected.
        var row = Single(Org(status: "trialing", trialEndsAt: Now.AddDays(-40)));

        Assert.Contains("Trial expires in -40 days", row.Risks);
    }

    [Fact]
    public void A_trial_further_out_than_a_week_emits_no_risk_at_all()
    {
        var row = Single(Org(status: "trialing", trialEndsAt: Now.AddDays(8)));

        Assert.DoesNotContain(row.Risks, r => r.Contains("Trial", StringComparison.Ordinal));
    }

    [Fact]
    public void A_trialing_subscription_with_no_end_date_emits_no_trial_risk()
    {
        Assert.DoesNotContain(Single(Org(status: "trialing", trialEndsAt: null)).Risks, r => r.Contains("Trial", StringComparison.Ordinal));
    }

    [Fact]
    public void Only_a_TRIALING_subscription_gets_a_countdown_however_close_its_end_date()
    {
        // trial_ends_at is populated on a converted subscription too; the status is what gates the risk.
        Assert.DoesNotContain(
            Single(Org(status: "active", trialEndsAt: Now.AddDays(1))).Risks,
            r => r.Contains("Trial", StringComparison.Ordinal));
    }

    // ── the overdue amount reaches the wire as TEXT as well as a number ──────────────────────────────

    [Fact]
    public void The_converted_overdue_total_is_grouped_into_the_risk_description()
    {
        var row = Single(Org(overdueCount: 2, overdueAmount: 1234567.891, overdueConverted: true));

        // `toLocaleString()` with no locale — comma groups, dot decimal, at most three fraction digits.
        // The deployed Node process's default ICU locale is therefore part of this string on the wire.
        Assert.Equal("2 overdue invoices (USD 1,234,567.891)", row.Risks[0]);
        Assert.Equal(1234567.891, row.OverdueAmount);
        Assert.True(row.OverdueAmountConverted);
        Assert.Equal("USD", row.Currency);
    }

    // ── login-rate risk boundary ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_login_rate_risk_fires_strictly_BELOW_thirty_percent()
    {
        // 3/10 = 0.3 exactly → NOT below the threshold.
        Assert.DoesNotContain(
            Single(Org(activeUsers: 10, recentLogins: 3)).Risks,
            r => r.Contains("login rate", StringComparison.Ordinal));

        Assert.Contains(
            "Only 20% login rate (2/10 users)",
            Single(Org(activeUsers: 10, recentLogins: 2)).Risks);
    }

    [Fact]
    public void A_single_user_organization_never_emits_the_login_rate_risk()
    {
        // One dormant user is a 0% rate, which would flag every solo tenant — hence `totalUsers > 1`.
        var row = Single(Org(activeUsers: 1, recentLogins: 0));

        Assert.Equal(0, row.LoginRate);
        Assert.DoesNotContain(row.Risks, r => r.Contains("login rate", StringComparison.Ordinal));
    }

    // ── ordering and the summary ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Organizations_are_ordered_worst_health_FIRST()
    {
        var result = ChurnRiskKernel.Build(
            [
                Org(id: "healthy"),
                Org(id: "dying", overdueCount: 2, activeUsers: 4, recentLogins: 0, lastLoginAt: Now.AddDays(-60), featureCount: 0, ageDays: 1),
                Org(id: "middling", featureCount: 3, lastLoginAt: Now.AddDays(-5)),
            ],
            Now);

        Assert.Equal(["dying", "middling", "healthy"], result.Organizations.Select(o => o.OrgId));
    }

    [Fact]
    public void The_summary_counts_every_band_and_sums_at_risk_MRR_over_RED_ONLY()
    {
        var result = ChurnRiskKernel.Build(
            [
                Org(id: "green-1"),
                Org(id: "yellow-1", featureCount: 0, lastLoginAt: Now.AddDays(-10), activeUsers: 1, recentLogins: 0),
                Org(id: "red-1", plan: "enterprise", overdueCount: 2, featureCount: 0, lastLoginAt: Now.AddDays(-60), ageDays: 1, activeUsers: 1, recentLogins: 0),
                Org(id: "red-2", plan: "starter", status: "trialing", overdueCount: 2, featureCount: 0, lastLoginAt: Now.AddDays(-60), ageDays: 1, activeUsers: 1, recentLogins: 0),
            ],
            Now);

        Assert.Equal(1, result.Summary.Green);
        Assert.Equal(1, result.Summary.Yellow);
        Assert.Equal(2, result.Summary.Red);
        Assert.Equal(4, result.Summary.Total);

        // red-1 is an ACTIVE enterprise (2499); red-2 is TRIALING, so its plan price does not count.
        Assert.Equal(2499, result.Summary.AtRiskMrr);
    }

    [Theory]
    [InlineData(70, "green")]
    [InlineData(69, "yellow")]
    [InlineData(40, "yellow")]
    [InlineData(39, "red")]
    public void The_tier_bands_are_inclusive_at_the_bottom(int expectedScore, string expectedTier)
    {
        // Each case is built to land EXACTLY on the score named in the InlineData, and the score is
        // asserted alongside the tier — otherwise the boundary claim is decorative and a case that happens
        // to score 48 would still "prove" the 40 band. (The first draft of this test did exactly that.)
        var org = expectedScore switch
        {
            // 30 login (10/10) + 25 invoice (none overdue) + 6 recency (8d) + 4 adoption (1) + 5 tenure (30d)
            70 => Org(featureCount: 1, lastLoginAt: Now.AddDays(-8), ageDays: 30),

            // one point below: 30 login + 25 invoice + 12 recency (5d) + 0 adoption (no flags) + 2 tenure
            69 => Org(featureCount: 0, lastLoginAt: Now.AddDays(-5), ageDays: 1),

            // 18 login (6/10 → 0.6×30) + 10 invoice (exactly one overdue) + 6 recency + 4 adoption + 2 tenure
            40 => Org(overdueCount: 1, activeUsers: 10, recentLogins: 6, featureCount: 1, lastLoginAt: Now.AddDays(-8), ageDays: 1),

            // 17 login (17/30 → 0.5667×30) and otherwise identical — one point below the yellow floor
            _ => Org(overdueCount: 1, activeUsers: 30, recentLogins: 17, featureCount: 1, lastLoginAt: Now.AddDays(-8), ageDays: 1),
        };

        var row = Single(org);
        Assert.Equal(expectedScore, row.HealthScore);
        Assert.Equal(expectedTier, row.Tier);
    }
}
