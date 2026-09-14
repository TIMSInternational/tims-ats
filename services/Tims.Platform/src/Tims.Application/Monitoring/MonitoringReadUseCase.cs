using Tims.Domain.Access;
using Tims.Domain.Monitoring;

namespace Tims.Application.Monitoring;

/// <summary>
/// The monitoring READ use case — infra-free orchestration, a faithful port of the six read bodies on
/// <c>packages/api/src/routers/monitoring.ts</c> (Phase-5 Q0b slice 1, issue #100).
///
/// Every shaping decision that is not a database call is delegated to <see cref="MonitoringKernels"/>
/// or <see cref="KAnonymity"/>, so the TS and C# stacks share ONE specification and one set of golden
/// fixtures. A single injected <c>now</c> (UTC, ms-truncated to match JS <c>Date.now()</c>) drives the
/// trend window and the action-plan horizon, so a read is deterministic per request.
/// </summary>
public sealed class MonitoringReadUseCase(IMonitoringReadRepository repository)
{
    /// <summary>The action-plan "due soon" horizon: TS <c>now + 14 * 24 * 60 * 60 * 1000</c>.</summary>
    private static readonly TimeSpan ActionPlanHorizon = TimeSpan.FromDays(14);

    private readonly IMonitoringReadRepository _repository = repository;

    public async Task<ExecutiveKpiView> GetExecutiveKpisAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var counts = await _repository.GetExecutiveKpiCountsAsync(organizationId, cancellationToken).ConfigureAwait(false);

        // Raw-scalar floor: pendingAdjustments is a COUNT over the §21-restricted salary_adjustments
        // population, so an exact 1..4 would be a sub-floor disclosure to any monitoring:read holder.
        // The other four KPIs are not over a restricted model and pass through unfloored (TS parity).
        var pendingFloor = KAnonymity.SuppressBelowMin5(counts.PendingAdjustments);

        return new ExecutiveKpiView(
            counts.TotalUsers,
            counts.ActiveVacancies,
            pendingFloor.Count,
            pendingFloor.Suppressed,
            counts.ActiveSurveys,
            counts.OpenAlerts,
            // turnoverRate / terminationsLast12m are hardcoded 0 in the TS reader (no Employee model);
            // ported as the same honest constants rather than invented values.
            0d,
            0);
    }

    public async Task<IReadOnlyList<ModuleHealthPoint>> GetModuleHealthAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var counts = await _repository.GetActiveAlertCountsByModuleAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return MonitoringKernels.BuildModuleHealth(counts);
    }

    public Task<ActiveAlertsPage> GetActiveAlertsAsync(
        string organizationId, string? module, string? severity, int page, int limit, CancellationToken cancellationToken) =>
        _repository.GetActiveAlertsAsync(organizationId, module, severity, page, limit, cancellationToken);

    public async Task<ActionPlanAlertsView> GetActionPlanAlertsAsync(
        string organizationId, ScopePredicate scopeWhere, CancellationToken cancellationToken)
    {
        var horizon = NowUtc().Add(ActionPlanHorizon);
        var items = await _repository
            .GetActionPlanAlertsAsync(organizationId, scopeWhere, horizon, cancellationToken)
            .ConfigureAwait(false);

        // TS returns `total: items.length` — the length of the SCOPED page, not a separate DB count.
        return new ActionPlanAlertsView(items, items.Count);
    }

    /// <summary>
    /// getCrossModuleTrend. <paramref name="metric"/> and <paramref name="period"/> are already
    /// validated by the endpoint (tRPC's Zod enums); an unknown period is rejected there, never here.
    /// </summary>
    public async Task<CrossModuleTrendView> GetCrossModuleTrendAsync(
        string organizationId, string metric, string period, CancellationToken cancellationToken)
    {
        var months = MonitoringKernels.TrendMonths(period)
            ?? throw new ArgumentOutOfRangeException(nameof(period), period, "Unknown trend period");

        var window = MonitoringKernels.BuildMonthWindow(NowUtc(), months);
        var bounds = window.Select(w => (w.Start, w.End)).ToList();
        var labels = window.Select(w => w.Label).ToList();

        if (metric == "engagement")
        {
            // SENSITIVE: survey_responses is §21-restricted. Fetch every month first, then apply the
            // ALL-OR-NOTHING floor — per-point suppression leaves a monthly-differencing oracle open.
            var rawCounts = await _repository
                .GetSurveyResponseCountsAsync(organizationId, bounds, cancellationToken)
                .ConfigureAwait(false);
            return new CrossModuleTrendView(metric, period, MonitoringKernels.ApplyEngagementTrendFloor(labels, rawCounts));
        }

        // Non-sensitive metrics. `turnover` is not tracked (no Employee model) and yields a flat 0
        // series with suppressed=false — the TS behaviour, ported rather than invented.
        IReadOnlyList<int> values = metric switch
        {
            "headcount" => await _repository.GetHeadcountCountsAsync(organizationId, bounds, cancellationToken).ConfigureAwait(false),
            "alerts" => await _repository.GetAlertCountsAsync(organizationId, bounds, cancellationToken).ConfigureAwait(false),
            _ => Enumerable.Repeat(0, labels.Count).ToList(),
        };

        var data = labels.Select((label, i) => new TrendPoint(label, values[i], false)).ToList();
        return new CrossModuleTrendView(metric, period, data);
    }

    public Task<IReadOnlyList<AlertRuleView>> GetAlertRulesAsync(
        string organizationId, CancellationToken cancellationToken) =>
        _repository.GetAlertRulesAsync(organizationId, cancellationToken);

    // Current UTC instant, ms-truncated to match JS `Date.now()` integer-ms, and carried as
    // Unspecified kind so it compares directly against the Prisma `timestamp(3) without time zone`
    // columns (which store UTC wall-clock).
    private static DateTime NowUtc()
    {
        var now = DateTime.UtcNow;
        var truncated = new DateTime(now.Ticks - (now.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);
        return DateTime.SpecifyKind(truncated, DateTimeKind.Unspecified);
    }
}
