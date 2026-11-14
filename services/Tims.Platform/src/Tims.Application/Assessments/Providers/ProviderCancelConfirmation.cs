using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>What a lookup by <c>external_ref</c> proved about an attempt's create (owner default D11).</summary>
public enum CreateProbeOutcome
{
    /// <summary>The provider holds an assignment for this attempt (its create landed, the answer was lost).</summary>
    Found,

    /// <summary>Definitive: no assignment, and no create of this attempt can still be in flight.</summary>
    Absent,

    /// <summary>Nothing proved: the lookup failed, no binding, an off-contract answer, or a create may still land.</summary>
    Unknown,
}

public sealed record CreateProbe(CreateProbeOutcome Outcome, ProviderAssignment? Assignment, ProviderFailure? Failure);

/// <summary>Whether a cancelled attempt's cancel is now confirmed (nothing left at the provider), and why not.</summary>
public sealed record CancelConfirmation(bool Confirmed, ProviderFailure? Failure);

/// <summary>
/// Codex ATS P1 (2026-11-11): a <c>pending_create</c> attempt whose create reached the provider but whose answer was lost
/// has no provider ids. Cancelling it locally only would leave a live assignment at the provider that nothing here tracks,
/// and once the create fence went stale the binding could be removed, after which every event for that assignment is
/// ignored. So a cancel of an unmapped attempt first asks the provider (lookup by <c>external_ref</c> = attempt id):
/// found → the ids are recorded and that assignment is cancelled there; definitive not-found → a local cancel; anything
/// else → the attempt is cancelled here with the <see cref="ProviderCleanup.CancelPending"/> marker and NO ids, which
/// blocks the unbind until the staff cancel route or the D17 poller confirms it (this class).
/// </summary>
public static class ProviderCancelConfirmation
{
    /// <summary>
    /// Asks the provider whether this unmapped attempt's create landed. The create fence is read BEFORE the lookup: an
    /// empty answer is definitive only when no create announced at that read can still be in flight.
    /// </summary>
    public static async Task<CreateProbe> ProbeCreateAsync(
        IAssessmentProviderRepository repository, IAssessmentProvider provider, Guid organizationId, AttemptRow attempt,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(provider);
        ArgumentNullException.ThrowIfNull(attempt);
        if (!provider.IsConfigured)
        {
            return Unknown(ProviderFailure.Unconfigured);
        }

        // The org's binding whether or not it is in force: the attempt's tenant at the provider.
        var binding = await repository.GetBindingAsync(organizationId, cancellationToken).ConfigureAwait(false);
        if (binding is null)
        {
            return Unknown(ProviderFailure.Unconfigured);
        }

        var fences = await repository.ReadWithdrawalFencesAsync(organizationId, [attempt.Id], cancellationToken)
            .ConfigureAwait(false);
        var createSettled = fences.FirstOrDefault(f => f.AttemptId == attempt.Id) is not { } fence
            || fence.CreateAllowsCompletion;
        var lookup = await provider.FindAssignmentByExternalRefAsync(
            binding.ProviderTenantId, attempt.Id.ToString(), cancellationToken).ConfigureAwait(false);
        if (!lookup.Ok)
        {
            return new CreateProbe(CreateProbeOutcome.Unknown, null, lookup.Failure);
        }

        if (lookup.Value!.Assignment is { } found)
        {
            return found.Instrument == attempt.Instrument && found.TenantId == binding.ProviderTenantId
                ? new CreateProbe(CreateProbeOutcome.Found, found, null)
                : Unknown(ProviderFailure.ContractViolation);
        }

        return createSettled
            ? new CreateProbe(CreateProbeOutcome.Absent, null, null)
            : Unknown(ProviderFailure.Unavailable);
    }

    /// <summary>
    /// Finishes the cancel of a cancelled attempt that still carries <see cref="ProviderCleanup.CancelPending"/>: with no
    /// ids, the create is probed (found → recorded as the orphan, then cancelled at the provider; absent → the marker is
    /// cleared); with ids, the assignment is cancelled at the provider (a 404/410 is not an obstacle). Every write is the
    /// repository's locked, conditional one, so a concurrent confirmation is harmless.
    /// </summary>
    public static async Task<CancelConfirmation> ConfirmAsync(
        IAssessmentProviderRepository repository, IAssessmentProvider provider, Guid organizationId, AttemptRow attempt,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(provider);
        ArgumentNullException.ThrowIfNull(attempt);
        if (ProviderCleanup.IsCancelUnconfirmed(attempt))
        {
            var probe = await ProbeCreateAsync(repository, provider, organizationId, attempt, cancellationToken)
                .ConfigureAwait(false);
            switch (probe.Outcome)
            {
                case CreateProbeOutcome.Absent:
                    await repository.ConfirmCancelAbsentAsync(organizationId, attempt.Id, now, cancellationToken)
                        .ConfigureAwait(false);
                    return new CancelConfirmation(true, null);
                case CreateProbeOutcome.Unknown:
                    return new CancelConfirmation(false, probe.Failure);
                default:
                    // Recorded as the orphan (ids + the marker): from here on it is an ordinary pending cancel.
                    await repository.MarkCreatedAsync(organizationId, attempt.Id, probe.Assignment!, now, cancellationToken)
                        .ConfigureAwait(false);
                    attempt = await repository.FindAttemptAsync(organizationId, attempt.Id, cancellationToken)
                        .ConfigureAwait(false) ?? attempt;
                    break;
            }
        }

        if (!ProviderCleanup.IsCancelPending(attempt))
        {
            // Nothing left (a concurrent confirmation got there first), or not a pending cancel at all.
            return new CancelConfirmation(attempt.LastErrorCode != ProviderCleanup.CancelPending, null);
        }

        if (!provider.IsConfigured)
        {
            return new CancelConfirmation(false, ProviderFailure.Local(ProviderFailure.Unconfigured, transient: false));
        }

        var cancelled = await provider.CancelAssignmentAsync(attempt.ProviderAssignmentId!.Value, cancellationToken)
            .ConfigureAwait(false);
        if (!cancelled.Ok && cancelled.Failure!.HttpStatus is not (404 or 410))
        {
            return new CancelConfirmation(false, cancelled.Failure);
        }

        await repository.MarkProviderCancelledAsync(organizationId, attempt.Id, now, cancellationToken).ConfigureAwait(false);
        return new CancelConfirmation(true, null);
    }

    private static CreateProbe Unknown(string code) =>
        new(CreateProbeOutcome.Unknown, null, ProviderFailure.Local(code, transient: true));
}
