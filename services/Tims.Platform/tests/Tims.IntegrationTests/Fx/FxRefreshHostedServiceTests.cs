using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tims.Api.Fx;
using Tims.Application.Fx;
using Tims.Infrastructure.Fx;

namespace Tims.IntegrationTests.Fx;

/// <summary>
/// Loop-behaviour proofs for <see cref="FxRefreshHostedService"/> (2026-08-15) — container-free: a real
/// <see cref="RefreshFxRatesUseCase"/> over FAKE gateway + repository, with the tick interval shrunk to its
/// floor rather than time mocked. Lives in the integration project only because <c>Tims.UnitTests</c> does
/// not reference <c>Tims.Api</c>.
///
/// <para>What each test kills: dropping the STARTUP run (delay-first loop) fails the first test inside its
/// wait budget; removing the catch-all fails the second (the loop dies on the first throw and never calls
/// again — and in production would take the whole host with it, since BackgroundService exceptions default
/// to StopHost); breaking cooperative cancellation hangs the third past its timeout.</para>
/// </summary>
public sealed class FxRefreshHostedServiceTests
{
    [Fact]
    public async Task Runs_once_at_startup_without_waiting_for_the_first_tick()
    {
        var gateway = new ScriptedGateway();
        var (service, _) = Build(gateway);

        await service.StartAsync(CancellationToken.None);
        try
        {
            // The interval is 1 HOUR (the Range floor); seeing a call inside seconds proves the run
            // happened at startup, not on a tick.
            await WaitUntilAsync(() => gateway.Calls >= 1, TimeSpan.FromSeconds(10));
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        Assert.True(gateway.Calls >= 1, "the refresh never ran at startup");
    }

    [Fact]
    public async Task A_provider_failure_is_swallowed_and_the_loop_keeps_ticking()
    {
        // First call throws (the circuit-breaker shape a sustained outage produces); later calls succeed.
        var gateway = new ScriptedGateway { FailFirstCalls = 1 };
        var (service, _) = Build(gateway, intervalHours: 1, tickForTest: TimeSpan.FromMilliseconds(50));

        await service.StartAsync(CancellationToken.None);
        try
        {
            // Two calls = the throwing startup run PLUS at least one post-failure tick. A loop that dies
            // on the first exception never reaches 2 — and in production would stop the host.
            await WaitUntilAsync(() => gateway.Calls >= 2, TimeSpan.FromSeconds(10));
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        Assert.True(gateway.Calls >= 2, $"loop did not survive the provider failure (calls={gateway.Calls})");
    }

    [Fact]
    public async Task Shutdown_mid_interval_completes_promptly()
    {
        var gateway = new ScriptedGateway();
        var (service, _) = Build(gateway); // 1-hour interval: after the startup run it sits in Task.Delay

        await service.StartAsync(CancellationToken.None);
        await WaitUntilAsync(() => gateway.Calls >= 1, TimeSpan.FromSeconds(10));

        // StopAsync must cancel the pending hour-long delay, not wait it out.
        using var stopBudget = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await service.StopAsync(stopBudget.Token);

        Assert.False(stopBudget.IsCancellationRequested, "StopAsync did not honour cancellation of the tick delay");
    }

    // ── plumbing ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>A service over a real use case with fakes, exactly as the host wires it: the use case is
    /// resolved from a scope per run, so the scope factory is a real DI container.</summary>
    private static (FxRefreshHostedService Service, ServiceProvider Provider) Build(
        ScriptedGateway gateway, int intervalHours = 1, TimeSpan? tickForTest = null)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IFxRateGateway>(gateway);
        services.AddSingleton<IFxRateWriteRepository>(new InMemoryRepository());
        services.AddScoped<RefreshFxRatesUseCase>();
        var provider = services.BuildServiceProvider();

        var options = Options.Create(new FxOptions { RefreshIntervalHours = intervalHours });
        var service = tickForTest is { } tick
            ? new FxRefreshHostedService(provider.GetRequiredService<IServiceScopeFactory>(), options, NullLogger<FxRefreshHostedService>.Instance, tick)
            : new FxRefreshHostedService(provider.GetRequiredService<IServiceScopeFactory>(), options, NullLogger<FxRefreshHostedService>.Instance);

        return (service, provider);
    }

    private static async Task WaitUntilAsync(Func<bool> condition, TimeSpan budget)
    {
        var deadline = DateTime.UtcNow + budget;
        while (!condition() && DateTime.UtcNow < deadline)
        {
            await Task.Delay(25);
        }
    }

    private sealed class ScriptedGateway : IFxRateGateway
    {
        private int _calls;

        public int FailFirstCalls { get; init; }

        public int Calls => Volatile.Read(ref _calls);

        public Task<FxGatewayRates> FetchLatestAsync(
            string baseCurrency, IReadOnlyCollection<string> quoteCurrencies, CancellationToken cancellationToken)
        {
            var call = Interlocked.Increment(ref _calls);
            if (call <= FailFirstCalls)
            {
                throw new HttpRequestException("scripted provider outage");
            }

            return Task.FromResult(new FxGatewayRates(
                baseCurrency,
                new DateOnly(2026, 8, 15),
                new Dictionary<string, double>(StringComparer.Ordinal) { ["COP"] = 4000, ["EUR"] = 0.9 }));
        }
    }

    private sealed class InMemoryRepository : IFxRateWriteRepository
    {
        public Task<IReadOnlyList<string>> ListReferencedCurrenciesAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());

        public Task<int> UpsertRatesAsync(
            string baseCurrency,
            DateOnly asOf,
            IReadOnlyDictionary<string, double> rates,
            DateTime fetchedAt,
            string source,
            CancellationToken cancellationToken) => Task.FromResult(rates.Count);
    }
}
