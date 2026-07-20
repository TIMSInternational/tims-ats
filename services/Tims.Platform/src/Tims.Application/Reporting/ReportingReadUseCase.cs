using Tims.Domain.Reporting;

namespace Tims.Application.Reporting;

/// <summary>
/// The recruitment-analytics READ use case — infra-free orchestration, a faithful port of the TS
/// <c>recruitment-analytics.service.ts</c>. Each method computes the same time bounds the TS service does
/// (period-relative <c>from</c>, the 6-month UTC window <c>start</c>, the 1-year TTF <c>ttfLookback</c>),
/// calls the repository, and returns the pure <c>Tims.Domain.Reporting</c> kernel output. Metrics with no
/// data source (cost-per-hire, quality-of-hire, ML) are NOT computed — the UI shows honest empty states.
/// </summary>
public sealed class ReportingReadUseCase(IReportingReadRepository repository)
{
    private static readonly IReadOnlyDictionary<string, int> PeriodDays = new Dictionary<string, int>
    {
        ["7D"] = 7,
        ["30D"] = 30,
        ["90D"] = 90,
        ["6M"] = 180,
        ["1Y"] = 365,
    };

    private readonly IReportingReadRepository _repository = repository;

    public async Task<KpiView> GetKpisAsync(string organizationId, string period, CancellationToken cancellationToken)
    {
        var from = PeriodStart(period, NowUtcMs());
        var data = await _repository.GetKpiDataAsync(organizationId, from, cancellationToken).ConfigureAwait(false);
        return KpiViewBuilder.Build(new KpiViewInput(
            period, data.Accepted, data.OffersSent, data.OffersAccepted, data.TotalApplications, data.Rejected));
    }

    public async Task<FunnelView> GetFunnelAsync(string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetFunnelDataAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return FunnelViewBuilder.Build(data.Stages, data.Counts, data.TotalApplications, data.TotalHired);
    }

    public async Task<IReadOnlyList<SourceBreakdownItem>> GetSourceBreakdownAsync(
        string organizationId, string period, CancellationToken cancellationToken)
    {
        var from = PeriodStart(period, NowUtcMs());
        var data = await _repository.GetSourceDataAsync(organizationId, from, cancellationToken).ConfigureAwait(false);
        return SourceBreakdownBuilder.Build(data.Apps, data.HireSources);
    }

    public async Task<IReadOnlyList<TrendBucket>> GetTrendAsync(string organizationId, CancellationToken cancellationToken)
    {
        var now = NowUtcMs();
        var nowMs = new DateTimeOffset(now, TimeSpan.Zero).ToUnixTimeMilliseconds();
        var start = TrendWindowStart(now);
        var appliedAtMs = await _repository.GetApplicationAppliedAtMsAsync(organizationId, start, cancellationToken).ConfigureAwait(false);
        return TrendViewBuilder.Build(nowMs, appliedAtMs);
    }

    public async Task<LostByDelayView> GetLostByDelayAsync(
        string organizationId, string period, CancellationToken cancellationToken)
    {
        var from = PeriodStart(period, NowUtcMs());
        var rejected = await _repository.GetLostByDelayDataAsync(organizationId, from, cancellationToken).ConfigureAwait(false);
        return LostByDelayViewBuilder.Build(rejected);
    }

    public async Task<IReadOnlyList<RecruiterSlaRow>> GetRecruiterSlaAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var now = NowUtcMs();
        var nowMs = new DateTimeOffset(now, TimeSpan.Zero).ToUnixTimeMilliseconds();
        var ttfLookback = DateTime.SpecifyKind(now.AddDays(-365), DateTimeKind.Unspecified);
        var data = await _repository.GetRecruiterDataAsync(organizationId, ttfLookback, cancellationToken).ConfigureAwait(false);
        return RecruiterSlaViewBuilder.Build(new RecruiterSlaInput(
            nowMs, data.Vacancies, data.AppCounts, data.Accepted, data.Active));
    }

    /// <summary>Current UTC time truncated to MILLISECOND resolution — the TS service derives every cutoff
    /// from <c>Date.getTime()</c> (integer ms), and the Prisma columns are <c>timestamp(3)</c>; truncating
    /// here keeps a row stored at exactly a period boundary (to the ms) on the same side of <c>&gt;= from</c>
    /// in both stacks (a raw tick-precision <c>DateTime.UtcNow</c> would exclude a <c>.123</c> boundary row a
    /// ms-truncated JS <c>now</c> includes). Returns Kind=Utc.</summary>
    private static DateTime NowUtcMs()
    {
        var now = DateTime.UtcNow;
        return new DateTime(now.Ticks - (now.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);
    }

    /// <summary>The period lower bound as an Unspecified-kind wall-clock UTC DateTime (matching the Prisma
    /// <c>timestamp</c> columns; Npgsql rejects a Kind=Utc parameter against a <c>timestamp without time
    /// zone</c>). Unknown periods floor to 30 days (defensive; the endpoint already validates the enum).</summary>
    private static DateTime PeriodStart(string period, DateTime nowUtc)
    {
        var days = PeriodDays.TryGetValue(period, out var n) ? n : 30;
        return DateTime.SpecifyKind(nowUtc.AddDays(-days), DateTimeKind.Unspecified);
    }

    /// <summary>First day (UTC) of the earliest of the six trend buckets = <c>Date.UTC(y, m - 5, 1)</c>.
    /// Reproduces JS month normalization (m-5 underflows into the prior year) via floored div/mod, and
    /// returns an Unspecified-kind wall-clock DateTime for the <c>applied_at</c> timestamp filter.</summary>
    private static DateTime TrendWindowStart(DateTime nowUtc)
    {
        var total = nowUtc.Year * 12 + (nowUtc.Month - 1) - 5;
        var y = (int)Math.Floor(total / 12.0);
        var m0 = total - y * 12; // 0..11
        return new DateTime(y, m0 + 1, 1, 0, 0, 0, DateTimeKind.Unspecified);
    }
}
