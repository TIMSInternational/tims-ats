using System.Text.Json;
using Tims.Application.Billing;
using Tims.Infrastructure.Billing;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Phase-5 Slice 3b Testcontainers proof (real RLS, NEVER mocked) of the billing usage/plan reads, every
/// count UNDER TenantScope (app_tenant + org GUC). Proves: the real org-scoped counts with the exact TS
/// predicates (active employees; not-deleted vacancies with status ∉ {closed,cancelled}; assessment
/// assignments gated to assignedAt ≥ currentPeriodStart); the entitled-plan limits incl. the load-bearing
/// CANCELLED-sub → trial fallback (OrgB); tenant isolation (OrgA counts never include OrgB rows and vice
/// versa); getCurrentPlan's raw full-subscription row and its top-level null for an org with no subscription.
/// </summary>
[Collection("BillingRead")]
public sealed class BillingUsageTests(BillingReadFixture fixture)
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly BillingReadFixture _fixture = fixture;

    private BillingUsageUseCase UseCase() =>
        new(new BillingReadRepository(_fixture.NewReadContext()));

    private static string Org(Guid id) => id.ToString();

    // ---- getUsage: OrgA active professional — real counts, professional limits, period echoed ------
    [Fact]
    public async Task GetUsage_OrgA_realCounts_professionalLimits()
    {
        var usage = await UseCase().GetUsageAsync(Org(BillingReadFixture.OrgA), CancellationToken.None);

        Assert.Equal(BillingReadFixture.OrgAEmployees, usage.Employees.Used); // active-only (inactive excluded)
        Assert.Equal(100, usage.Employees.Limit);
        Assert.Equal(BillingReadFixture.OrgAVacancies, usage.Vacancies.Used); // closed/cancelled/soft-deleted excluded
        Assert.Equal(50, usage.Vacancies.Limit);
        Assert.Equal(BillingReadFixture.OrgAAssessments, usage.Assessments.Used); // pre-period assignment excluded
        Assert.Equal(2000, usage.Assessments.Limit);

        // storage/apiCalls have no metering source → always null (honest).
        Assert.Null(usage.Storage.UsedMb);
        Assert.Null(usage.Storage.LimitMb);
        Assert.Null(usage.ApiCalls.Used);
        Assert.Null(usage.ApiCalls.Limit);

        Assert.Equal(new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), usage.PeriodStart);
        Assert.Equal(new DateTimeOffset(2026, 7, 1, 0, 0, 0, TimeSpan.Zero), usage.PeriodEnd);

        // Wire pin: storage/apiCalls keys present with null values; period as canonical …fffZ.
        var wire = JsonSerializer.SerializeToNode(usage, WireOptions)!.AsObject();
        Assert.True(wire.ContainsKey("storage") && wire.ContainsKey("apiCalls"));
        Assert.Equal("2026-06-01T00:00:00.000Z", wire["periodStart"]!.GetValue<string>());
    }

    // ---- getUsage: OrgB CANCELLED enterprise → trial limits (NOT unlimited), own counts --------------
    [Fact]
    public async Task GetUsage_OrgB_cancelledEnterprise_fallsBackToTrialLimits()
    {
        var usage = await UseCase().GetUsageAsync(Org(BillingReadFixture.OrgB), CancellationToken.None);

        // The load-bearing invariant: a cancelled sub loses paid entitlement → trial limits (5/3/20).
        Assert.Equal(5, usage.Employees.Limit);
        Assert.Equal(3, usage.Vacancies.Limit);
        Assert.Equal(20, usage.Assessments.Limit);

        // OrgB's OWN counts — proves cross-org isolation (OrgA's larger counts never bleed in).
        Assert.Equal(BillingReadFixture.OrgBEmployees, usage.Employees.Used);
        Assert.Equal(BillingReadFixture.OrgBVacancies, usage.Vacancies.Used);
        Assert.Equal(BillingReadFixture.OrgBAssessments, usage.Assessments.Used);
    }

    // ---- getUsage: an org with NO subscription → trial limits, null period, all-time (zero) counts ---
    [Fact]
    public async Task GetUsage_orgWithoutSubscription_trialLimits_nullPeriod()
    {
        var usage = await UseCase().GetUsageAsync(Guid.NewGuid().ToString(), CancellationToken.None);

        Assert.Equal(5, usage.Employees.Limit);
        Assert.Equal(0, usage.Employees.Used);
        Assert.Equal(0, usage.Vacancies.Used);
        Assert.Equal(0, usage.Assessments.Used);
        Assert.Null(usage.PeriodStart);
        Assert.Null(usage.PeriodEnd);
    }

    // ---- getUsage: no subscription but WITH rows → all-time count (the no-period branch counts every
    // assignment, incl. one from 2020, not just an empty org) -----------------------------------------
    [Fact]
    public async Task GetUsage_noSubscription_withRows_countsAllTime()
    {
        var usage = await UseCase().GetUsageAsync(Org(BillingReadFixture.OrgC), CancellationToken.None);

        // OrgC has 2 assignments (2020 + 2026) and no subscription → periodStart null → NO date gate →
        // both counted. A regression that wrongly kept a period filter here would drop the 2020 row.
        Assert.Equal(BillingReadFixture.OrgCAssessments, usage.Assessments.Used);
        Assert.Null(usage.PeriodStart);
        Assert.Equal(20, usage.Assessments.Limit); // trial (no subscription)
    }

    // ---- getCurrentPlan: OrgA raw full subscription row -----------------------------------------------
    [Fact]
    public async Task GetCurrentPlan_OrgA_returnsFullSubscriptionRow()
    {
        var plan = await UseCase().GetCurrentPlanAsync(Org(BillingReadFixture.OrgA), CancellationToken.None);

        Assert.NotNull(plan);
        Assert.Equal(BillingReadFixture.SubscriptionA.ToString(), plan!.Id);
        Assert.Equal("professional", plan.Plan); // native OrgPlan enum → string
        Assert.Equal("active", plan.Status);
        Assert.Equal("cus_A", plan.StripeCustomerId);
        Assert.Equal(new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), plan.CurrentPeriodStart);
        Assert.Null(plan.CancelledAt);
    }

    // ---- getCurrentPlan: an org with NO subscription → top-level null (findUnique parity) ------------
    [Fact]
    public async Task GetCurrentPlan_orgWithoutSubscription_isNull()
    {
        var plan = await UseCase().GetCurrentPlanAsync(Guid.NewGuid().ToString(), CancellationToken.None);
        Assert.Null(plan);
    }

    // ---- getBillingConfig: pure predicate over the deploy's Stripe config ---------------------------
    [Fact]
    public void GetBillingConfig_reflectsPresence()
    {
        Assert.True(BillingUsageUseCase.GetBillingConfig("sk", "price_s", "price_p").Configured);
        Assert.False(BillingUsageUseCase.GetBillingConfig(null, "price_s", "price_p").Configured);
        Assert.False(BillingUsageUseCase.GetBillingConfig("sk", "", "price_p").Configured);
    }
}
