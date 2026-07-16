namespace Tims.Workers.Jobs;

/// <summary>
/// The failure-visibility PORT: invoked once when a job exhausts its retry budget. The default
/// <see cref="LogOnlyJobFailureAlerter"/> writes a structured log; a real channel (Sentry/Slack) is a
/// deploy-time swap behind this same interface. Implementations MUST be PII-free — they receive a job
/// name + the exception only, never job payload or secrets.
/// </summary>
public interface IJobFailureAlerter
{
    /// <summary>Signals that <paramref name="jobName"/> failed terminally with <paramref name="exception"/>.</summary>
    Task AlertAsync(string jobName, Exception exception, CancellationToken cancellationToken);
}
