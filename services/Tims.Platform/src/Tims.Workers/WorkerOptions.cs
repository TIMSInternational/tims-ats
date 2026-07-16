using System.ComponentModel.DataAnnotations;

namespace Tims.Workers;

/// <summary>
/// Bound from the "Workers" config section and validated at startup (ValidateDataAnnotations +
/// ValidateOnStart), mirroring <see cref="PlatformOptions"/> / <c>HrisOptions</c>. Flat by design so
/// DataAnnotations validation (which does not recurse into complex members) covers every knob. Carries the
/// scheduler cadence + the resilient-job retry budget — non-secret dev defaults live here.
/// </summary>
public sealed class WorkerOptions
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

    /// <summary>Max attempts (initial try + retries) the resilient runner makes for one job fire.</summary>
    [Range(1, 10)]
    public int JobMaxAttempts { get; init; } = 3;

    /// <summary>Base delay for the runner's exponential retry backoff, in milliseconds.</summary>
    [Range(0, 600000)]
    public int JobBaseRetryDelayMilliseconds { get; init; } = 500;
}
