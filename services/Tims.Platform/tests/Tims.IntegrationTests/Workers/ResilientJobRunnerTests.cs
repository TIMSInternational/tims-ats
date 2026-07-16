using System.Diagnostics.Metrics;
using Microsoft.Extensions.Logging.Abstractions;
using Tims.Workers.Jobs;

namespace Tims.IntegrationTests.Workers;

/// <summary>
/// WP4.1 — the reusable <see cref="ResilientJobRunner"/> contract, fake-based and instant (zero-delay retry
/// strategy). Pins: retry-then-succeed, give-up-after-MaxAttempts (alerter fired once, failure counted,
/// RunAsync returns WITHOUT throwing), success path, and the cancellation contract (OperationCanceledException
/// propagates, is NOT counted as a failure, and is NOT retried).
/// </summary>
public sealed class ResilientJobRunnerTests
{
    private static readonly Func<int, TimeSpan> ZeroDelay = _ => TimeSpan.Zero;

    private static ResilientJobRunner Runner(IJobFailureAlerter alerter, int maxAttempts) =>
        new(NullLogger<ResilientJobRunner>.Instance, alerter, maxAttempts, ZeroDelay);

    [Fact]
    public async Task Retries_then_succeeds_without_alerting()
    {
        var jobName = $"retry-then-succeed-{Guid.NewGuid():N}";
        var alerter = new RecordingAlerter();
        using var metrics = new JobMetricCapture(jobName);
        var invocations = 0;

        // Fails twice, succeeds on the 3rd attempt (MaxAttempts = 5, so it never gives up).
        await Runner(alerter, maxAttempts: 5).RunAsync(
            jobName,
            _ =>
            {
                invocations++;
                if (invocations < 3)
                {
                    throw new InvalidOperationException("transient");
                }

                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.Equal(3, invocations);
        Assert.Equal(0, alerter.AlertCount);
        Assert.Equal(1, metrics.Sum(JobMetrics.SuccessesCounterName));
        Assert.Equal(0, metrics.Sum(JobMetrics.FailuresCounterName));
    }

    [Fact]
    public async Task Gives_up_after_max_attempts_alerts_once_and_returns()
    {
        var jobName = $"give-up-{Guid.NewGuid():N}";
        var alerter = new RecordingAlerter();
        using var metrics = new JobMetricCapture(jobName);
        var invocations = 0;

        // Always throws → exactly MaxAttempts invocations, then give-up. RunAsync must NOT throw.
        await Runner(alerter, maxAttempts: 3).RunAsync(
            jobName,
            _ =>
            {
                invocations++;
                throw new InvalidOperationException("always fails");
            },
            CancellationToken.None);

        Assert.Equal(3, invocations);
        Assert.Equal(1, alerter.AlertCount);
        Assert.Equal(1, metrics.Sum(JobMetrics.FailuresCounterName));
        Assert.Equal(0, metrics.Sum(JobMetrics.SuccessesCounterName));
    }

    [Fact]
    public async Task Success_path_invokes_work_once_and_does_not_alert()
    {
        var jobName = $"success-{Guid.NewGuid():N}";
        var alerter = new RecordingAlerter();
        using var metrics = new JobMetricCapture(jobName);
        var invocations = 0;

        await Runner(alerter, maxAttempts: 3).RunAsync(
            jobName,
            _ =>
            {
                invocations++;
                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.Equal(1, invocations);
        Assert.Equal(0, alerter.AlertCount);
        Assert.Equal(1, metrics.Sum(JobMetrics.SuccessesCounterName));
    }

    [Fact]
    public async Task Give_up_with_a_throwing_alerter_still_returns_and_counts_the_failure()
    {
        var jobName = $"throwing-alerter-{Guid.NewGuid():N}";
        var alerter = new ThrowingAlerter();
        using var metrics = new JobMetricCapture(jobName);

        // Work always throws AND the alerter throws on the give-up path. A faulting alerter is strictly
        // best-effort — RunAsync must STILL return normally (never letting the fault reach Execute/Quartz),
        // and the terminal failure must still be counted. BITE: not wrapping the alerter call makes the
        // alerter's throw propagate out of RunAsync ⇒ this awaited call throws ⇒ the test goes red.
        await Runner(alerter, maxAttempts: 2).RunAsync(
            jobName,
            _ => throw new InvalidOperationException("always fails"),
            CancellationToken.None);

        Assert.Equal(1, alerter.AlertAttempts); // the give-up path did try to alert (once)
        Assert.Equal(1, metrics.Sum(JobMetrics.FailuresCounterName)); // failure still counted despite the fault
        Assert.Equal(0, metrics.Sum(JobMetrics.SuccessesCounterName));
    }

    [Fact]
    public async Task Cancellation_propagates_is_not_retried_and_is_not_alerted()
    {
        var jobName = $"cancel-{Guid.NewGuid():N}";
        var alerter = new RecordingAlerter();
        var invocations = 0;

        // Work throws OperationCanceledException — must propagate out of RunAsync, never a failure/retry.
        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            Runner(alerter, maxAttempts: 3).RunAsync(
                jobName,
                _ =>
                {
                    invocations++;
                    throw new OperationCanceledException();
                },
                CancellationToken.None));

        Assert.Equal(1, invocations); // not retried
        Assert.Equal(0, alerter.AlertCount); // cancellation is not a job failure
    }

    private sealed class RecordingAlerter : IJobFailureAlerter
    {
        public int AlertCount { get; private set; }

        public Task AlertAsync(string jobName, Exception exception, CancellationToken cancellationToken)
        {
            AlertCount++;
            return Task.CompletedTask;
        }
    }

    /// <summary>An alerter that always throws — proves a faulting alerter never escapes <c>RunAsync</c>.</summary>
    private sealed class ThrowingAlerter : IJobFailureAlerter
    {
        public int AlertAttempts { get; private set; }

        public Task AlertAsync(string jobName, Exception exception, CancellationToken cancellationToken)
        {
            AlertAttempts++;
            throw new InvalidOperationException("simulated alerter dispatch failure");
        }
    }

    /// <summary>
    /// Captures the "Tims.Workers" meter's counter measurements tagged with a SPECIFIC job name (unique per
    /// test), so the assertions are deterministic despite the process-wide static instruments.
    /// </summary>
    private sealed class JobMetricCapture : IDisposable
    {
        private readonly MeterListener _listener = new();
        private readonly Dictionary<string, long> _sums = [];
        private readonly string _jobName;
        private readonly Lock _gate = new();

        public JobMetricCapture(string jobName)
        {
            _jobName = jobName;
            _listener.InstrumentPublished = (instrument, listener) =>
            {
                if (instrument.Meter.Name == JobMetrics.MeterName)
                {
                    listener.EnableMeasurementEvents(instrument);
                }
            };
            _listener.SetMeasurementEventCallback<long>((instrument, measurement, tags, state) =>
            {
                foreach (var tag in tags)
                {
                    if (tag is { Key: "job.name", Value: string name } && name == _jobName)
                    {
                        lock (_gate)
                        {
                            _sums[instrument.Name] = _sums.GetValueOrDefault(instrument.Name) + measurement;
                        }
                    }
                }
            });
            _listener.Start();
        }

        public long Sum(string instrumentName)
        {
            lock (_gate)
            {
                return _sums.GetValueOrDefault(instrumentName);
            }
        }

        public void Dispose() => _listener.Dispose();
    }
}
