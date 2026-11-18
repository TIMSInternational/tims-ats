using Tims.Application.Assessments.Providers;

namespace Tims.Api.Assessments;

/// <summary>
/// The webhook inbox worker's schedule (contract step 6: acknowledge first, process asynchronously). It runs
/// <see cref="IProviderInboxWorker"/> from a fresh DI scope as soon as the webhook endpoint commits an event
/// (<see cref="ProviderInboxSignal"/>), and at least every <see cref="Interval"/> otherwise, so a retry that comes due, or an
/// event another instance received, is picked up without a wake-up. Registered ONLY when
/// <c>Platform:AssessmentProvidersEnabled</c> is on (the provider tables exist only then).
///
/// <para>Every App Runner instance runs its own loop: a run processes only the inbox rows it LEASED with one conditional
/// UPDATE (<c>FOR UPDATE SKIP LOCKED</c>, lease free or expired, by the database clock), so two instances never process
/// the same event at once. <see cref="Owner"/> is this process's lease owner id.</para>
///
/// <para>As in <see cref="ProviderAttemptPollHostedService"/>, the catch-all is load-bearing: an exception escaping
/// <c>ExecuteAsync</c> stops the WHOLE host. A failed run is logged and retried at the next tick; the rows stay due.</para>
/// </summary>
/// <param name="tickOverrideForTests">TEST-ONLY: replaces <see cref="Interval"/>.</param>
public sealed class ProviderInboxWorkerHostedService(
    IServiceScopeFactory scopeFactory,
    ProviderInboxSignal signal,
    TimeProvider timeProvider,
    ILogger<ProviderInboxWorkerHostedService> logger,
    TimeSpan? tickOverrideForTests = null) : BackgroundService
{
    /// <summary>Fifteen seconds: the longest a due event waits when no wake-up reaches this instance.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);

    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly ProviderInboxSignal _signal = signal;
    private readonly TimeProvider _timeProvider = timeProvider;
    private readonly ILogger<ProviderInboxWorkerHostedService> _logger = logger;

    /// <summary>This process's lease owner id.</summary>
    public Guid Owner { get; } = Guid.NewGuid();

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await using (var scope = _scopeFactory.CreateAsyncScope())
        {
            _ = scope.ServiceProvider.GetRequiredService<IProviderInboxWorker>();
        }

        await base.StartAsync(cancellationToken).ConfigureAwait(false);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _signal.WaitAsync(tickOverrideForTests ?? Interval, _timeProvider, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var worker = scope.ServiceProvider.GetRequiredService<IProviderInboxWorker>();
                var run = await worker.RunAsync(Owner, _timeProvider.GetUtcNow(), stoppingToken).ConfigureAwait(false);
                if (run.GivenUp > 0 || run.FailedOrganizations > 0)
                {
                    _logger.LogWarning(
                        "assessment provider inbox: {Processed} processed, {Rescheduled} rescheduled, {GivenUp} given up, {FailedOrganizations} organization(s) failed",
                        run.Processed, run.Rescheduled, run.GivenUp, run.FailedOrganizations);
                }
                else if (run.Processed > 0 || run.Rescheduled > 0)
                {
                    _logger.LogInformation(
                        "assessment provider inbox: {Processed} processed, {Rescheduled} rescheduled", run.Processed, run.Rescheduled);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // Rows stay due and leases expire on their own; the next tick retries. NEVER rethrow (see the docblock).
                _logger.LogError(ex, "assessment provider inbox run failed; retrying in {Interval}", Interval);
            }
        }
    }
}
