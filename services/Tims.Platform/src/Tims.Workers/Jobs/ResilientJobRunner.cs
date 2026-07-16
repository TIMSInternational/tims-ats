using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Tims.Workers.Jobs;

/// <summary>
/// The reusable wrapper EVERY job body runs through (WP4.1). It adds, dependency-free:
/// <list type="bullet">
///   <item>an OTel span on <see cref="ActivitySource"/> "Tims.Workers" per run + structured start/ok/fail
///     Serilog lines carrying job name, a run correlation id, and elapsed ms — NO PII, NO secrets;</item>
///   <item>a BOUNDED exponential-backoff retry around the whole fire (injectable delay strategy so tests run
///     instantly with a zero-delay strategy);</item>
///   <item>cooperative-cancellation correctness: <see cref="OperationCanceledException"/> ALWAYS propagates
///     (never a failure, never retried);</item>
///   <item>failure visibility: on final give-up it logs Error, increments the failure counter, fires the
///     <see cref="IJobFailureAlerter"/>, and RETURNS normally — a job fault must never destabilise the
///     Quartz scheduler. Because jobs are idempotent, a retry can never double-write.</item>
/// </list>
/// </summary>
public sealed class ResilientJobRunner
{
    /// <summary>The single OTel <see cref="ActivitySource"/> for worker job spans.</summary>
    public const string ActivitySourceName = "Tims.Workers";

    private static readonly ActivitySource JobActivitySource = new(ActivitySourceName);

    private readonly ILogger<ResilientJobRunner> _logger;
    private readonly IJobFailureAlerter _alerter;
    private readonly int _maxAttempts;
    private readonly Func<int, TimeSpan> _retryDelay;

    /// <summary>
    /// Constructs the runner with an explicit retry budget + delay strategy (the shape the tests drive).
    /// </summary>
    /// <param name="retryDelay">Maps a 1-based attempt number to the delay BEFORE the next attempt; a
    /// <see cref="TimeSpan.Zero"/> delay is awaited-free (tests inject <c>_ =&gt; TimeSpan.Zero</c>).</param>
    public ResilientJobRunner(
        ILogger<ResilientJobRunner> logger,
        IJobFailureAlerter alerter,
        int maxAttempts,
        Func<int, TimeSpan> retryDelay)
    {
        ArgumentNullException.ThrowIfNull(logger);
        ArgumentNullException.ThrowIfNull(alerter);
        ArgumentNullException.ThrowIfNull(retryDelay);
        ArgumentOutOfRangeException.ThrowIfLessThan(maxAttempts, 1);

        _logger = logger;
        _alerter = alerter;
        _maxAttempts = maxAttempts;
        _retryDelay = retryDelay;
    }

    /// <summary>An exponential backoff strategy off <paramref name="baseDelay"/>: attempt n waits base·2^(n-1).</summary>
    public static Func<int, TimeSpan> ExponentialBackoff(TimeSpan baseDelay)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(baseDelay, TimeSpan.Zero);
        return attempt => TimeSpan.FromTicks(baseDelay.Ticks * (1L << Math.Clamp(attempt - 1, 0, 30)));
    }

    /// <summary>
    /// Runs <paramref name="work"/> under the resilience/observability envelope. Returns normally on
    /// success OR on terminal give-up; rethrows ONLY <see cref="OperationCanceledException"/>.
    /// </summary>
    public async Task RunAsync(string jobName, Func<CancellationToken, Task> work, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobName);
        ArgumentNullException.ThrowIfNull(work);

        var runId = Guid.NewGuid().ToString("N");
        using var activity = JobActivitySource.StartActivity(jobName);
        activity?.SetTag("job.name", jobName);
        activity?.SetTag("job.run_id", runId);

        var stopwatch = Stopwatch.StartNew();
        JobMetrics.RunStarted(jobName);
        _logger.LogInformation("job {JobName} run {RunId} started", jobName, runId);

        for (var attempt = 1; attempt <= _maxAttempts; attempt++)
        {
            try
            {
                await work(cancellationToken).ConfigureAwait(false);

                stopwatch.Stop();
                JobMetrics.RunSucceeded(jobName, stopwatch.Elapsed.TotalMilliseconds);
                activity?.SetStatus(ActivityStatusCode.Ok);
                _logger.LogInformation(
                    "job {JobName} run {RunId} succeeded on attempt {Attempt} in {ElapsedMs}ms",
                    jobName, runId, attempt, stopwatch.Elapsed.TotalMilliseconds);
                return;
            }
            catch (OperationCanceledException)
            {
                // Cooperative cancellation (host shutdown / trigger cancel) — propagate, NEVER a failure,
                // NEVER retried. Mirrors the sweep's `catch (OperationCanceledException) { throw; }`.
                throw;
            }
            catch (Exception exception) when (attempt < _maxAttempts)
            {
                _logger.LogWarning(
                    exception,
                    "job {JobName} run {RunId} attempt {Attempt}/{MaxAttempts} failed; retrying",
                    jobName, runId, attempt, _maxAttempts);

                var delay = _retryDelay(attempt);
                if (delay > TimeSpan.Zero)
                {
                    // A cancel during backoff surfaces as OperationCanceledException OUT of RunAsync — correct.
                    await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (Exception exception)
            {
                // Final give-up: record + alert + RETURN (never rethrow) so Quartz is never destabilised.
                stopwatch.Stop();
                JobMetrics.RunFailed(jobName, stopwatch.Elapsed.TotalMilliseconds);
                activity?.SetStatus(ActivityStatusCode.Error);
                _logger.LogError(
                    exception,
                    "job {JobName} run {RunId} failed after {Attempt} attempts in {ElapsedMs}ms; alerting",
                    jobName, runId, attempt, stopwatch.Elapsed.TotalMilliseconds);

                // Alerting is STRICTLY best-effort — the run has already terminally failed. A faulting
                // alerter (including a cancellation) must never change control flow or reach Execute/Quartz,
                // so swallow ANY exception here and log it at Warning; RunAsync still returns normally.
                try
                {
                    await _alerter.AlertAsync(jobName, exception, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception alertException)
                {
                    _logger.LogWarning(
                        alertException,
                        "job {JobName} run {RunId} failure-alert dispatch threw; suppressing (best-effort)",
                        jobName, runId);
                }

                return;
            }
        }
    }
}
