using System.Diagnostics.Metrics;

namespace Tims.Workers.Jobs;

/// <summary>
/// The OTel <see cref="Meter"/> "Tims.Workers" and its job instruments: run / success / failure counters
/// and a duration histogram, all tagged with <c>job.name</c>. Static instruments (created once, process-
/// wide) — the standard OTel pattern; the metrics pipeline subscribes by <see cref="MeterName"/>.
/// </summary>
public static class JobMetrics
{
    /// <summary>The meter name — registered on the OTel metrics pipeline via <c>AddMeter</c>.</summary>
    public const string MeterName = "Tims.Workers";

    /// <summary>Instrument names (public so tests can subscribe a <c>MeterListener</c> deterministically).</summary>
    public const string RunsCounterName = "tims.jobs.runs";
    public const string SuccessesCounterName = "tims.jobs.successes";
    public const string FailuresCounterName = "tims.jobs.failures";
    public const string DurationHistogramName = "tims.jobs.duration";
    public const string ConnectorFailuresCounterName = "tims.jobs.connector_failures";

    private const string JobNameTag = "job.name";
    private const string ConnectorIdTag = "connector.id";

    private static readonly Meter Meter = new(MeterName);

    private static readonly Counter<long> Runs =
        Meter.CreateCounter<long>(RunsCounterName, unit: "{run}", description: "Job runs started.");

    private static readonly Counter<long> Successes =
        Meter.CreateCounter<long>(SuccessesCounterName, unit: "{run}", description: "Job runs that succeeded.");

    private static readonly Counter<long> Failures =
        Meter.CreateCounter<long>(FailuresCounterName, unit: "{run}", description: "Job runs that exhausted their retry budget.");

    private static readonly Histogram<double> Duration =
        Meter.CreateHistogram<double>(DurationHistogramName, unit: "ms", description: "Job run duration.");

    private static readonly Counter<long> ConnectorFailures =
        Meter.CreateCounter<long>(
            ConnectorFailuresCounterName,
            unit: "{failure}",
            description: "Per-connector sweep failures that were isolated (the sweep continued past them).");

    /// <summary>Records that a run of <paramref name="jobName"/> has started.</summary>
    public static void RunStarted(string jobName) =>
        Runs.Add(1, new KeyValuePair<string, object?>(JobNameTag, jobName));

    /// <summary>Records a successful run of <paramref name="jobName"/> and its duration.</summary>
    public static void RunSucceeded(string jobName, double durationMs)
    {
        var tag = new KeyValuePair<string, object?>(JobNameTag, jobName);
        Successes.Add(1, tag);
        Duration.Record(durationMs, tag);
    }

    /// <summary>Records a terminally-failed run of <paramref name="jobName"/> and its duration.</summary>
    public static void RunFailed(string jobName, double durationMs)
    {
        var tag = new KeyValuePair<string, object?>(JobNameTag, jobName);
        Failures.Add(1, tag);
        Duration.Record(durationMs, tag);
    }

    /// <summary>
    /// Records that a SINGLE connector's sync failed inside a sweep of <paramref name="jobName"/> — an
    /// isolated failure the sweep continued past (distinct from a whole-run <see cref="RunFailed"/>). Tagged
    /// with the job name and the connector id so a chronically-failing connector is visible per-connector.
    /// </summary>
    public static void ConnectorFailed(string jobName, Guid connectorId) =>
        ConnectorFailures.Add(
            1,
            new KeyValuePair<string, object?>(JobNameTag, jobName),
            new KeyValuePair<string, object?>(ConnectorIdTag, connectorId));
}
