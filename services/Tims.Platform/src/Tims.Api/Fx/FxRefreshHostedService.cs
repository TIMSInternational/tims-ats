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

    /// <summary>
    /// Startup DI probe: resolve the use case ONCE, eagerly, BEFORE the background loop exists — so a
    /// broken registration graph (a dropped <c>AddFxRateGateway()</c>, a lost write-repo line) fails the
    /// HOST START, which fails the DEPLOY visibly, instead of throwing inside the loop where the
    /// load-bearing catch-all would log it once per tick and the pins would silently freeze — a
    /// green-suite recurrence of the very incident this service exists to end. Pure construction, no I/O:
    /// provider outages and DB unavailability stay runtime concerns for the loop's catch-all, exactly as
    /// before. The distinction is deliberate — a CONFIGURATION bug should fail loud at the moment a human
    /// is watching a deploy; a TRANSIENT dependency failure should not take the API down.
    /// </summary>
    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await using (var scope = _scopeFactory.CreateAsyncScope())
        {
            _ = scope.ServiceProvider.GetRequiredService<RefreshFxRatesUseCase>();
        }

        await base.StartAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// The wait after a FAILED run. A transient boot-time failure (DB briefly unreachable, provider
    /// hiccup) must not push the catch-up a full <see cref="FxOptions.RefreshIntervalHours"/> away —
    /// the runbook's "fresh pins within seconds of the flip" would silently become "within a day" on
    /// any bad boot. Fifteen minutes is gentle (≤4 attempts/hour; Polly has already done the
    /// short-horizon retrying inside each attempt). The VALUE is recorded here rather than
    /// mutation-proved: proving it would need a clock abstraction this one constant does not justify,
    /// and <c>tickOverrideForTests</c> deliberately overrides both delays, so the loop tests cannot see
    /// the distinction. Stated so nobody reads the loop tests as covering it.
    /// </summary>
    private static readonly TimeSpan FailureRetryDelay = TimeSpan.FromMinutes(15);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Read once: a mid-flight config change takes effect on the next boot, which is how every other
        // knob on this host behaves (App Runner restarts instances on config deploys anyway).
        var interval = TimeSpan.FromHours(_fxOptions.Value.RefreshIntervalHours);

        while (!stoppingToken.IsCancellationRequested)
        {
            var succeeded = false;
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var useCase = scope.ServiceProvider.GetRequiredService<RefreshFxRatesUseCase>();
                var written = await useCase.RunAsync(stoppingToken).ConfigureAwait(false);
                succeeded = true;
                if (written == 0)
                {
                    // A refresh that pins NOTHING is anomalous (no usable rates, or an empty quote set on
                    // a populated platform) and is exactly the shape the 2026-08-15 incident taught us to
                    // surface: Warning, so it stands out from the routine count line below in log search.
                    _logger.LogWarning("fx refresh (api host): run succeeded but pinned 0 rates — pins keep their previous values");
                }
                else
                {
                    _logger.LogInformation("fx refresh (api host): pinned {Count} rate(s)", written);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return; // graceful shutdown mid-run — not a failure, nothing to log as one.
            }
            catch (Exception ex)
            {
                // Stale pins beat a dead host; the reads' own dispositions (fail-soft / 503) already
                // handle staleness. NEVER rethrow — see the class docblock for why that stops the host.
                //
                // The `when` clause above is what routes a PROVIDER-side OperationCanceledException here
                // instead of into the return: HttpClient's own 100s timeout throws TaskCanceledException
                // (an OCE) on a token that is NOT stoppingToken, which is reachable whenever
                // Fx:TotalTimeoutSeconds is configured above 100. A plain `catch (OCE) { return; }`
                // would treat that provider timeout as a shutdown and END THE LOOP with the host still
                // alive — permanent silent staleness, the incident again. Pinned by
                // A_provider_side_cancellation_is_not_mistaken_for_shutdown.
                _logger.LogError(ex, "fx refresh (api host): run failed; retrying in {Retry}", FailureRetryDelay);
            }

            try
            {
                await Task.Delay(tickOverrideForTests ?? (succeeded ? interval : FailureRetryDelay), stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
