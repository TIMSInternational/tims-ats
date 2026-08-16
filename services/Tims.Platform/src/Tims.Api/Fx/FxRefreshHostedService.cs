using Microsoft.Extensions.Options;
using Tims.Application.Fx;
using Tims.Infrastructure.Fx;

namespace Tims.Api.Fx;

/// <summary>
/// The in-process FX-rate refresh loop (2026-08-15): one run at STARTUP as a catch-up, then one every
/// <see cref="FxOptions.RefreshIntervalHours"/>, each driving the same <see cref="RefreshFxRatesUseCase"/>
/// the Workers Quartz job was built around. Registered ONLY when <c>Platform:FxRefreshEnabled</c> is true —
/// see that flag's docblock for the staleness incident this exists to end, and for why running it here
/// rather than deploying the Workers host is the deliberate choice.
///
/// <para><b>The startup run is the operational point.</b> App Runner boots a new instance on every deploy
/// and on every scale-out, so with this flag on, "flip the env var" means "the pins are fresh within
/// seconds of the next boot" — no waiting for a daily tick, and no separate catch-up step in the runbook.
/// </para>
///
/// <para><b>The catch-all is load-bearing, not defensive boilerplate.</b> Since .NET 6,
/// <c>HostOptions.BackgroundServiceExceptionBehavior</c> defaults to <c>StopHost</c>: an exception escaping
/// <c>ExecuteAsync</c> takes the WHOLE API down — every live surface, not just FX. A provider outage must
/// degrade to "pins stay stale until the next successful run" (exactly the pre-existing failure mode, but
/// self-healing), never to a dead host. The gateway's own Polly pipeline (retry → circuit breaker) has
/// already done the short-horizon retrying by the time an exception reaches this loop, so this layer only
/// logs and waits for the next tick — it does not add a second retry storm.</para>
///
/// <para>Each run resolves the use case from a FRESH DI scope (its own <c>FxRateDbContext</c> connection,
/// its own typed-client handler lease), mirroring <c>Tims.Workers.Fx.FxRefreshJob</c>. Cancellation is
/// cooperative and never reclassified as a failure.</para>
/// </summary>
/// <param name="tickOverrideForTests">TEST-ONLY: replaces the <see cref="FxOptions.RefreshIntervalHours"/>
/// tick so the failure-recovery loop is provable in milliseconds instead of hours — the same
/// inject-don't-mock-time disposition as the dashboard use cases' <c>nowUtc</c> parameters. Defaulted
/// null, so DI's <c>ActivatorUtilities</c> constructs the production shape without knowing it exists.</param>
public sealed class FxRefreshHostedService(
    IServiceScopeFactory scopeFactory,
    IOptions<FxOptions> fxOptions,
    ILogger<FxRefreshHostedService> logger,
    TimeSpan? tickOverrideForTests = null) : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;

    private readonly IOptions<FxOptions> _fxOptions = fxOptions;

    private readonly ILogger<FxRefreshHostedService> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Read once: a mid-flight config change takes effect on the next boot, which is how every other
        // knob on this host behaves (App Runner restarts instances on config deploys anyway).
        var interval = tickOverrideForTests ?? TimeSpan.FromHours(_fxOptions.Value.RefreshIntervalHours);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var useCase = scope.ServiceProvider.GetRequiredService<RefreshFxRatesUseCase>();
                var written = await useCase.RunAsync(stoppingToken).ConfigureAwait(false);
                _logger.LogInformation("fx refresh (api host): pinned {Count} rate(s)", written);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return; // graceful shutdown mid-run — not a failure, nothing to log as one.
            }
            catch (Exception ex)
            {
                // Stale pins beat a dead host; the reads' own dispositions (fail-soft / 503) already
                // handle staleness. NEVER rethrow — see the class docblock for why that stops the host.
                _logger.LogError(ex, "fx refresh (api host): run failed; pins keep their last values until the next tick");
            }

            try
            {
                await Task.Delay(interval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
