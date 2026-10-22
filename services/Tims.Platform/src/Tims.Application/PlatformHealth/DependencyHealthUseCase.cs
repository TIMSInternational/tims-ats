namespace Tims.Application.PlatformHealth;

/// <summary>
/// Runs every registered <see cref="IDependencyProbe"/> in parallel, each under its own hard deadline
/// (<see cref="DependencyHealthSettings.ProbeTimeout"/>, ~2s), and caches the combined answer for
/// <see cref="DependencyHealthSettings.CacheDuration"/> (30–60s). Singleton.
///
/// <para><b>Why a cache.</b> The page polls every 30s per open tab; without one, N platform owners would fan
/// N × 6 calls out to AWS and Supabase. With it, the platform makes at most one probe round per window no
/// matter how many tabs are open. One refresh at a time (single flight): concurrent callers during a refresh
/// wait for it rather than stampeding.</para>
///
/// <para><b>Deadline enforcement is belt and braces.</b> The probe receives a token that cancels at the
/// deadline (so SDK calls abort), AND the await itself is bounded with <c>WaitAsync</c> — a probe that ignores
/// its token still cannot hold the response past the deadline. A timed-out probe reports
/// <c>down / timeout</c>: a dependency that cannot answer a trivial read in 2s is not serving.</para>
///
/// <para><b>A probe that throws</b> reports <c>not_monitored / probe_failed</c> — the probe could not establish
/// a state, so claiming either up or down would be a guess. Only the exception TYPE is logged.</para>
/// </summary>
public sealed class DependencyHealthUseCase(
    IEnumerable<IDependencyProbe> probes,
    DependencyHealthSettings settings,
    TimeProvider clock,
    IPlatformHealthTelemetry telemetry)
{
    private readonly IReadOnlyList<IDependencyProbe> _probes = OrderProbes(probes);
    private readonly SemaphoreSlim _refresh = new(1, 1);
    private Cached? _cached;

    public async Task<DependencyHealthView> GetAsync(CancellationToken cancellationToken)
    {
        var cached = Volatile.Read(ref _cached);
        if (cached is not null && clock.GetUtcNow() < cached.ExpiresAt)
        {
            return cached.View;
        }

        await _refresh.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            cached = Volatile.Read(ref _cached);
            if (cached is not null && clock.GetUtcNow() < cached.ExpiresAt)
            {
                return cached.View;
            }

            var checkedAt = clock.GetUtcNow();
            var results = await Task.WhenAll(_probes.Select(probe => RunAsync(probe, cancellationToken)))
                .ConfigureAwait(false);
            var view = new DependencyHealthView(checkedAt, (int)settings.CacheDuration.TotalSeconds, results);
            Volatile.Write(ref _cached, new Cached(view, clock.GetUtcNow() + settings.CacheDuration));
            return view;
        }
        finally
        {
            _refresh.Release();
        }
    }

    private async Task<DependencyProbeResult> RunAsync(IDependencyProbe probe, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(settings.ProbeTimeout);
        try
        {
            // Task.Run: the deadline must bound the probe's SYNCHRONOUS prefix too (lazy SDK client construction,
            // a blocking call before the first await). Calling ProbeAsync directly ran that prefix before
            // WaitAsync was attached, so it could delay sibling probes or report operational after the deadline.
            var token = deadline.Token;
            var result = await Task.Run(() => probe.ProbeAsync(token), token)
                .WaitAsync(settings.ProbeTimeout, clock, cancellationToken)
                .ConfigureAwait(false);
            return Sanitize(probe.Id, result);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            telemetry.ProbeTimedOut(probe.Id);
            return DependencyProbeResult.Of(probe.Id, DependencyStatus.Down, DependencyReason.Timeout);
        }
        catch (TimeoutException)
        {
            telemetry.ProbeTimedOut(probe.Id);
            return DependencyProbeResult.Of(probe.Id, DependencyStatus.Down, DependencyReason.Timeout);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            telemetry.ProbeFaulted(probe.Id, ex.GetType().Name);
            return DependencyProbeResult.Of(probe.Id, DependencyStatus.NotMonitored, DependencyReason.ProbeFailed);
        }
    }

    /// <summary>
    /// The wire contract is a closed set: a probe returning an unknown status (or another probe's id) is
    /// downgraded to <c>not_monitored / probe_failed</c> rather than passed through.
    /// </summary>
    internal static DependencyProbeResult Sanitize(string expectedId, DependencyProbeResult result)
    {
        if (!string.Equals(result.Id, expectedId, StringComparison.Ordinal) || !KnownStatuses.Contains(result.Status))
        {
            return DependencyProbeResult.Of(expectedId, DependencyStatus.NotMonitored, DependencyReason.ProbeFailed);
        }

        return result;
    }

    private static readonly HashSet<string> KnownStatuses =
    [
        DependencyStatus.Operational,
        DependencyStatus.Degraded,
        DependencyStatus.Down,
        DependencyStatus.NotConfigured,
        DependencyStatus.NotMonitored,
    ];

    private static List<IDependencyProbe> OrderProbes(IEnumerable<IDependencyProbe> probes)
    {
        var byId = new Dictionary<string, IDependencyProbe>(StringComparer.Ordinal);
        foreach (var probe in probes)
        {
            // Last registration wins, so a test (or a later registration) can replace one probe.
            byId[probe.Id] = probe;
        }

        return [.. DependencyIds.Ordered.Where(byId.ContainsKey).Select(id => byId[id])];
    }

    private sealed record Cached(DependencyHealthView View, DateTimeOffset ExpiresAt);
}
