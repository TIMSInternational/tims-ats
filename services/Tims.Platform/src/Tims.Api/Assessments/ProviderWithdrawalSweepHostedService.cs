using Tims.Application.Assessments.Providers;

namespace Tims.Api.Assessments;

/// <summary>
/// The scheduled retry of the #312 withdrawal cascade to the assessment provider (D15, D17): one sweep every
/// <see cref="Interval"/>, the first one interval after start (a boot is not a trigger: the cascade's own passes run on
/// withdrawals, webhooks and launches), each running <see cref="IProviderWithdrawalSweep"/> from a fresh DI scope. Registered
/// ONLY when <c>Platform:AssessmentProvidersEnabled</c> is on (the provider tables exist only then).
///
/// <para>Every App Runner instance runs its own loop. That is safe: every write a sweep makes is conditional (the
/// cascade's completion fence, the cleanup markers), and the provider calls it repeats are idempotent (a consent already
/// withdrawn, an assignment already cancelled). It only costs duplicate calls, at most one sweep per instance per
/// interval.</para>
///
/// <para>As in <c>FxRefreshHostedService</c>, the catch-all is load-bearing: an exception escaping
/// <c>ExecuteAsync</c> stops the WHOLE host (<c>BackgroundServiceExceptionBehavior.StopHost</c>). A failed sweep is logged
/// and retried at the next tick; its attempts stay pending meanwhile (results stay stopped). Cancellation is cooperative.
/// The DI graph is resolved once at start, so a broken registration fails the deploy instead of every tick.</para>
/// </summary>
/// <param name="tickOverrideForTests">TEST-ONLY: replaces <see cref="Interval"/>.</param>
public sealed class ProviderWithdrawalSweepHostedService(
    IServiceScopeFactory scopeFactory,
    TimeProvider timeProvider,
    ILogger<ProviderWithdrawalSweepHostedService> logger,
    TimeSpan? tickOverrideForTests = null) : BackgroundService
{
    /// <summary>
    /// Ten minutes: the consent-capture staleness bound (<c>ProviderCleanup.ConsentCaptureStaleAfter</c>), so an attempt
    /// held pending only by a capture left in flight completes within about two intervals of the capture.
    /// </summary>
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly TimeProvider _timeProvider = timeProvider;
    private readonly ILogger<ProviderWithdrawalSweepHostedService> _logger = logger;

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await using (var scope = _scopeFactory.CreateAsyncScope())
        {
            _ = scope.ServiceProvider.GetRequiredService<IProviderWithdrawalSweep>();
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
                var sweep = scope.ServiceProvider.GetRequiredService<IProviderWithdrawalSweep>();
                var outcome = await sweep.RunAsync(_timeProvider.GetUtcNow(), stoppingToken).ConfigureAwait(false);
                if (outcome.FailedOrganizations > 0)
                {
                    _logger.LogWarning(
                        "assessment provider withdrawal sweep: {Failed} of {Organizations} organization(s) failed; {Confirmed} attempt(s) confirmed",
                        outcome.FailedOrganizations, outcome.Organizations, outcome.Confirmed);
                }
                else if (outcome.Organizations > 0)
                {
                    _logger.LogInformation(
                        "assessment provider withdrawal sweep: {Organizations} organization(s), {Confirmed} attempt(s) confirmed",
                        outcome.Organizations, outcome.Confirmed);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // Pending attempts stay pending; the next tick retries. NEVER rethrow (see the class docblock).
                _logger.LogError(ex, "assessment provider withdrawal sweep failed; retrying in {Interval}", Interval);
            }
        }
    }
}
