using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>What one poll did: organizations visited, attempts polled, attempts changed, attempts that failed.</summary>
public sealed record AttemptPoll(int Organizations, int Polled, int Changed, int Failed, int FailedOrganizations);

/// <summary>One run of the D17 polling fallback over every organization.</summary>
public interface IProviderAttemptPoll
{
    /// <param name="owner">This poller's lease owner id (one per process): a claim names it, a release requires it.</param>
    Task<AttemptPoll> RunAsync(Guid owner, DateTimeOffset now, CancellationToken cancellationToken);
}

/// <summary>
/// The D17 polling fallback (owner default 2026-11-08): webhooks are the primary signal, and the ATS also re-reads stale
/// attempts, so no attempt depends on a webhook arriving. Each run:
/// <list type="number">
/// <item>lists, pre-tenant, the organizations holding claimable attempts;</item>
/// <item>per organization, under its tenant scope, CLAIMS one stale attempt at a time with a lease (one conditional UPDATE
/// with <c>FOR UPDATE SKIP LOCKED</c>), polls it within <see cref="ProviderAttemptPolling.MaxPollDuration"/> (then the poll
/// is cancelled) and releases it, up to <see cref="MaxAttemptsPerOrganization"/> per run. One at a time, with the work
/// capped well inside <see cref="ProviderAttemptPolling.LeaseDuration"/>, so a lease never runs out while its owner still
/// works on the attempt: two App Runner instances never poll the same attempt at once;</item>
/// <item>per attempt: <c>GET /v1/assignments/{id}</c>, checked against the attempt (tenant, subject, instrument,
/// external ref); the consent purposes it still lacks are recorded; its status advances the attempt through the same
/// forward-only, locked write a lifecycle webhook uses; a <c>result_id</c> is fetched and stored through the same
/// guarded, revision-ordered write as <c>result.ready</c> (a later revision, such as a void, replaces an older one);</item>
/// <item>releases each lease (conditional on the owner), stamping <c>last_polled_at</c>.</item>
/// </list>
/// A candidate whose #312 withdrawal had not reached the attempt is staged first, and nothing is fetched for it (the
/// cascade and its sweep own it from then on). A failed attempt never stops the others; it is polled again once stale.
/// Nothing here treats a 404 as a state: an unconfirmed or confirmed 404 on the assignment changes nothing.
/// </summary>
/// <param name="maxPollDurationForTests">TEST-ONLY: replaces <see cref="ProviderAttemptPolling.MaxPollDuration"/>.</param>
public sealed class ProviderAttemptPollUseCase(
    IAssessmentProviderRepository repository, IAssessmentProvider provider, TimeSpan? maxPollDurationForTests = null)
    : IProviderAttemptPoll
{
    public const int MaxOrganizations = 200;
    public const int MaxAttemptsPerOrganization = 25;

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;
    private readonly TimeSpan _maxPollDuration = maxPollDurationForTests ?? ProviderAttemptPolling.MaxPollDuration;

    public async Task<AttemptPoll> RunAsync(Guid owner, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (!_provider.IsConfigured)
        {
            // Nothing could be read; claiming would only push every attempt's next poll back.
            return new AttemptPoll(0, 0, 0, 0, 0);
        }

        var organizations = await _repository.ListOrganizationsWithPollableAttemptsAsync(MaxOrganizations, cancellationToken)
            .ConfigureAwait(false);
        int polled = 0, changed = 0, failed = 0, failedOrganizations = 0;
        foreach (var organizationId in organizations)
        {
            for (var claims = 0; claims < MaxAttemptsPerOrganization; claims++)
            {
                IReadOnlyList<PolledAttempt> claimed;
                try
                {
                    claimed = await _repository.ClaimPollableAttemptsAsync(organizationId, owner, 1, cancellationToken)
                        .ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                {
                    failedOrganizations++;
                    break;
                }

                if (claimed.Count == 0)
                {
                    break;
                }

                var polledAttempt = claimed[0];
                polled++;
                using (var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
                {
                    limit.CancelAfter(_maxPollDuration);
                    try
                    {
                        if (await PollOneAsync(organizationId, polledAttempt, now, limit.Token).ConfigureAwait(false))
                        {
                            changed++;
                        }
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                    {
                        // A failure, or a poll past MaxPollDuration (cancelled well before its lease could run out).
                        failed++;
                    }
                }

                // On shutdown the lease is left to expire (LeaseDuration); the next poller then claims it.
                if (cancellationToken.IsCancellationRequested)
                {
                    break;
                }

                await _repository.ReleasePollLeaseAsync(organizationId, polledAttempt.Attempt.Id, owner, cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        return new AttemptPoll(organizations.Count, polled, changed, failed, failedOrganizations);
    }

    /// <summary>Polls one claimed attempt. True when it changed something (state, result or missing consents).</summary>
    public async Task<bool> PollOneAsync(
        Guid organizationId, PolledAttempt polled, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(polled);
        var attempt = polled.Attempt;
        if (attempt.ProviderAssignmentId is not { } assignmentId || attempt.ResultsStopped)
        {
            return false;
        }

        // The self-healing #312 path a webhook also takes: a withdrawn candidate's attempt the withdrawal's own transaction
        // could not see is staged now, under the candidate lock, and nothing of it is fetched.
        if (await _repository.StageConsentWithdrawalAsync(organizationId, attempt.CandidateId, now, cancellationToken)
                .ConfigureAwait(false) > 0)
        {
            return true;
        }

        var fetched = await _provider.GetAssignmentAsync(assignmentId, cancellationToken).ConfigureAwait(false);
        if (!fetched.Ok)
        {
            // Transient, unconfigured, or a 404/410 (confirmed or not): nothing is inferred from it. Polled again later.
            return false;
        }

        var assignment = fetched.Value!;
        if (assignment.AssignmentId != assignmentId || assignment.TenantId != polled.ProviderTenantId
            || assignment.SubjectId != attempt.ProviderSubjectId || assignment.Instrument != attempt.Instrument
            || (assignment.ExternalRef is not null && assignment.ExternalRef != attempt.Id.ToString()))
        {
            // Off contract for this attempt: never applied.
            return false;
        }

        var changed = false;
        var missing = assignment.MissingConsents.Where(ConsentPurposes.IsKnown).Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal).ToList();
        var known = (attempt.MissingConsents ?? []).Order(StringComparer.Ordinal).ToList();
        if (ProviderAttemptStates.IsOpen(attempt.State) && !missing.SequenceEqual(known, StringComparer.Ordinal))
        {
            await _repository.SetMissingConsentsAsync(organizationId, attempt.Id, missing, cancellationToken).ConfigureAwait(false);
            changed = true;
        }

        if (ProviderAttemptPolling.StateFor(assignment.Status) is { } toState
            && ProviderAttemptStates.CanTransition(attempt.State, toState))
        {
            var at = toState switch
            {
                ProviderAttemptStates.InProgress => assignment.StartedAt,
                ProviderAttemptStates.Completed => assignment.CompletedAt,
                ProviderAttemptStates.Voided => assignment.VoidedAt,
                _ => null,
            };
            changed |= await _repository.AdvanceAttemptAsync(organizationId, attempt.Id, toState, at, now, cancellationToken)
                .ConfigureAwait(false);
        }

        if (assignment.ResultId is { } resultId)
        {
            var intake = await ProviderResultIntake.FetchAndStoreAsync(
                _repository, _provider, organizationId, polled.ProviderTenantId, attempt, resultId, now, cancellationToken)
                .ConfigureAwait(false);
            changed |= intake.Status == InboxStatuses.Processed;
        }

        return changed;
    }
}
