using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Tims.Api.Assessments;
using Tims.Application.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// Loop behaviour of the D17 <see cref="ProviderAttemptPollHostedService"/>, container-free (a scripted poll behind a real
/// DI container, the tick shrunk): a failing run is swallowed and the loop keeps polling; nothing runs before the first
/// tick; a broken registration fails the start; and every run of one process names the same lease owner.
/// </summary>
public sealed class ProviderAttemptPollHostedServiceTests
{
    [Fact]
    public async Task A_failing_poll_is_swallowed_and_the_loop_keeps_polling_as_one_owner()
    {
        var poll = new ScriptedPoll { FailFirstCalls = 1 };
        var service = Build(poll, TimeSpan.FromMilliseconds(30));

        await service.StartAsync(CancellationToken.None);
        try
        {
            await WaitUntilAsync(() => poll.Calls >= 3, TimeSpan.FromSeconds(10));
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        Assert.True(poll.Calls >= 3, $"the loop stopped after {poll.Calls} call(s)");
        Assert.Equal([service.Owner], poll.Owners.Distinct());
        Assert.NotEqual(Guid.Empty, service.Owner);
    }

    [Fact]
    public async Task No_poll_runs_before_the_first_tick()
    {
        var poll = new ScriptedPoll();
        var service = Build(poll, TimeSpan.FromHours(1));

        await service.StartAsync(CancellationToken.None);
        await Task.Delay(300);
        await service.StopAsync(CancellationToken.None);

        Assert.Equal(0, poll.Calls);
    }

    [Fact]
    public async Task A_missing_poll_registration_fails_the_start()
    {
        var provider = new ServiceCollection().BuildServiceProvider();
        var service = new ProviderAttemptPollHostedService(
            provider.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System,
            NullLogger<ProviderAttemptPollHostedService>.Instance, TimeSpan.FromMilliseconds(10));

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.StartAsync(CancellationToken.None));
    }

    [Fact]
    public void Two_processes_never_share_a_lease_owner()
    {
        var provider = new ServiceCollection().BuildServiceProvider();
        var scopes = provider.GetRequiredService<IServiceScopeFactory>();
        var a = new ProviderAttemptPollHostedService(scopes, TimeProvider.System, NullLogger<ProviderAttemptPollHostedService>.Instance);
        var b = new ProviderAttemptPollHostedService(scopes, TimeProvider.System, NullLogger<ProviderAttemptPollHostedService>.Instance);

        Assert.NotEqual(a.Owner, b.Owner);
    }

    private static ProviderAttemptPollHostedService Build(ScriptedPoll poll, TimeSpan tick)
    {
        var services = new ServiceCollection();
        services.AddScoped<IProviderAttemptPoll>(_ => poll);
        var provider = services.BuildServiceProvider();
        return new ProviderAttemptPollHostedService(
            provider.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System,
            NullLogger<ProviderAttemptPollHostedService>.Instance, tick);
    }

    private static async Task WaitUntilAsync(Func<bool> condition, TimeSpan budget)
    {
        var deadline = DateTime.UtcNow + budget;
        while (!condition() && DateTime.UtcNow < deadline)
        {
            await Task.Delay(25);
        }
    }

    private sealed class ScriptedPoll : IProviderAttemptPoll
    {
        private int _calls;

        public int FailFirstCalls { get; init; }

        public int Calls => Volatile.Read(ref _calls);

        public System.Collections.Concurrent.ConcurrentBag<Guid> Owners { get; } = [];

        public Task<AttemptPoll> RunAsync(Guid owner, DateTimeOffset now, CancellationToken cancellationToken)
        {
            Owners.Add(owner);
            var call = Interlocked.Increment(ref _calls);
            return call <= FailFirstCalls
                ? throw new InvalidOperationException("provider down")
                : Task.FromResult(new AttemptPoll(0, 0, 0, 0, 0));
        }
    }
}
