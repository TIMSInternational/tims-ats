namespace Tims.Application.PlatformHealth;

/// <summary>
/// One cheap, READ-ONLY probe of an external dependency. Implementations must never mutate anything, never
/// invoke a billable operation (no model inference, no email send), and must classify their own failures
/// into <see cref="DependencyStatus"/> + <see cref="DependencyReason"/> codes — the raw exception text never
/// leaves the probe.
///
/// <para>The cancellation token carries the per-probe deadline. A probe that throws anyway is reported
/// <see cref="DependencyStatus.NotMonitored"/> / <see cref="DependencyReason.ProbeFailed"/> by
/// <see cref="DependencyHealthUseCase"/>, which also enforces the deadline from outside.</para>
/// </summary>
public interface IDependencyProbe
{
    string Id { get; }

    Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken);
}

/// <summary>Observability hook for probe faults — the exception TYPE only, never its message.</summary>
public interface IPlatformHealthTelemetry
{
    void ProbeFaulted(string probeId, string exceptionType);

    void ProbeTimedOut(string probeId);
}

/// <summary>Timing knobs for <see cref="DependencyHealthUseCase"/>.</summary>
public sealed record DependencyHealthSettings(TimeSpan ProbeTimeout, TimeSpan CacheDuration);

/// <summary>
/// A constant probe for a dependency this platform does not use. Reporting it honestly as
/// <c>not_monitored / not_used</c> is better than a blank card or a fabricated green dot.
/// </summary>
public sealed class NotUsedDependencyProbe(string id) : IDependencyProbe
{
    public string Id { get; } = id;

    public Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken) =>
        Task.FromResult(DependencyProbeResult.Of(Id, DependencyStatus.NotMonitored, DependencyReason.NotUsed));
}
