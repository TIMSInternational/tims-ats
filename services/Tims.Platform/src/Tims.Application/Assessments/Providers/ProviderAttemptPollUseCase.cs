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
/// A 404 or 410 on the assignment is never read as a state by itself. It is the one answer an erased subject's assignment
/// gives, though, so it is checked with <c>GET /v1/subjects/{id}</c> for the attempt's known subject: when that confirms
/// the erasure (410 <c>subject_erased</c>, or the subject itself reported <c>erasure_pending</c>/<c>erased</c>), the
/// same local erasure as <c>subject.erased</c> is applied (Codex r13 P1: a lost or exhausted webhook must not leave the
/// scores with staff and FIT). Any other answer, or a failed lookup, changes nothing and the attempt is polled again.
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
            // Transient, unconfigured or anything else: nothing is inferred from it, and it is polled again later. A
            // definitive 404/410 is asked about the subject: only a confirmed erasure changes anything.
            return fetched.Failure!.HttpStatus is 404 or 410 && !fetched.Failure.Transient
                && attempt.ProviderSubjectId is { } subjectId
                && await ApplyConfirmedErasureAsync(organizationId, subjectId, now, cancellationToken).ConfigureAwait(false);
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

        var toState = ProviderAttemptPolling.StateFor(assignment.Status) is { } mapped
            && ProviderAttemptStates.CanTransition(attempt.State, mapped)
                ? mapped
                : null;
        var at = toState switch
        {
            ProviderAttemptStates.InProgress => assignment.StartedAt,
            ProviderAttemptStates.Completed => assignment.CompletedAt,
            ProviderAttemptStates.Voided => assignment.VoidedAt,
            _ => null,
        };

        // Round 11 (Codex r11 run 2): a voided assignment that advertises a result is voided only AFTER that result's
        // fetch settles. Voiding first and then failing the fetch transiently would leave a voided attempt with no stored
        // result, which no later poll selects, so the result (and any corrected revision) would never arrive without its
        // webhook. While the fetch keeps failing transiently the attempt keeps its state and is polled again.
        var deferVoid = toState == ProviderAttemptStates.Voided && assignment.ResultId is not null;
        if (toState is not null && !deferVoid)
        {
            changed |= await _repository.AdvanceAttemptAsync(organizationId, attempt.Id, toState, at, now, cancellationToken,
                    toState == ProviderAttemptStates.Voided ? assignment.VoidReason : null)
                .ConfigureAwait(false);
        }

        if (assignment.ResultId is { } resultId)
        {
            var intake = await ProviderResultIntake.FetchAndStoreAsync(
                _repository, _provider, organizationId, polled.ProviderTenantId, attempt, resultId, now, cancellationToken)
                .ConfigureAwait(false);
            changed |= intake.Status == InboxStatuses.Processed;
            // A stored result decides validity through its revisions, and the repository refuses a lifecycle void on an
            // attempt that holds one, so this void lands only when no result could be stored.
            if (deferVoid && !intake.Retry)
            {
                changed |= await _repository.AdvanceAttemptAsync(
                        organizationId, attempt.Id, ProviderAttemptStates.Voided, at, now, cancellationToken,
                        assignment.VoidReason)
                    .ConfigureAwait(false);
            }
        }

        return changed;
    }

    /// <summary>
    /// The assignment is gone: confirms with the provider's subject lookup that the attempt's subject was erased, and only
    /// then applies the webhook's own local erasure (results deleted, every attempt of the subject erased, FIT recomputed,
    /// audited). True when it erased something.
    /// </summary>
    private async Task<bool> ApplyConfirmedErasureAsync(
        Guid organizationId, Guid subjectId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var subject = await _provider.GetSubjectAsync(subjectId, cancellationToken).ConfigureAwait(false);
        var erased = subject.Ok
            ? subject.Value!.SubjectId == subjectId && subject.Value.Status is SubjectErasurePending or SubjectErased
            : subject.Failure!.HttpStatus == 410 && subject.Failure.Code == SubjectErasedCode;
        if (!erased)
        {
            return false;
        }

        return await _repository.EraseSubjectAsync(organizationId, subjectId, now, cancellationToken, via: "poll")
            .ConfigureAwait(false) > 0;
    }

    private const string SubjectErasedCode = "subject_erased";
    private const string SubjectErasurePending = "erasure_pending";
    private const string SubjectErased = "erased";
}
