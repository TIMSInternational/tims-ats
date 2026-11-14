using System.Text.Json.Nodes;
using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>
/// The provider work of one organization that an unbind must not strand: sittings that have not finished
/// (<see cref="Cancellable"/>), finished sittings still waiting for their result (<see cref="AwaitingResult"/>), #312
/// withdrawals not yet confirmed at the provider (<see cref="PendingWithdrawals"/>), orphaned provider assignments not
/// yet confirmed cancelled, including staff cancels whose lost create could not be ruled out yet and that therefore
/// carry no provider ids (<see cref="CancelPending"/>), and creates announced and still live
/// (<see cref="CreatesInFlight"/>). After an unbind the ATS no longer receives the provider's events for the org, so
/// each would be left behind.
/// </summary>
public sealed record ProviderOpenWork(
    int Cancellable, int AwaitingResult, int PendingWithdrawals, int CancelPending, int CreatesInFlight)
{
    public static readonly ProviderOpenWork None = new(0, 0, 0, 0, 0);

    public bool Any => Cancellable + AwaitingResult + PendingWithdrawals + CancelPending + CreatesInFlight > 0;
}

/// <summary>
/// An organization's provider binding as the platform owner sees it. <see cref="Bound"/>: a binding row exists;
/// <see cref="Active"/>: it is in force (assignments, events and polling). An inactive binding keeps its provider tenant
/// so DSAR export and erasure still reach the provider.
/// </summary>
public sealed record ProviderBindingState(
    bool Bound,
    bool Active,
    Guid? ProviderTenantId,
    IReadOnlyList<string> EnabledInstruments,
    string? DefaultLocale,
    DateTimeOffset? UpdatedAt,
    ProviderOpenWork OpenWork);

public enum ProviderUnbindOutcome
{
    Unbound,
    OrganizationNotFound,

    /// <summary>No binding in force (never bound, or already unbound).</summary>
    NotBound,

    /// <summary>Open work remains (<see cref="ProviderUnbindResult.OpenWork"/>); nothing was unbound.</summary>
    Blocked,
}

/// <param name="Cancelled">Open sittings this request cancelled at the provider and in the ATS.</param>
/// <param name="CancelFailed">Open sittings this request tried to cancel and could not (they still block).</param>
public sealed record ProviderUnbindResult(
    ProviderUnbindOutcome Outcome, ProviderOpenWork OpenWork, int Cancelled, int CancelFailed);

/// <summary>
/// Platform-owner administration of an organization's provider binding (round 12; the runbook found no tool): read its
/// state with the open work an unbind would strand, and unbind it SAFELY. An unbind never strands work: by default it is
/// refused while any open work exists; with <c>cancelOpenAttempts</c> (the confirmation the console asks for) it first
/// cancels every sitting that has not finished, through the same path as HR's cancel (at the provider first), and then
/// unbinds only if nothing is left. The final check and the deactivation are one transaction under the binding lock that
/// every assignment's reserve also takes, so no assignment can slip in between. Results and attempts already stored are
/// kept; DSAR export and erasure keep working through the inactive binding's provider tenant.
/// </summary>
public sealed class ProviderBindingAdminUseCase(
    IAssessmentProviderRepository repository, CancelProviderAttemptUseCase cancel)
{
    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly CancelProviderAttemptUseCase _cancel = cancel;

    public async Task<ProviderBindingState?> GetStateAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        if (await _repository.GetActiveOrganizationNameAsync(organizationId, cancellationToken).ConfigureAwait(false) is null)
        {
            return null;
        }

        return await _repository.GetBindingStateAsync(organizationId, cancellationToken).ConfigureAwait(false);
    }

    public async Task<ProviderUnbindResult> UnbindAsync(
        Guid organizationId, Guid actorId, bool cancelOpenAttempts, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (await _repository.GetActiveOrganizationNameAsync(organizationId, cancellationToken).ConfigureAwait(false) is null)
        {
            return new ProviderUnbindResult(ProviderUnbindOutcome.OrganizationNotFound, ProviderOpenWork.None, 0, 0);
        }

        var state = await _repository.GetBindingStateAsync(organizationId, cancellationToken).ConfigureAwait(false);
        if (state is not { Active: true })
        {
            return new ProviderUnbindResult(ProviderUnbindOutcome.NotBound, state?.OpenWork ?? ProviderOpenWork.None, 0, 0);
        }

        var (cancelled, failed) = (0, 0);
        if (cancelOpenAttempts)
        {
            foreach (var attempt in await _repository.ListCancellableAttemptsAsync(organizationId, cancellationToken)
                         .ConfigureAwait(false))
            {
                var result = await _cancel.CancelAsync(organizationId, actorId, attempt, now, cancellationToken)
                    .ConfigureAwait(false);
                if (result.Outcome == ProviderCancelOutcome.Cancelled)
                {
                    cancelled++;
                }
                else if (result.Outcome != ProviderCancelOutcome.NotFound)
                {
                    failed++;
                }
            }
        }

        var unbound = await _repository.DeactivateBindingAsync(organizationId, actorId, now, cancellationToken)
            .ConfigureAwait(false);
        return unbound switch
        {
            null => new ProviderUnbindResult(ProviderUnbindOutcome.NotBound, ProviderOpenWork.None, cancelled, failed),
            { Any: true } => new ProviderUnbindResult(ProviderUnbindOutcome.Blocked, unbound, cancelled, failed),
            _ => new ProviderUnbindResult(ProviderUnbindOutcome.Unbound, ProviderOpenWork.None, cancelled, failed),
        };
    }

    /// <summary>Strict body: <c>{ "cancelOpenAttempts": bool }</c>; an empty body means false.</summary>
    public static bool TryParseUnbindBody(JsonNode? node, out bool cancelOpenAttempts)
    {
        cancelOpenAttempts = false;
        if (node is null)
        {
            return true;
        }

        if (node is not JsonObject body || body.Any(p => p.Key is not "cancelOpenAttempts"))
        {
            return false;
        }

        if (body["cancelOpenAttempts"] is not { } flag)
        {
            return true;
        }

        return flag is JsonValue value && value.TryGetValue(out cancelOpenAttempts);
    }
}
