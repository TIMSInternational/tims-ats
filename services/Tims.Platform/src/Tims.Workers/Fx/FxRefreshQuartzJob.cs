using Quartz;
using Tims.Workers.Jobs;

namespace Tims.Workers.Fx;

/// <summary>
/// The Quartz adapter for the daily FX-rate refresh (Slice 11c). Quartz's Microsoft-DI job factory creates a
/// fresh DI SCOPE per fire and resolves this job from it, so the scoped <see cref="FxRefreshJob"/> — and its
/// scoped use case / <c>FxRateDbContext</c> / typed HttpClient — are per-fire, never captured from the root
/// provider. <see cref="DisallowConcurrentExecution"/> prevents overlapping fires from stacking. All
/// resilience/observability lives in <see cref="ResilientJobRunner"/>; the trigger's cancellation token is
/// threaded through for cooperative shutdown. UNLIKE the HRIS sweep the refresh keys on the ECB date the gateway
/// returns (not the fire time), so no scheduled-occurrence needs threading in — the upsert is idempotent per as_of.
/// </summary>
[DisallowConcurrentExecution]
public sealed class FxRefreshQuartzJob(FxRefreshJob refresh, ResilientJobRunner runner) : IJob
{
    /// <summary>The stable job name used for the JobKey, spans, logs, and metrics.</summary>
    public const string JobName = "fx-refresh";

    private readonly FxRefreshJob _refresh = refresh;
    private readonly ResilientJobRunner _runner = runner;

    public Task Execute(IJobExecutionContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return _runner.RunAsync(JobName, ct => _refresh.RunAsync(ct), context.CancellationToken);
    }
}
