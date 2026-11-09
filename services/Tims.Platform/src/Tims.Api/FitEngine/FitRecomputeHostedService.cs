using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.FitEngine;

namespace Tims.Api.FitEngine;

/// <summary>
/// Drains the FIT v2 recompute queue every <see cref="Interval"/> (the first pass one interval after start), each pass
/// running <see cref="FitRecomputeUseCase"/> from a fresh DI scope. Database triggers enqueue a request in the same
/// transaction that cancels, voids, flags, grades or reviews an assessment a FIT v2 row depends on (migration
/// 20261109100000_fit_v2_integrity), so the stored score follows its inputs without anyone pressing "compute".
/// Registered ONLY when <c>Platform:FitEngineWriteEnabled</c> AND <c>Platform:FitEngineV2Enabled</c> are on (the FIT v2
/// compute is live); with them off the queue simply holds its requests.
///
/// <para>Every App Runner instance runs its own loop. That is safe: claims are <c>FOR UPDATE SKIP LOCKED</c> with a
/// lease, a recompute takes the FIT v2 lock, and a request is deleted only at the sequence it was claimed at. As in
/// <c>ProviderWithdrawalSweepHostedService</c> the catch-all is load-bearing (an exception escaping
/// <c>ExecuteAsync</c> stops the whole host); a failed pass is logged and the next tick retries. The DI graph is
/// resolved once at start, so a broken registration fails the deploy instead of every tick.</para>
/// </summary>
/// <param name="tickOverrideForTests">TEST-ONLY: replaces <see cref="Interval"/>.</param>
public sealed class FitRecomputeHostedService(
    IServiceScopeFactory scopeFactory,
    TimeProvider timeProvider,
    IOptions<PlatformOptions> platformOptions,
    ILogger<FitRecomputeHostedService> logger,
    TimeSpan? tickOverrideForTests = null) : BackgroundService
{
    /// <summary>How often the queue is drained: a cancelled or flagged result shows in FIT within about this long.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly TimeProvider _timeProvider = timeProvider;
    private readonly PlatformOptions _options = platformOptions.Value;
    private readonly ILogger<FitRecomputeHostedService> _logger = logger;

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await using (var scope = _scopeFactory.CreateAsyncScope())
        {
            _ = scope.ServiceProvider.GetRequiredService<FitRecomputeUseCase>();
        }

        await base.StartAsync(cancellationToken).ConfigureAwait(false);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(tickOverrideForTests ?? Interval, _timeProvider, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var drain = scope.ServiceProvider.GetRequiredService<FitRecomputeUseCase>();
                var outcome = await drain.RunAsync(
                        _timeProvider.GetUtcNow(), _options.FitEngineV2Enabled, _options.FitEngineLiaScoredEnabled,
                        stoppingToken)
                    .ConfigureAwait(false);
                if (outcome.Failed > 0 || outcome.FailedOrganizations > 0)
                {
                    _logger.LogWarning(
                        "FIT v2 recompute: {Failed} request(s) and {FailedOrganizations} organization(s) failed; {Recomputed} recomputed, {Skipped} skipped",
                        outcome.Failed, outcome.FailedOrganizations, outcome.Recomputed, outcome.Skipped);
                }
                else if (outcome.Recomputed + outcome.Skipped > 0)
                {
                    _logger.LogInformation(
                        "FIT v2 recompute: {Recomputed} recomputed, {Skipped} skipped across {Organizations} organization(s)",
                        outcome.Recomputed, outcome.Skipped, outcome.Organizations);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // Requests stay queued; the next tick retries. NEVER rethrow (see the class docblock).
                _logger.LogError(ex, "FIT v2 recompute pass failed; retrying in {Interval}", Interval);
            }
        }
    }
}
