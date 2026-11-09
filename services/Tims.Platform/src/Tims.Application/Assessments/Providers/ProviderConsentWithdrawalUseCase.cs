using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>The outcome of one propagation pass: how many attempts were confirmed and how many are still pending.</summary>
public sealed record WithdrawalPropagation(int Confirmed, int StillPending);

/// <summary>
/// Owner default D15 (2026-11-08): a #312 recruitment-consent withdrawal reaches the provider. The withdrawal's own
/// transaction already did the local, atomic part (<see cref="IAssessmentProviderRepository.StageConsentWithdrawalAsync"/>'s
/// statement, under the candidate lock): open attempts cancelled, results no longer fetched or stored, and every
/// attempt marked <c>withdrawal_state = pending</c>. This pass does the provider part for the org's pending attempts:
/// <list type="number">
/// <item>an attempt with no recorded provider assignment is looked up by its external_ref (D11): a create answered after
/// the withdrawal is recorded as an orphan, never left live at the provider;</item>
/// <item>each orphan (<see cref="ProviderCleanup.CancelPending"/>) is cancelled at the provider
/// (<c>POST /v1/assignments/{id}/cancel</c>);</item>
/// <item>each active consent of each provider subject is withdrawn
/// (<c>POST /v1/subjects/{id}/consents/{consent_id}/withdrawal</c>), which makes the provider void open sittings and
/// results and delete what D2 says it must;</item>
/// <item>only then is the attempt marked <c>done</c>, by a conditional write on the fence read before the consents were
/// listed and before any lookup (<see cref="WithdrawalFence"/>): a launch that began or ended a consent capture since, or
/// whose capture is still in flight, keeps the attempt pending, so a consent the listing could not see is never left
/// behind by a completed cascade; and so does a create announced and not yet answered (the create fence), so an
/// assignment created after an empty lookup is never left live at the provider.</item>
/// </list>
/// A pass works only on the attempts it CLAIMED under a lease (<see cref="ProviderWithdrawalLeasing"/>), so concurrent
/// passes on several instances never duplicate the provider calls.
/// Anything that fails stays pending and is retried by the next pass: every webhook for such an attempt runs one (and
/// answers 503 while it is still pending, so the provider's 72 h redelivery is the retry queue), so does the next
/// withdrawal in the org, and so does the scheduled sweep (<see cref="ProviderWithdrawalSweepUseCase"/>, every 10
/// minutes) without any trigger. Never throws for a provider-side outcome.
/// </summary>
/// <param name="maxPassDurationForTests">TEST-ONLY: replaces <see cref="ProviderWithdrawalLeasing.MaxPassDuration"/>.</param>
public sealed class ProviderConsentWithdrawalUseCase(
    IAssessmentProviderRepository repository, IAssessmentProvider provider, TimeSpan? maxPassDurationForTests = null)
{
    public const int MaxAttemptsPerPass = 50;

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;
    private readonly TimeSpan _maxPassDuration = maxPassDurationForTests ?? ProviderWithdrawalLeasing.MaxPassDuration;

    /// <summary>Stages the candidate (self-healing path, no-op unless withdrawn), then propagates the org's pending attempts.</summary>
    public async Task<WithdrawalPropagation> StageAndPropagateAsync(
        Guid organizationId, Guid candidateId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await _repository.StageConsentWithdrawalAsync(organizationId, candidateId, now, cancellationToken).ConfigureAwait(false);
        return await PropagateAsync(organizationId, now, cancellationToken).ConfigureAwait(false);
    }

    public async Task<WithdrawalPropagation> PropagateAsync(
        Guid organizationId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (!_provider.IsConfigured)
        {
            // Nothing could be sent; claiming would only hold the attempts away from a pass that can.
            return new WithdrawalPropagation(0, 0);
        }

        // Each pass is its own lease owner and works ONLY on the attempts it claimed: two passes (two instances' sweeps,
        // a sweep and a webhook) never send the same cancels and withdrawals at once. The pass is cut off well before its
        // claims expire, and they are released when it ends, whatever happened.
        var owner = Guid.NewGuid();
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(_maxPassDuration);
        var pending = await _repository.ClaimPendingWithdrawalsAsync(organizationId, owner, MaxAttemptsPerPass, budget.Token)
            .ConfigureAwait(false);
        if (pending.Count == 0)
        {
            return new WithdrawalPropagation(0, 0);
        }

        try
        {
            return await PropagateClaimedAsync(organizationId, pending, now, budget.Token).ConfigureAwait(false);
        }
        finally
        {
            await _repository.ReleaseWithdrawalLeasesAsync(
                organizationId, pending.Select(a => a.Id).ToList(), owner, CancellationToken.None).ConfigureAwait(false);
        }
    }

    private async Task<WithdrawalPropagation> PropagateClaimedAsync(
        Guid organizationId, IReadOnlyList<AttemptRow> pending, DateTimeOffset now, CancellationToken cancellationToken)
    {
        // The fences are read FIRST: before the consents are listed (a launch that begins or ends a consent capture after
        // this read changes the fence, and completion is conditional on it) and before any lookup by external_ref (a
        // create announced and not answered at this read keeps its attempt pending while it may still land, Codex P1).
        var fences = await _repository.ReadWithdrawalFencesAsync(
            organizationId, pending.Select(a => a.Id).ToList(), cancellationToken).ConfigureAwait(false);

        var binding = await _repository.GetActiveBindingAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var blocked = new HashSet<Guid>();
        var current = new List<AttemptRow>();
        foreach (var listed in pending)
        {
            var attempt = listed;
            if (attempt.ProviderAssignmentId is null)
            {
                // An attempt whose create was sent but never answered may exist at the provider: look it up (D11). An
                // empty answer is conclusive only once no create can still be in flight (the fence, above).
                if (binding is null)
                {
                    blocked.Add(attempt.Id);
                    current.Add(attempt);
                    continue;
                }

                var lookup = await _provider.FindAssignmentByExternalRefAsync(
                    binding.ProviderTenantId, attempt.Id.ToString(), cancellationToken).ConfigureAwait(false);
                if (!lookup.Ok)
                {
                    blocked.Add(attempt.Id);
                    current.Add(attempt);
                    continue;
                }

                if (lookup.Value!.Assignment is { } orphan && orphan.Instrument == attempt.Instrument)
                {
                    await _repository.MarkCreatedAsync(organizationId, attempt.Id, orphan, now, cancellationToken)
                        .ConfigureAwait(false);
                    attempt = await _repository.FindAttemptAsync(organizationId, attempt.Id, cancellationToken)
                        .ConfigureAwait(false) ?? attempt;
                }
            }

            if (ProviderCleanup.IsCancelPending(attempt))
            {
                var cancelled = await _provider.CancelAssignmentAsync(attempt.ProviderAssignmentId!.Value, cancellationToken)
                    .ConfigureAwait(false);
                if (cancelled.Ok || cancelled.Failure!.HttpStatus is 404 or 410)
                {
                    await _repository.MarkProviderCancelledAsync(organizationId, attempt.Id, now, cancellationToken)
                        .ConfigureAwait(false);
                }
                else
                {
                    blocked.Add(attempt.Id);
                }
            }

            current.Add(attempt);
        }

        foreach (var subject in current.Where(a => a.ProviderSubjectId is not null).GroupBy(a => a.ProviderSubjectId!.Value))
        {
            if (!await WithdrawSubjectConsentsAsync(subject.Key, now, cancellationToken).ConfigureAwait(false))
            {
                foreach (var attempt in subject)
                {
                    blocked.Add(attempt.Id);
                }
            }
        }

        // A create still announced at the fence read blocks completion unless this pass found and recorded its assignment
        // (the orphan, now cancelled): then the create's answer is on record, and MarkWithdrawalDoneAsync's own condition
        // (create_started_at cleared by that record) re-checks it at the database.
        var confirmed = fences
            .Where(f => !blocked.Contains(f.AttemptId) && f.CaptureAllowsCompletion
                && current.FirstOrDefault(a => a.Id == f.AttemptId) is { } attempt
                && (f.CreateAllowsCompletion || attempt.ProviderAssignmentId is not null))
            .ToList();
        var moved = await _repository.MarkWithdrawalDoneAsync(organizationId, confirmed, now, cancellationToken)
            .ConfigureAwait(false);
        if (moved < pending.Count)
        {
            // What this pass leaves pending goes to the back of the queue, so the next pass (or sweep) tries attempts it
            // has not tried yet instead of the same failing batch forever (Codex release round 2 [P2]).
            await _repository.DeferPendingWithdrawalsAsync(
                organizationId, pending.Select(a => a.Id).ToList(), now, cancellationToken).ConfigureAwait(false);
        }

        return new WithdrawalPropagation(moved, pending.Count - moved);
    }

    private async Task<bool> WithdrawSubjectConsentsAsync(Guid subjectId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var consents = await _provider.ListConsentsAsync(subjectId, cancellationToken).ConfigureAwait(false);
        if (!consents.Ok)
        {
            // An erased or unknown subject holds no consent to withdraw.
            return consents.Failure!.HttpStatus is 404 or 410;
        }

        foreach (var consent in consents.Value!.Where(c => c.Status == "active"))
        {
            var withdrawn = await _provider.WithdrawConsentAsync(subjectId, consent.ConsentId, now, cancellationToken)
                .ConfigureAwait(false);
            if (!withdrawn.Ok && withdrawn.Failure!.HttpStatus is not (404 or 410))
            {
                return false;
            }
        }

        return true;
    }
}
