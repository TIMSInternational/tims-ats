using Tims.Application.PlatformHealth;

namespace Tims.UnitTests.PlatformHealth;

/// <summary>
/// The orchestration contract of <see cref="DependencyHealthUseCase"/>: wire order, per-probe deadline (for
/// probes that honour AND ignore their token), fault isolation, closed-set sanitising, and the cache window.
/// </summary>
public sealed class DependencyHealthUseCaseTests
{
    private static readonly DependencyHealthSettings Fast = new(TimeSpan.FromMilliseconds(150), TimeSpan.FromSeconds(30));

    [Fact]
    public async Task Results_FollowTheFixedWireOrder_RegardlessOfRegistrationOrder()
    {
        var useCase = Build(
            [
                new StubProbe(DependencyIds.Realtime),
                new StubProbe(DependencyIds.Email),
                new StubProbe(DependencyIds.Api),
                new StubProbe(DependencyIds.Ai),
                new StubProbe(DependencyIds.Jobs),
                new StubProbe(DependencyIds.Storage),
                new StubProbe(DependencyIds.Auth),
            ]);

        var view = await useCase.GetAsync(CancellationToken.None);

        Assert.Equal(DependencyIds.Ordered, view.Dependencies.Select(d => d.Id).ToArray());
        Assert.Equal(30, view.CacheSeconds);
    }

    [Fact]
    public async Task AProbeThatHonoursItsToken_PastTheDeadline_IsDownTimeout()
    {
        var telemetry = new RecordingTelemetry();
        var useCase = Build([new HangingProbe(DependencyIds.Storage, honourToken: true), new StubProbe(DependencyIds.Auth)], telemetry);

        var view = await useCase.GetAsync(CancellationToken.None);

        var storage = view.Dependencies.Single(d => d.Id == DependencyIds.Storage);
        Assert.Equal(DependencyStatus.Down, storage.Status);
        Assert.Equal(DependencyReason.Timeout, storage.Reason);
        // The slow probe does not drag its sibling down with it.
        Assert.Equal(DependencyStatus.Operational, view.Dependencies.Single(d => d.Id == DependencyIds.Auth).Status);
        Assert.Contains(DependencyIds.Storage, telemetry.TimedOut);
    }

    [Fact]
    public async Task AProbeThatIgnoresItsToken_StillCannotHoldTheResponsePastTheDeadline()
    {
        var useCase = Build([new HangingProbe(DependencyIds.Ai, honourToken: false)]);

        var started = DateTime.UtcNow;
        var view = await useCase.GetAsync(CancellationToken.None);

        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(5), "the deadline must bound the whole call");
        var ai = Assert.Single(view.Dependencies);
        Assert.Equal(DependencyStatus.Down, ai.Status);
        Assert.Equal(DependencyReason.Timeout, ai.Reason);
    }

    [Fact]
    public async Task ASynchronouslyBlockingProbe_IsBoundedByTheDeadline_AndCannotReportOperational()
    {
        // Tier-1 review: the deadline was attached only after ProbeAsync returned its task.
        var useCase = Build([new SynchronouslyBlockingProbe(DependencyIds.Storage), new StubProbe(DependencyIds.Auth)]);

        var started = DateTime.UtcNow;
        var view = await useCase.GetAsync(CancellationToken.None);

        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(1.5), "the deadline must bound the synchronous prefix");
        var storage = view.Dependencies.Single(d => d.Id == DependencyIds.Storage);
        Assert.Equal(DependencyStatus.Down, storage.Status);
        Assert.Equal(DependencyReason.Timeout, storage.Reason);
    }

    [Fact]
    public async Task AProbeThatThrows_IsNotMonitored_AndOnlyTheExceptionTypeIsReported()
    {
        var telemetry = new RecordingTelemetry();
        var useCase = Build([new ThrowingProbe(DependencyIds.Email, new InvalidOperationException("host db.internal.example leaked"))], telemetry);

        var view = await useCase.GetAsync(CancellationToken.None);

        var email = Assert.Single(view.Dependencies);
        Assert.Equal(DependencyStatus.NotMonitored, email.Status);
        Assert.Equal(DependencyReason.ProbeFailed, email.Reason);
        Assert.Empty(email.Metrics);
        Assert.Equal([(DependencyIds.Email, nameof(InvalidOperationException))], telemetry.Faulted);
    }

    [Fact]
    public async Task AnUnknownStatus_OrAForeignId_IsSanitisedToNotMonitored()
    {
        var useCase = Build(
            [
                new StubProbe(DependencyIds.Auth, status: "green"),
                new StubProbe(DependencyIds.Storage, reportedId: DependencyIds.Ai),
            ]);

        var view = await useCase.GetAsync(CancellationToken.None);

        Assert.All(view.Dependencies, d =>
        {
            Assert.Equal(DependencyStatus.NotMonitored, d.Status);
            Assert.Equal(DependencyReason.ProbeFailed, d.Reason);
        });
        Assert.Equal([DependencyIds.Auth, DependencyIds.Storage], view.Dependencies.Select(d => d.Id).ToArray());
    }

    [Fact]
    public async Task AnswersAreCached_ForTheWindow_ThenRefreshed()
    {
        var clock = new ManualClock(new DateTimeOffset(2026, 10, 12, 12, 0, 0, TimeSpan.Zero));
        var probe = new StubProbe(DependencyIds.Auth);
        var useCase = new DependencyHealthUseCase([probe], Fast, clock, new RecordingTelemetry());

        var first = await useCase.GetAsync(CancellationToken.None);
        clock.Advance(TimeSpan.FromSeconds(29));
        var second = await useCase.GetAsync(CancellationToken.None);

        Assert.Equal(1, probe.Calls);
        Assert.Same(first, second);
        Assert.Equal(first.CheckedAt, second.CheckedAt); // a cached answer keeps its original instant

        clock.Advance(TimeSpan.FromSeconds(1));
        var third = await useCase.GetAsync(CancellationToken.None);

        Assert.Equal(2, probe.Calls);
        Assert.Equal(clock.GetUtcNow(), third.CheckedAt);
    }

    [Fact]
    public async Task ConcurrentCallers_ShareOneProbeRound()
    {
        var probe = new StubProbe(DependencyIds.Auth, delay: TimeSpan.FromMilliseconds(50));
        var useCase = new DependencyHealthUseCase([probe], Fast, TimeProvider.System, new RecordingTelemetry());

        await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => useCase.GetAsync(CancellationToken.None)));

        Assert.Equal(1, probe.Calls);
    }

    [Fact]
    public async Task NotUsedProbe_IsHonestlyNotMonitored()
    {
        var result = await new NotUsedDependencyProbe(DependencyIds.Realtime).ProbeAsync(CancellationToken.None);

        Assert.Equal(DependencyStatus.NotMonitored, result.Status);
        Assert.Equal(DependencyReason.NotUsed, result.Reason);
    }

    private static DependencyHealthUseCase Build(IEnumerable<IDependencyProbe> probes, RecordingTelemetry? telemetry = null) =>
        new(probes, Fast, TimeProvider.System, telemetry ?? new RecordingTelemetry());

    private sealed class StubProbe(string id, string status = DependencyStatus.Operational, string? reportedId = null, TimeSpan? delay = null)
        : IDependencyProbe
    {
        private int _calls;

        public int Calls => _calls;

        public string Id => id;

        public async Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _calls);
            if (delay is { } d)
            {
                await Task.Delay(d, cancellationToken);
            }

            return DependencyProbeResult.Of(reportedId ?? id, status);
        }
    }

    private sealed class SynchronouslyBlockingProbe(string id) : IDependencyProbe
    {
        public string Id => id;

        // Blocks BEFORE returning a task (no await at all), then reports a healthy result.
        public Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken)
        {
            Thread.Sleep(TimeSpan.FromSeconds(2));
            return Task.FromResult(DependencyProbeResult.Of(id, DependencyStatus.Operational));
        }
    }

    private sealed class HangingProbe(string id, bool honourToken) : IDependencyProbe
    {
        public string Id => id;

        public async Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken)
        {
            await Task.Delay(TimeSpan.FromSeconds(30), honourToken ? cancellationToken : CancellationToken.None);
            return DependencyProbeResult.Of(id, DependencyStatus.Operational);
        }
    }

    private sealed class ThrowingProbe(string id, Exception exception) : IDependencyProbe
    {
        public string Id => id;

        public Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken) => Task.FromException<DependencyProbeResult>(exception);
    }

    private sealed class RecordingTelemetry : IPlatformHealthTelemetry
    {
        public List<(string, string)> Faulted { get; } = [];

        public List<string> TimedOut { get; } = [];

        public void ProbeFaulted(string probeId, string exceptionType)
        {
            lock (Faulted)
            {
                Faulted.Add((probeId, exceptionType));
            }
        }

        public void ProbeTimedOut(string probeId)
        {
            lock (TimedOut)
            {
                TimedOut.Add(probeId);
            }
        }
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;

        public void Advance(TimeSpan by) => _now += by;

        public override DateTimeOffset GetUtcNow() => _now;
    }
}
