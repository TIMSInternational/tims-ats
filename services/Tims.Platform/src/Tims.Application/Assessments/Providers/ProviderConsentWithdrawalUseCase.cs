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
/// <item>only then is the attempt marked <c>done</c>, by a conditional write.</item>
/// </list>
/// Anything that fails stays pending and is retried by the next pass: every webhook for such an attempt runs one (and
/// answers 503 while it is still pending, so the provider's 72 h redelivery is the retry queue), and so does the next
/// withdrawal in the org. Never throws for a provider-side outcome.
/// </summary>
public sealed class ProviderConsentWithdrawalUseCase(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    public const int MaxAttemptsPerPass = 50;

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

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
        var pending = await _repository.ListPendingWithdrawalsAsync(organizationId, MaxAttemptsPerPass, cancellationToken)
            .ConfigureAwait(false);
        if (pending.Count == 0 || !_provider.IsConfigured)
        {
            return new WithdrawalPropagation(0, pending.Count);
        }

        var binding = await _repository.GetActiveBindingAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var blocked = new HashSet<Guid>();
        var current = new List<AttemptRow>();
        foreach (var listed in pending)
        {
            var attempt = listed;
            if (attempt.ProviderAssignmentId is null)
            {
                // An attempt whose create was sent but never answered may exist at the provider: look it up (D11).
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

        var confirmed = current.Where(a => !blocked.Contains(a.Id)).Select(a => a.Id).ToList();
        var moved = await _repository.MarkWithdrawalDoneAsync(organizationId, confirmed, now, cancellationToken)
            .ConfigureAwait(false);
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
