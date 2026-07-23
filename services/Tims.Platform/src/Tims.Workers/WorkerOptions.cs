using System.ComponentModel.DataAnnotations;

namespace Tims.Workers;

/// <summary>
/// Bound from the "Workers" config section and validated at startup (ValidateDataAnnotations +
/// ValidateOnStart), mirroring <see cref="PlatformOptions"/> / <c>HrisOptions</c>. Flat by design so
/// DataAnnotations validation (which does not recurse into complex members) covers every knob. Carries the
/// scheduler cadence + the resilient-job retry budget — non-secret dev defaults live here.
/// Implements <see cref="IValidatableObject"/> for the one cross-field rule the per-property
/// <c>[Range]</c> attributes can't express (check-in threshold must exceed the interval when clustered);
/// <c>ValidateDataAnnotations</c> invokes it because it validates with <c>validateAllProperties: true</c>.
/// </summary>
public sealed class WorkerOptions : IValidatableObject
{
    public const string SectionName = "Workers";

    /// <summary>
    /// Quartz cron expression for the HRIS background sweep. Default = top of every hour
    /// (<c>sec min hour day-of-month month day-of-week</c>). Validated live by the scheduler builder,
    /// which throws at startup on a malformed expression (fail-fast).
    /// </summary>
    [Required]
    public string HrisSyncCron { get; init; } = "0 0 * * * ?";

    /// <summary>
    /// Whether the HRIS sweep trigger is registered. When false the job is still stored durably (so its
    /// JobKey exists) but no cron trigger fires it — the deploy-time off switch.
    /// </summary>
    public bool HrisSyncEnabled { get; init; } = true;

    /// <summary>
    /// Quartz cron expression for the daily FX-rate refresh (Slice 11c). Default = 05:00 UTC daily (after the
    /// ECB ~16:00 CET publish). Validated live by the scheduler builder (fail-fast on a malformed expression).
    /// </summary>
    [Required]
    public string FxRefreshCron { get; init; } = "0 0 5 * * ?";

    /// <summary>
    /// Whether the FX-refresh trigger is registered. When false the job is still stored durably (its JobKey
    /// exists + is triggerable) but no cron trigger fires it — the deploy-time off switch.
    /// </summary>
    public bool FxRefreshEnabled { get; init; } = true;

    /// <summary>Max attempts (initial try + retries) the resilient runner makes for one job fire.</summary>
    [Range(1, 10)]
    public int JobMaxAttempts { get; init; } = 3;

    /// <summary>Base delay for the runner's exponential retry backoff, in milliseconds.</summary>
    [Range(0, 600000)]
    public int JobBaseRetryDelayMilliseconds { get; init; } = 500;

    /// <summary>
    /// When true the scheduler uses the persistent, CLUSTERED Quartz ADO store on Postgres (multi-replica
    /// HA — a recurring trigger fires exactly once across the cluster). When false (the default) it uses the
    /// in-memory RAMJobStore, which is process-local and REQUIRES the scheduler deployment to be pinned to a
    /// single replica. Deploy-time off switch: keep false until the `qrtz_*` DDL is applied to prod (Phase 4
    /// Slice 2), then flip to true. See docs/architecture/csharp-migration/phase-4-slice-2-clustered-quartz-store.md.
    /// </summary>
    public bool ClusteredSchedulerEnabled { get; init; }

    /// <summary>
    /// How often (seconds) a clustered node writes its heartbeat to <c>qrtz_scheduler_state</c>. Only used when
    /// <see cref="ClusteredSchedulerEnabled"/> is true. Lower = faster failover detection, more DB chatter.
    /// </summary>
    [Range(1, 300)]
    public int SchedulerCheckinIntervalSeconds { get; init; } = 10;

    /// <summary>
    /// How long (seconds) a node's heartbeat may be stale before other nodes treat it as dead and recover its
    /// in-flight triggers. Only used when <see cref="ClusteredSchedulerEnabled"/> is true. Should exceed
    /// <see cref="SchedulerCheckinIntervalSeconds"/> so a healthy-but-briefly-slow node is not falsely reclaimed.
    /// </summary>
    [Range(1, 600)]
    public int SchedulerCheckinMisfireThresholdSeconds { get; init; } = 20;

    /// <summary>
    /// Cross-field rule (clustered path only): the misfire threshold MUST exceed the check-in interval, else a
    /// healthy node whose heartbeat is merely one interval old is falsely declared dead and its in-flight
    /// triggers reclaimed — a self-inflicted HA outage. The per-property <c>[Range]</c> attributes can't express
    /// this relationship, so it is enforced here (only when clustering is on — the RAM path ignores both knobs).
    /// </summary>
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (ClusteredSchedulerEnabled &&
            SchedulerCheckinMisfireThresholdSeconds <= SchedulerCheckinIntervalSeconds)
        {
            yield return new ValidationResult(
                "Workers:SchedulerCheckinMisfireThresholdSeconds must be greater than " +
                "Workers:SchedulerCheckinIntervalSeconds so a healthy-but-briefly-slow clustered node is not " +
                "falsely reclaimed.",
                [nameof(SchedulerCheckinMisfireThresholdSeconds), nameof(SchedulerCheckinIntervalSeconds)]);
        }
    }
}
