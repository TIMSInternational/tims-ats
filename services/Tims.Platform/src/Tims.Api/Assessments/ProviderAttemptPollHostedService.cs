using Tims.Application.Assessments.Providers;

namespace Tims.Api.Assessments;

/// <summary>
/// The D17 polling fallback's schedule: one <see cref="IProviderAttemptPoll"/> run every <see cref="Interval"/>, the first
/// one interval after start, each from a fresh DI scope. Registered ONLY when <c>Platform:AssessmentProvidersEnabled</c>
/// is on (the provider tables exist only then).
///
/// <para>Every App Runner instance runs its own loop, and that is safe by construction, not by idempotency alone: a run
/// polls only the attempts it LEASED with one conditional UPDATE (<c>FOR UPDATE SKIP LOCKED</c>, lease free or expired, by
/// the database clock), so two instances never poll the same attempt at once. <see cref="Owner"/> is this process's lease
/// owner id; an instance that dies mid-run frees its leases when they expire.</para>
///
/// <para>Each tick then runs the <see cref="IProviderErasureSweep"/> (Codex r13 P1), in its own scope and its own catch, so
/// a failed poll never skips it: every subject that still holds a stored result is asked about at most once per
/// configured interval, whatever the result's age. Two instances never ask about one subject in one interval (each
/// check is claimed with a conditional stamp).</para>
///
/// <para>As in <see cref="ProviderWithdrawalSweepHostedService"/>, the catch-all is load-bearing: an exception escaping
/// <c>ExecuteAsync</c> stops the WHOLE host. A failed run is logged and retried at the next tick. The DI graph is resolved
/// once at start, so a broken registration fails the deploy instead of every tick.</para>
/// </summary>
/// <param name="tickOverrideForTests">TEST-ONLY: replaces <see cref="Interval"/>.</param>
public sealed class ProviderAttemptPollHostedService(
    IServiceScopeFactory scopeFactory,
    TimeProvider timeProvider,
    ILogger<ProviderAttemptPollHostedService> logger,
    TimeSpan? tickOverrideForTests = null) : BackgroundService
{
    /// <summary>
    /// Five minutes: a third of <c>ProviderAttemptPolling.StaleAfter</c>, so a stale attempt waits at most about one
    /// interval past its staleness.
    /// </summary>
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly TimeProvider _timeProvider = timeProvider;
    private readonly ILogger<ProviderAttemptPollHostedService> _logger = logger;

    /// <summary>This process's lease owner id.</summary>
    public Guid Owner { get; } = Guid.NewGuid();

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await using (var scope = _scopeFactory.CreateAsyncScope())
        {
            _ = scope.ServiceProvider.GetRequiredService<IProviderAttemptPoll>();
            _ = scope.ServiceProvider.GetRequiredService<IProviderErasureSweep>();
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
                var poll = scope.ServiceProvider.GetRequiredService<IProviderAttemptPoll>();
                var outcome = await poll.RunAsync(Owner, _timeProvider.GetUtcNow(), stoppingToken).ConfigureAwait(false);
                if (outcome.Failed > 0 || outcome.FailedOrganizations > 0)
                {
                    _logger.LogWarning(
                        "assessment provider poll: {Polled} attempt(s) polled, {Changed} changed, {Failed} failed, {FailedOrganizations} organization(s) failed",
                        outcome.Polled, outcome.Changed, outcome.Failed, outcome.FailedOrganizations);
                }
                else if (outcome.Polled > 0)
                {
                    _logger.LogInformation(
                        "assessment provider poll: {Polled} attempt(s) polled, {Changed} changed", outcome.Polled, outcome.Changed);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // Leases expire on their own; the next tick retries. NEVER rethrow (see the class docblock).
                _logger.LogError(ex, "assessment provider poll failed; retrying in {Interval}", Interval);
            }

            if (stoppingToken.IsCancellationRequested)
            {
                return;
            }

            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var sweep = scope.ServiceProvider.GetRequiredService<IProviderErasureSweep>();
                var outcome = await sweep.RunAsync(_timeProvider.GetUtcNow(), stoppingToken).ConfigureAwait(false);
                if (outcome.Failed > 0)
                {
                    _logger.LogWarning(
                        "assessment provider erasure sweep: {Checked} subject(s) checked, {Erased} erased, {Failed} failed",
                        outcome.Checked, outcome.Erased, outcome.Failed);
                }
                else if (outcome.Erased > 0)
                {
                    _logger.LogInformation(
                        "assessment provider erasure sweep: {Checked} subject(s) checked, {Erased} erased",
                        outcome.Checked, outcome.Erased);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // A claimed check stays stamped; that subject is asked again after the interval. NEVER rethrow.
                _logger.LogError(ex, "assessment provider erasure sweep failed; retrying in {Interval}", Interval);
            }
        }
    }
}
