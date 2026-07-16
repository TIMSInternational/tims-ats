using Quartz;
using Tims.Workers.Jobs;

namespace Tims.Workers.Hris;

/// <summary>
/// The Quartz adapter for the HRIS background sweep. Quartz's Microsoft-DI job factory
/// (Quartz.Extensions.Hosting) creates a fresh DI SCOPE per fire and resolves this job from it, so the
/// scoped <see cref="HrisSyncJob"/> — and its scoped repositories + <c>HrisDbContext</c> — are per-fire,
/// never captured from the root provider (no cross-fire DbContext reuse). <see cref="DisallowConcurrentExecution"/>
/// prevents overlapping fires of the same job from stacking. All resilience/observability lives in
/// <see cref="ResilientJobRunner"/>; the trigger's <see cref="IJobExecutionContext.CancellationToken"/> is
/// threaded through for cooperative shutdown.
/// </summary>
[DisallowConcurrentExecution]
public sealed class HrisSyncQuartzJob(HrisSyncJob sweep, ResilientJobRunner runner) : IJob
{
    /// <summary>The stable job name used for the JobKey, spans, logs, and metrics.</summary>
    public const string JobName = "hris-sync";

    private readonly HrisSyncJob _sweep = sweep;
    private readonly ResilientJobRunner _runner = runner;

    public Task Execute(IJobExecutionContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        // Thread the SCHEDULED occurrence (fall back to the actual fire time for a manual TriggerJob) into
        // the sweep so its idempotency bucket keys on the fire, not wall-clock now — each distinct fire does
        // real work; a ResilientJobRunner retry reuses the same occurrence and dedupes. See HrisSyncJob.
        var occurrence = context.ScheduledFireTimeUtc ?? context.FireTimeUtc;
        return _runner.RunAsync(JobName, ct => _sweep.RunAsync(occurrence, ct), context.CancellationToken);
    }
}
