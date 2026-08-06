using Microsoft.EntityFrameworkCore;
using Tims.Application.AlertMetrics;
using Tims.Domain.AlertMetrics;
using Tims.Infrastructure;
using Tims.Infrastructure.AlertMetrics;

namespace Tims.IntegrationTests.AlertMetrics;

/// <summary>
/// Proves the RLS posture of the cross-org reader against REAL Postgres (no mocks): that it genuinely reads
/// across orgs despite <c>FORCE ROW LEVEL SECURITY</c>, and — the half that stops the first half being a
/// false positive — that RLS on those same tables is genuinely ENGAGED for a tenant-scoped caller on the
/// SAME connection.
/// </summary>
[Collection("AlertMetrics")]
public sealed class AlertMetricsCrossOrgRlsTests(AlertMetricsFixture fixture)
{
    private readonly AlertMetricsFixture _fixture = fixture;

    private AlertMetricsReadUseCase NewUseCase(AlertMetricsDbContext db) =>
        new(new AlertMetricsReadRepository(db));

    [Fact]
    public async Task Privileged_context_reads_EVERY_org_despite_FORCE_RLS()
    {
        await using var db = _fixture.NewContext();
        var useCase = NewUseCase(db);

        var orgA = await useCase.ComputeAsync(AlertMetricsFixture.OrgA, AlertMetric.ActiveSurveys, CancellationToken.None);
        var orgB = await useCase.ComputeAsync(AlertMetricsFixture.OrgB, AlertMetric.ActiveSurveys, CancellationToken.None);

        Assert.Equal(new AlertMetricOutcome.Value(AlertMetricsFixture.OrgAActiveSurveys), orgA);
        Assert.Equal(new AlertMetricOutcome.Value(AlertMetricsFixture.OrgBActiveSurveys), orgB);
    }

    [Fact]
    public async Task RLS_is_actually_ENGAGED_on_these_tables_for_a_tenant_scoped_caller()
    {
        // Same physical tables, same connection string — the ONLY difference is TenantScope's
        // `SET LOCAL ROLE app_tenant` + org GUC. Under it, OrgB's rows are invisible while scoped to OrgA.
        // Without this test, "privileged sees both orgs" above would be consistent with RLS simply being
        // off, and would prove nothing about the surface being a deliberate bypass.
        await using var db = _fixture.NewContext();
        await using var scope = await TenantScope.BeginAsync(db, AlertMetricsFixture.OrgA, CancellationToken.None);

        var visibleOrgs = await db.Surveys.AsNoTracking()
            .Select(s => s.OrganizationId).Distinct().ToListAsync();

        Assert.Equal([AlertMetricsFixture.OrgA], visibleOrgs);
    }

    [Fact]
    public async Task Tenant_scoped_caller_with_NO_org_GUC_sees_nothing_fail_closed()
    {
        await using var db = _fixture.NewContext();
        await using var scope = await TenantScope.BeginAsync(db, organizationId: null, CancellationToken.None);

        Assert.Empty(await db.Surveys.AsNoTracking().ToListAsync());
        Assert.Empty(await db.SalaryAdjustments.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task Status_filter_matches_the_TS_query_draft_and_approved_are_excluded()
    {
        await using var db = _fixture.NewContext();
        var useCase = NewUseCase(db);

        // OrgA has 3 surveys (2 active + 1 draft) and 6 adjustments (5 pending + 1 approved).
        var surveys = await useCase.ComputeAsync(AlertMetricsFixture.OrgA, AlertMetric.ActiveSurveys, CancellationToken.None);
        var adjustments = await useCase.ComputeAsync(AlertMetricsFixture.OrgA, AlertMetric.PendingSalaryAdjustments, CancellationToken.None);

        Assert.Equal(new AlertMetricOutcome.Value(2), surveys);
        Assert.Equal(new AlertMetricOutcome.Value(5), adjustments);
    }

    [Fact]
    public async Task Sensitive_metric_sub_floor_count_is_SUPPRESSED_not_returned()
    {
        // OrgB has 3 pending adjustments — a 1..4 count over a §21-restricted model. An alert rule is an
        // exact-count oracle, so this must leave the service with NO number attached.
        await using var db = _fixture.NewContext();
        var useCase = NewUseCase(db);

        var outcome = await useCase.ComputeAsync(
            AlertMetricsFixture.OrgB, AlertMetric.PendingSalaryAdjustments, CancellationToken.None);

        Assert.IsType<AlertMetricOutcome.Suppressed>(outcome);
    }

    [Fact]
    public async Task Empty_org_returns_ZERO_not_suppressed_and_not_an_error()
    {
        // "Ask what your check prints against an EMPTY database." A 0 count reveals no individual, so it
        // passes the min-5 floor unchanged and must arrive as a real value the cron can compare — an org
        // with no rows is a legitimate 0, not an absence of data.
        await using var db = _fixture.NewContext();
        var useCase = NewUseCase(db);

        Assert.Equal(
            new AlertMetricOutcome.Value(0),
            await useCase.ComputeAsync(AlertMetricsFixture.OrgWithNoRows, AlertMetric.ActiveSurveys, CancellationToken.None));
        Assert.Equal(
            new AlertMetricOutcome.Value(0),
            await useCase.ComputeAsync(AlertMetricsFixture.OrgWithNoRows, AlertMetric.PendingSalaryAdjustments, CancellationToken.None));
    }
}
