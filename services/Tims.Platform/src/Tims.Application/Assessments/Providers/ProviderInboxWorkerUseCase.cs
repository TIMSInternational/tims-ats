using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>What one inbox run did: organizations visited, events processed, rescheduled, given up on, failed to run.</summary>
public sealed record InboxRun(int Organizations, int Processed, int Rescheduled, int GivenUp, int FailedOrganizations);

/// <summary>One pass of the webhook inbox worker over every organization with due events.</summary>
public interface IProviderInboxWorker
{
    /// <param name="owner">This worker's lease owner id (one per process): a claim names it, a completion requires it.</param>
    Task<InboxRun> RunAsync(Guid owner, DateTimeOffset now, CancellationToken cancellationToken);
}

/// <summary>
/// Wakes the inbox worker as soon as the webhook endpoint commits an event, so the 2xx is fast AND the event is usually
/// applied within seconds. In-process only: a lost wake-up delays an event until the worker's next tick, it never loses
/// one (the inbox row is the queue).
/// </summary>
public sealed class ProviderInboxSignal
{
    private TaskCompletionSource _next = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public void Notify() => Interlocked.Exchange(
        ref _next, new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously)).TrySetResult();

    /// <summary>Completes on the next <see cref="Notify"/> or after <paramref name="timeout"/>, whichever comes first.</summary>
    public async Task WaitAsync(TimeSpan timeout, TimeProvider timeProvider, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(timeProvider);
        var notified = Volatile.Read(ref _next).Task;
        using var delayCancel = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var delay = Task.Delay(timeout, timeProvider, delayCancel.Token);
        await Task.WhenAny(notified, delay).ConfigureAwait(false);
        await delayCancel.CancelAsync().ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
    }
}

/// <summary>
/// The webhook inbox worker. Each run lists, pre-tenant, the organizations holding DUE inbox rows (received, or failed
/// and scheduled for a retry, whose <c>next_attempt_at</c> has passed), then per organization CLAIMS one row at a time
/// with a lease (one conditional UPDATE, <c>FOR UPDATE SKIP LOCKED</c>, by the database clock), processes it within
/// <see cref="ProviderInboxProcessing.MaxProcessingDuration"/> and completes it under the same owner:
/// <list type="bullet">
/// <item>processed or ignored: done, never claimed again;</item>
/// <item>a transient failure (an outage, a #312 cascade still pending): rescheduled with exponential backoff
/// (<see cref="ProviderInboxProcessing.NextRetryAt"/>) for up to 72 h, then left <c>failed</c> for operators, with the
/// D17 poller as the backstop for the attempt;</item>
/// <item>a failure a retry cannot fix (invalid data): <c>failed</c>, not rescheduled;</item>
/// <item>an exception or a run past the time budget: rescheduled like a transient failure.</item>
/// </list>
/// Two instances never process one event at once (the lease), and an instance that dies mid-event frees it when the lease
/// expires. Event application is idempotent in any case (forward-only state writes, revision-ordered results).
/// </summary>
/// <param name="maxProcessingDurationForTests">TEST-ONLY: replaces <see cref="ProviderInboxProcessing.MaxProcessingDuration"/>.</param>
public sealed class ProviderInboxWorkerUseCase(
    IAssessmentProviderRepository repository, IAssessmentProvider provider, TimeSpan? maxProcessingDurationForTests = null)
    : IProviderInboxWorker
{
    public const int MaxOrganizations = 200;
    public const int MaxEventsPerOrganization = 50;

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly ProviderInboxProcessor _processor = new(repository, provider);
    private readonly TimeSpan _maxProcessingDuration = maxProcessingDurationForTests ?? ProviderInboxProcessing.MaxProcessingDuration;

    public async Task<InboxRun> RunAsync(Guid owner, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var organizations = await _repository.ListOrganizationsWithDueInboxEventsAsync(MaxOrganizations, cancellationToken)
            .ConfigureAwait(false);
        int processed = 0, rescheduled = 0, givenUp = 0, failedOrganizations = 0;
        foreach (var organizationId in organizations)
        {
            for (var claims = 0; claims < MaxEventsPerOrganization; claims++)
            {
                ClaimedInboxEvent? claimed;
                try
                {
                    claimed = await _repository.ClaimInboxEventAsync(organizationId, owner, cancellationToken)
                        .ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                {
                    failedOrganizations++;
                    break;
                }

                if (claimed is null)
                {
                    break;
                }

                InboxProcessing outcome;
                using (var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
                {
                    limit.CancelAfter(_maxProcessingDuration);
                    try
                    {
                        outcome = await _processor.ProcessAsync(organizationId, claimed.Envelope, now, limit.Token)
                            .ConfigureAwait(false);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                    {
                        outcome = new InboxProcessing(InboxStatuses.Failed,
                            ex is OperationCanceledException ? "processing_timeout" : "processing_error", true);
                    }
                }

                // On shutdown the lease is left to expire; the row is still due, so the next worker claims it.
                if (cancellationToken.IsCancellationRequested)
                {
                    break;
                }

                DateTimeOffset? retryAt = null;
                var code = outcome.Code;
                if (outcome.Retry)
                {
                    retryAt = ProviderInboxProcessing.NextRetryAt(claimed.ProcessingAttempts + 1, claimed.ReceivedAt, now);
                    if (retryAt is null)
                    {
                        code = "retry_exhausted";
                    }
                }

                await _repository.CompleteInboxAsync(
                        organizationId, claimed.Envelope.EventId, owner, outcome.Status, code, retryAt, now, cancellationToken)
                    .ConfigureAwait(false);
                if (!outcome.Retry)
                {
                    processed++;
                }
                else if (retryAt is null)
                {
                    givenUp++;
                }
                else
                {
                    rescheduled++;
                }
            }
        }

        return new InboxRun(organizations.Count, processed, rescheduled, givenUp, failedOrganizations);
    }
}
