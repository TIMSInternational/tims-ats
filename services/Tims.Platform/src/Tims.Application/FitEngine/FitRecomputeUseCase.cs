namespace Tims.Application.FitEngine;

/// <summary>
/// Drains the FIT v2 recompute queue: for each organization with due requests, claims a batch and recomputes each
/// stored row through <see cref="FitEngineWriteUseCase.RecomputeExistingAsync"/> (the same consent guard, FIT v2 lock
/// and in-lock result read as a compute; a row that does not exist is never created). A request is completed (deleted)
/// only at the sequence it was claimed at, so a change that lands during the recompute leaves it queued for the next
/// pass. A failure is recorded on the request, which its lease retries with backoff; after
/// <see cref="MaxAttempts"/> claims it rests until a new change re-arms it. One failing request or organization never
/// stops the others; cancellation stops the pass.
/// </summary>
public sealed class FitRecomputeUseCase(IFitRecomputeQueue queue, FitEngineWriteUseCase compute)
{
    /// <summary>Organizations served per pass.</summary>
    public const int MaxOrganizationsPerPass = 50;

    /// <summary>Requests claimed per organization per pass.</summary>
    public const int MaxRequestsPerOrganization = 25;

    /// <summary>Claims a request gets before it rests (the queue stops offering it until a new change).</summary>
    public const int MaxAttempts = 8;

    private readonly IFitRecomputeQueue _queue = queue;
    private readonly FitEngineWriteUseCase _compute = compute;

    public async Task<FitRecomputeOutcome> RunAsync(
        DateTimeOffset now, bool fitV2Enabled, bool liaScoredAllowed, CancellationToken cancellationToken)
    {
        var organizations = await _queue
            .ListOrganizationsWithDueRequestsAsync(MaxOrganizationsPerPass, cancellationToken)
            .ConfigureAwait(false);
        int recomputed = 0, skipped = 0, failed = 0, failedOrganizations = 0;
        foreach (var organizationId in organizations)
        {
            cancellationToken.ThrowIfCancellationRequested();
            IReadOnlyList<FitRecomputeRequest> claimed;
            try
            {
                claimed = await _queue.ClaimAsync(organizationId, MaxRequestsPerOrganization, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception) when (!cancellationToken.IsCancellationRequested)
            {
                failedOrganizations++;
                continue;
            }

            foreach (var request in claimed)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    var rewritten = await _compute.RecomputeExistingAsync(
                            organizationId, request.CandidateId, request.VacancyId, now, fitV2Enabled,
                            liaScoredAllowed, cancellationToken)
                        .ConfigureAwait(false);
                    await _queue.CompleteAsync(organizationId, request, cancellationToken).ConfigureAwait(false);
                    if (rewritten)
                    {
                        recomputed++;
                    }
                    else
                    {
                        skipped++;
                    }
                }
                catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
                {
                    failed++;
                    await TryRecordFailureAsync(organizationId, request, ex, cancellationToken).ConfigureAwait(false);
                }
            }
        }

        return new FitRecomputeOutcome(organizations.Count, recomputed, skipped, failed, failedOrganizations);
    }

    // The error KIND only (an exception type name): the queue never stores data. A failure to record it is swallowed:
    // the lease already set when the request is retried.
    private async Task TryRecordFailureAsync(
        Guid organizationId, FitRecomputeRequest request, Exception error, CancellationToken cancellationToken)
    {
        try
        {
            await _queue.RecordFailureAsync(organizationId, request, error.GetType().Name, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
        }
    }
}
