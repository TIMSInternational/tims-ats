using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Tims.Api.Assessments;
using Tims.Application.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// Loop behaviour of <see cref="ProviderWithdrawalSweepHostedService"/> (Codex release review, round 3 [P1]: the #312
/// cascade had no retry of its own), container-free: a scripted sweep behind a real DI container, the tick shrunk
/// instead of time mocked. Here only because <c>Tims.UnitTests</c> does not reference <c>Tims.Api</c>.
/// <list type="bullet">
/// <item>a failing sweep is swallowed and the loop keeps ticking (an escaping exception would stop the whole host);</item>
/// <item>no sweep runs before the first tick (a boot is not a trigger, and short-lived test hosts stay untouched);</item>
/// <item>a broken registration fails the start, not every tick.</item>
/// </list>
/// </summary>
public sealed class ProviderWithdrawalSweepHostedServiceTests
{
    [Fact]
    public async Task A_failing_sweep_is_swallowed_and_the_loop_keeps_sweeping()
    {
        var sweep = new ScriptedSweep { FailFirstCalls = 1 };
        var service = Build(sweep, TimeSpan.FromMilliseconds(30));

        await service.StartAsync(CancellationToken.None);
        try
        {
            await WaitUntilAsync(() => sweep.Calls >= 3, TimeSpan.FromSeconds(10));
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        Assert.True(sweep.Calls >= 3, $"the loop stopped after {sweep.Calls} call(s)");
    }

    [Fact]
    public async Task No_sweep_runs_before_the_first_tick()
    {
        var sweep = new ScriptedSweep();
        var service = Build(sweep, TimeSpan.FromHours(1));

        await service.StartAsync(CancellationToken.None);
        await Task.Delay(300);
        await service.StopAsync(CancellationToken.None);

        Assert.Equal(0, sweep.Calls);
    }

    [Fact]
    public async Task A_missing_sweep_registration_fails_the_start()
    {
        var provider = new ServiceCollection().BuildServiceProvider();
        var service = new ProviderWithdrawalSweepHostedService(
            provider.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System,
            NullLogger<ProviderWithdrawalSweepHostedService>.Instance, TimeSpan.FromMilliseconds(10));

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.StartAsync(CancellationToken.None));
    }

    private static ProviderWithdrawalSweepHostedService Build(ScriptedSweep sweep, TimeSpan tick)
    {
        var services = new ServiceCollection();
        services.AddScoped<IProviderWithdrawalSweep>(_ => sweep);
        var provider = services.BuildServiceProvider();
        return new ProviderWithdrawalSweepHostedService(
            provider.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System,
            NullLogger<ProviderWithdrawalSweepHostedService>.Instance, tick);
    }

    private static async Task WaitUntilAsync(Func<bool> condition, TimeSpan budget)
    {
        var deadline = DateTime.UtcNow + budget;
        while (!condition() && DateTime.UtcNow < deadline)
        {
            await Task.Delay(25);
        }
    }

    private sealed class ScriptedSweep : IProviderWithdrawalSweep
    {
        private int _calls;

        public int FailFirstCalls { get; init; }

        public int Calls => Volatile.Read(ref _calls);

        public Task<WithdrawalSweep> RunAsync(DateTimeOffset now, CancellationToken cancellationToken)
        {
            var call = Interlocked.Increment(ref _calls);
            return call <= FailFirstCalls
                ? throw new InvalidOperationException("provider down")
                : Task.FromResult(new WithdrawalSweep(0, 0, 0));
        }
    }
}
