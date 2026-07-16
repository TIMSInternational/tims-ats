using Microsoft.Extensions.Logging;

namespace Tims.Workers.Jobs;

/// <summary>
/// Default <see cref="IJobFailureAlerter"/>: emits ONE structured Serilog error carrying the job name +
/// the exception (type/message/stack via the logger), and nothing else — no job payload, no secrets, no
/// PII. A real alert channel is wired at deploy behind the same port.
/// </summary>
public sealed class LogOnlyJobFailureAlerter(ILogger<LogOnlyJobFailureAlerter> logger) : IJobFailureAlerter
{
    private readonly ILogger<LogOnlyJobFailureAlerter> _logger = logger;

    public Task AlertAsync(string jobName, Exception exception, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobName);
        ArgumentNullException.ThrowIfNull(exception);

        _logger.LogError(exception, "job {JobName} exhausted its retry budget and was alerted", jobName);
        return Task.CompletedTask;
    }
}
