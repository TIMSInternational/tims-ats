using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

public enum ProviderCancelOutcome
{
    /// <summary>The attempt no longer blocks a re-assignment (cancelled, or a concurrent void/expiry got there first).</summary>
    Cancelled,
    NotFound,

    /// <summary>The sitting has finished (completed or scored): its result stands; a cancel would not undo it.</summary>
    NotCancellable,
    ProviderUnconfigured,
    ProviderUnavailable,
    ProviderRefused,
}

public sealed record ProviderCancelResult(ProviderCancelOutcome Outcome, ProviderAssignItem? Item, string? Detail);

/// <summary>
/// HR cancels one provider attempt that has not finished, for example to re-assign it with a corrected accommodation
/// (an open attempt with other terms blocks a new assignment of the same instrument). Order:
/// <list type="number">
/// <item>The attempt exists in the caller's org (the endpoint also checks the caller's vacancy scope); a cancelled one
/// answers again idempotently.</item>
/// <item>Only an attempt whose sitting has not finished is cancellable.</item>
/// <item>An attempt the provider holds is cancelled THERE first (idempotent; it voids an in-progress session and
/// releases the reserved use). An outage changes nothing locally; a provider that no longer knows the assignment
/// (404/410) is not an obstacle.</item>
/// <item>Then the attempt is cancelled under its lock with an audit row. A <c>pending_create</c> attempt has nothing
/// at the provider to cancel yet: if its create was in flight, the assign request (or a later webhook, on
/// reconciliation) cancels the provider's assignment when it finds the attempt cancelled.</item>
/// </list>
/// Nothing here rejects a candidate.
/// </summary>
public sealed class CancelProviderAttemptUseCase(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

    /// <summary>The attempt in the caller's org, or null; the endpoint checks its vacancy against the caller's scope.</summary>
    public Task<AttemptRow?> FindAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken) =>
        _repository.FindAttemptAsync(organizationId, attemptId, cancellationToken);

    public async Task<ProviderCancelResult> CancelAsync(
        Guid organizationId, Guid actorId, AttemptRow attempt, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(attempt);
        if (attempt.State == ProviderAttemptStates.Cancelled)
        {
            return new ProviderCancelResult(ProviderCancelOutcome.Cancelled, AssignProviderInstrumentsUseCase.ToItem(attempt, null), null);
        }

        // Two rounds at most: the provider ids are attached once (pending_create -> created), so an attempt can be mapped
        // under us at most once — the second round cancels that assignment at the provider before the local cancel.
        for (var round = 0; round < 2; round++)
        {
            if (!ProviderAttemptStates.IsCancellable(attempt.State))
            {
                return new ProviderCancelResult(ProviderCancelOutcome.NotCancellable, null, attempt.State);
            }

            var cancelledAtProvider = false;
            if (attempt.ProviderAssignmentId is { } assignmentId)
            {
                if (!_provider.IsConfigured)
                {
                    return new ProviderCancelResult(ProviderCancelOutcome.ProviderUnconfigured, null, null);
                }

                var cancelled = await _provider.CancelAssignmentAsync(assignmentId, cancellationToken).ConfigureAwait(false);
                if (!cancelled.Ok)
                {
                    var failure = cancelled.Failure!;
                    if (failure.Transient)
                    {
                        return new ProviderCancelResult(ProviderCancelOutcome.ProviderUnavailable, null, failure.Code);
                    }

                    if (failure.HttpStatus == 409)
                    {
                        return new ProviderCancelResult(ProviderCancelOutcome.NotCancellable, null, failure.Code);
                    }

                    if (failure.HttpStatus is not (404 or 410))
                    {
                        return new ProviderCancelResult(ProviderCancelOutcome.ProviderRefused, null, failure.Code);
                    }
                }
                else
                {
                    cancelledAtProvider = true;
                }
            }

            var state = await _repository.MarkCancelledAsync(
                organizationId, attempt.Id, attempt.ProviderAssignmentId, actorId, cancelledAtProvider, now, cancellationToken)
                .ConfigureAwait(false);
            if (state is null)
            {
                return new ProviderCancelResult(ProviderCancelOutcome.NotFound, null, null);
            }

            if (ProviderAttemptStates.IsCancellable(state))
            {
                // The create was answered between our read and the lock: the attempt now names a provider assignment we
                // have not cancelled. Re-read it and cancel that one first.
                attempt = await _repository.FindAttemptAsync(organizationId, attempt.Id, cancellationToken).ConfigureAwait(false)
                    ?? attempt with { State = state };
                continue;
            }

            if (ProviderAttemptStates.IsOpen(state))
            {
                // A webhook finished the sitting between our read and the lock: its result stands.
                return new ProviderCancelResult(ProviderCancelOutcome.NotCancellable, null, state);
            }

            var current = await _repository.FindAttemptAsync(organizationId, attempt.Id, cancellationToken).ConfigureAwait(false);
            return new ProviderCancelResult(
                ProviderCancelOutcome.Cancelled,
                AssignProviderInstrumentsUseCase.ToItem(current ?? attempt with { State = state }, null),
                null);
        }

        // Mapped under us twice cannot happen (ids are attached once); refuse rather than cancel blind.
        return new ProviderCancelResult(ProviderCancelOutcome.ProviderUnavailable, null, "attempt_changed");
    }
}
