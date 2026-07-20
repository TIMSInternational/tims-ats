using Tims.Domain.Reporting;
using Tims.Infrastructure.Reporting;

namespace Tims.IntegrationTests.Reporting;

/// <summary>
/// Phase-5 Slice 5 direct-repository tests (real Postgres + real RLS): each call runs UNDER TenantScope
/// (SET LOCAL ROLE app_tenant + org GUC), so these prove the EF aggregation queries fetch the right rows
/// AND that RLS + the explicit org filter isolate the tenant — a cross-org bleed would change OrgA's funnel
/// counts (2/1), not just a grand total (OrgB seeds a DISTINCT 3-in-Applied funnel). The pure kernels are
/// exhaustively golden-tested in the unit suite; here we verify the DB wiring end-to-end.
/// </summary>
[Collection("ReportingRead")]
public sealed class ReportingReadTests(ReportingReadFixture fixture)
{
    private static readonly DateTime FromAllTime = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Unspecified);
    private readonly ReportingReadFixture _fixture = fixture;

    private ReportingReadRepository NewRepo() => new(_fixture.NewReadContext());

    [Fact]
    public async Task Funnel_OrgA_isDeterministic_underRls()
    {
        var data = await NewRepo().GetFunnelDataAsync(ReportingReadFixture.OrgA.ToString(), CancellationToken.None);
        var view = FunnelViewBuilder.Build(data.Stages, data.Counts, data.TotalApplications, data.TotalHired);

        Assert.Equal(3, view.Stages.Count);
        Assert.Equal(("Applied", ReportingReadFixture.OrgAFunnelApplied, 100), (view.Stages[0].Name, view.Stages[0].Count, view.Stages[0].PctOfMax));
        Assert.Equal(("Screen", ReportingReadFixture.OrgAFunnelScreen, 50), (view.Stages[1].Name, view.Stages[1].Count, view.Stages[1].PctOfMax));
        Assert.Equal(("Offer", 0, 0), (view.Stages[2].Name, view.Stages[2].Count, view.Stages[2].PctOfMax));
        Assert.Equal(ReportingReadFixture.OrgATotalApplications, view.TotalApplications);
        Assert.Equal(ReportingReadFixture.OrgATotalHired, view.TotalHired);
        Assert.Equal(ReportingReadFixture.OrgAConversionPct, view.ConversionPct);
    }

    [Fact]
    public async Task Funnel_OrgB_isIsolated_fromOrgA()
    {
        // OrgB's own funnel — proves RLS scopes to the caller's org (OrgB seeds 3 active in Applied, no hires).
        var data = await NewRepo().GetFunnelDataAsync(ReportingReadFixture.OrgB.ToString(), CancellationToken.None);
        var view = FunnelViewBuilder.Build(data.Stages, data.Counts, data.TotalApplications, data.TotalHired);

        Assert.Single(view.Stages);
        Assert.Equal(("Applied", ReportingReadFixture.OrgBFunnelApplied, 100), (view.Stages[0].Name, view.Stages[0].Count, view.Stages[0].PctOfMax));
        Assert.Equal(ReportingReadFixture.OrgBFunnelApplied, view.TotalApplications);
        Assert.Equal(0, view.TotalHired);
        Assert.Equal(0d, view.ConversionPct); // 0 hires but HAS apps → conversion 0.0, not null
    }

    [Fact]
    public async Task SourceBreakdown_OrgA_countsAndHires()
    {
        var data = await NewRepo().GetSourceDataAsync(ReportingReadFixture.OrgA.ToString(), FromAllTime, CancellationToken.None);
        var items = SourceBreakdownBuilder.Build(data.Apps, data.HireSources);

        // linkedin: A1,A2,A4 = 3 apps, 1 hire (A1→O1 accepted); referral: A3 = 1 app, 0 hires.
        Assert.Equal(2, items.Count);
        Assert.Equal(("linkedin", 3, 1), (items[0].Source, items[0].Applications, items[0].Hires));
        Assert.Equal(("referral", 1, 0), (items[1].Source, items[1].Applications, items[1].Hires));
    }

    [Fact]
    public async Task Kpi_OrgA_computesTtfTthAndLostByDelay()
    {
        var data = await NewRepo().GetKpiDataAsync(ReportingReadFixture.OrgA.ToString(), FromAllTime, CancellationToken.None);
        var view = KpiViewBuilder.Build(new KpiViewInput("1Y", data.Accepted, data.OffersSent, data.OffersAccepted, data.TotalApplications, data.Rejected));

        Assert.Equal(ReportingReadFixture.OrgAKpiTtf, view.TimeToFillDays);
        Assert.Equal(ReportingReadFixture.OrgAKpiTth, view.TimeToHireDays);
        Assert.Equal(1, view.Hires);
        Assert.Equal(1, view.OffersSent);
        Assert.Equal(1, view.OffersAccepted);
        Assert.Equal(100, view.OfferAcceptRatePct);
        Assert.Equal(ReportingReadFixture.OrgATotalApplications, view.TotalApplications);
        Assert.Equal(ReportingReadFixture.OrgAKpiLostByDelay, view.LostByDelay);
    }

    [Fact]
    public async Task LostByDelay_OrgA_groupsOverdueRejections()
    {
        var rejected = await NewRepo().GetLostByDelayDataAsync(ReportingReadFixture.OrgA.ToString(), FromAllTime, CancellationToken.None);
        var view = LostByDelayViewBuilder.Build(rejected);

        // A4 sat 72h in Screen (SLA 24h) → 48h over = 2 days; slaDays = round(24/24) = 1.
        Assert.Equal(1, view.Total);
        var item = Assert.Single(view.Items);
        Assert.Equal(("Screen", 1, 1, 2), (item.StageName, item.SlaDays, item.LostCount, item.AvgDaysOver));
    }

    [Fact]
    public async Task RecruiterSla_OrgA_perRecruiterWorkload()
    {
        var data = await NewRepo().GetRecruiterDataAsync(ReportingReadFixture.OrgA.ToString(), FromAllTime, CancellationToken.None);
        // now = 2026-06-05T00:00:00Z: A1 (entered 06-03) 48h ≤ 48, A2 (06-04) 24h ≤ 48, A3 (06-05) 0h ≤ 24 → all on time.
        var nowMs = new DateTimeOffset(2026, 6, 5, 0, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();
        var rows = RecruiterSlaViewBuilder.Build(new RecruiterSlaInput(nowMs, data.Vacancies, data.AppCounts, data.Accepted, data.Active));

        var row = Assert.Single(rows);
        Assert.Equal("Rick Recruiter", row.Name);
        Assert.Equal(1, row.Vacancies);
        Assert.Equal(ReportingReadFixture.OrgATotalApplications, row.Candidates); // 4 apps on V1
        Assert.Equal(ReportingReadFixture.OrgAKpiTtf, row.AvgTtfDays); // O1 span = 10 days
        Assert.Equal(100, row.SlaCompliancePct);
    }

    [Fact]
    public async Task Trend_OrgA_bucketsAreOldestFirstAndSumToApplicationCount()
    {
        // start well before the seed so all four OrgA applications fall inside the fetched range.
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Unspecified);
        var appliedAtMs = await NewRepo().GetApplicationAppliedAtMsAsync(ReportingReadFixture.OrgA.ToString(), start, CancellationToken.None);

        // Bucket relative to a fixed now in the same month as the seed so the 4 June applications land in one bucket.
        var nowMs = new DateTimeOffset(2026, 6, 30, 0, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();
        var buckets = TrendViewBuilder.Build(nowMs, appliedAtMs);

        Assert.Equal(6, buckets.Count);
        Assert.Equal(ReportingReadFixture.OrgATotalApplications, buckets.Sum(b => b.Count)); // all 4 in range
        Assert.Equal(4, buckets[5].Count); // June is the newest bucket
    }
}
