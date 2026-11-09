using System.Globalization;
using System.Text.Json;
using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>What processing one inbox event did: its inbox status, a reason code, and whether to retry it later.</summary>
public sealed record InboxProcessing(string Status, string? Code, bool Retry);

/// <summary>
/// Applies one verified, recorded webhook event (an inbox row) to the provider tables. Runs in the inbox worker, never in
/// the receiving request (contract step 6), so a token fetch, a reconcile read, a result read or a #312 cascade pass never
/// holds the sender's delivery open. Payloads are minimal by contract (ids, versions, timestamps): scores are fetched with
/// <c>GET /v1/results/{id}</c>, where the provider enforces visibility for <c>tenant_hr</c>, and validated against the
/// attempt before storage. A transient failure answers <see cref="InboxProcessing.Retry"/>; the worker reschedules the
/// row, which stays the durable record until it is processed, ignored or given up on.
/// </summary>
public sealed class ProviderInboxProcessor(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;
    private readonly ProviderConsentWithdrawalUseCase _withdrawal = new(repository, provider);

    public async Task<InboxProcessing> ProcessAsync(
        Guid organizationId, ProviderEventEnvelope envelope, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        var (status, code, retry) = await ProcessCoreAsync(organizationId, envelope, now, cancellationToken)
            .ConfigureAwait(false);
        return new InboxProcessing(status, code, retry);
    }

    private async Task<(string Status, string? Code, bool Retry)> ProcessCoreAsync(
        Guid organizationId, ProviderEventEnvelope envelope, DateTimeOffset now, CancellationToken cancellationToken)
    {
        using var document = JsonDocument.Parse(envelope.DataJson);
        var data = document.RootElement;

        if (envelope.EventType == ProviderEventTypes.SubjectErased)
        {
            if (!TryGuid(data, "subject_id", out var subjectId))
            {
                return (InboxStatuses.Failed, "invalid_data", false);
            }

            await _repository.EraseSubjectAsync(organizationId, subjectId, now, cancellationToken).ConfigureAwait(false);
            return (InboxStatuses.Processed, null, false);
        }

        if (!TryGuid(data, "assignment_id", out var assignmentId))
        {
            return (InboxStatuses.Failed, "invalid_data", false);
        }

        var attempt = await _repository.FindAttemptByProviderAssignmentAsync(organizationId, assignmentId, cancellationToken)
            .ConfigureAwait(false);
        if (attempt is null)
        {
            var (reconciled, code, retry) = await ReconcileAsync(
                organizationId, envelope.ProviderTenantId, assignmentId, now, cancellationToken).ConfigureAwait(false);
            if (retry)
            {
                return (InboxStatuses.Failed, code, true);
            }

            if (reconciled is null)
            {
                return (InboxStatuses.Ignored, "unknown_assignment", false);
            }

            attempt = reconciled;
        }

        // #312 reaches the provider (owner default D15, 2026-11-08). An attempt of a withdrawn candidate that the
        // withdrawal's own transaction could not see (a same-email sibling reserved concurrently) is staged now, under
        // the candidate lock; then a pending cascade is driven forward, and the event answers 503 until the provider
        // confirmed it, so the provider's redelivery is the retry queue. Nothing of the event is applied, and no result
        // is ever fetched for a withdrawn attempt.
        if (attempt.WithdrawalState is null
            && await _repository.StageConsentWithdrawalAsync(organizationId, attempt.CandidateId, now, cancellationToken)
                .ConfigureAwait(false) > 0)
        {
            attempt = await _repository.FindAttemptAsync(organizationId, attempt.Id, cancellationToken).ConfigureAwait(false)
                ?? attempt;
        }

        if (attempt.WithdrawalState == ProviderWithdrawalStates.Pending)
        {
            await _withdrawal.PropagateAsync(organizationId, now, cancellationToken).ConfigureAwait(false);
            var after = await _repository.FindAttemptAsync(organizationId, attempt.Id, cancellationToken).ConfigureAwait(false);
            return after?.WithdrawalState == ProviderWithdrawalStates.Pending
                ? (InboxStatuses.Failed, "withdrawal_pending", true)
                : (InboxStatuses.Ignored, "consent_withdrawn", false);
        }

        if (ProviderCleanup.IsCancelPending(attempt))
        {
            // An event for the orphaned assignment of a cancelled attempt whose cancel at the provider is not confirmed
            // yet: retry that cancel (an outage retries the delivery), and apply nothing.
            var cancelled = await _provider.CancelAssignmentAsync(attempt.ProviderAssignmentId!.Value, cancellationToken)
                .ConfigureAwait(false);
            if (!cancelled.Ok && (cancelled.Failure!.Transient || cancelled.Failure.Code == ProviderFailure.Unconfigured))
            {
                return (InboxStatuses.Failed, cancelled.Failure.Code, true);
            }

            if (cancelled.Ok || cancelled.Failure!.HttpStatus is 404 or 410)
            {
                await _repository.MarkProviderCancelledAsync(organizationId, attempt.Id, now, cancellationToken).ConfigureAwait(false);
                return (InboxStatuses.Ignored, "orphan_cancelled", false);
            }

            // A refusal a redelivery would not change: the event is acknowledged (recorded as failed for operators), but
            // the cleanup marker stays on the attempt, so the staff cancel route (and any later event) retries the cancel.
            return (InboxStatuses.Failed, "orphan_cancel_" + cancelled.Failure.Code, false);
        }

        if (attempt.ResultsStopped)
        {
            // Withdrawn (cascade confirmed) or an ATS-initiated erasure requested: never fetched or applied again.
            return (InboxStatuses.Ignored, attempt.WithdrawalState is not null ? "consent_withdrawn" : "erasure_requested", false);
        }

        switch (envelope.EventType)
        {
            case ProviderEventTypes.AssignmentStarted:
                await _repository.AdvanceAttemptAsync(organizationId, attempt.Id, ProviderAttemptStates.InProgress,
                    TryTimestamp(data, "started_at"), now, cancellationToken).ConfigureAwait(false);
                return (InboxStatuses.Processed, null, false);
            case ProviderEventTypes.SessionCompleted:
                await _repository.AdvanceAttemptAsync(organizationId, attempt.Id, ProviderAttemptStates.Completed,
                    TryTimestamp(data, "completed_at"), now, cancellationToken).ConfigureAwait(false);
                return (InboxStatuses.Processed, null, false);
            case ProviderEventTypes.SessionVoided:
            case ProviderEventTypes.AssignmentVoided:
                await _repository.AdvanceAttemptAsync(organizationId, attempt.Id, ProviderAttemptStates.Voided,
                    TryTimestamp(data, "voided_at"), now, cancellationToken).ConfigureAwait(false);
                return (InboxStatuses.Processed, null, false);
            case ProviderEventTypes.AssignmentExpired:
                await _repository.AdvanceAttemptAsync(organizationId, attempt.Id, ProviderAttemptStates.Expired,
                    TryTimestamp(data, "expired_at"), now, cancellationToken).ConfigureAwait(false);
                return (InboxStatuses.Processed, null, false);
            case ProviderEventTypes.ResultReady:
                return await ApplyResultAsync(organizationId, envelope, attempt, data, now, cancellationToken)
                    .ConfigureAwait(false);
            default:
                return (InboxStatuses.Ignored, "unknown_event_type", false);
        }
    }

    /// <summary>
    /// An event for an assignment no attempt records. Usually not ours (ignored), but it can be an assignment the ATS
    /// created and then crashed before storing its id: the attempt is still <c>pending_create</c>. The provider's copy
    /// carries <c>external_ref</c> = the attempt id, so the mapping is restored here and the event applied, instead of
    /// being acknowledged and lost. A provider outage while checking answers retry.
    /// </summary>
    private async Task<(AttemptRow? Attempt, string? Code, bool Retry)> ReconcileAsync(
        Guid organizationId, Guid providerTenantId, Guid assignmentId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var fetched = await _provider.GetAssignmentAsync(assignmentId, cancellationToken).ConfigureAwait(false);
        if (!fetched.Ok)
        {
            var failure = fetched.Failure!;
            return failure.Transient || failure.Code == ProviderFailure.Unconfigured
                ? (null, failure.Code, true)
                : (null, null, false);
        }

        var assignment = fetched.Value!;
        if (assignment.AssignmentId != assignmentId || assignment.TenantId != providerTenantId
            || !Guid.TryParseExact(assignment.ExternalRef, "D", out var attemptId))
        {
            return (null, null, false);
        }

        var pending = await _repository.FindAttemptAsync(organizationId, attemptId, cancellationToken).ConfigureAwait(false);
        if (pending is null || pending.Instrument != assignment.Instrument)
        {
            return (null, null, false);
        }

        var unmapped = pending.State == ProviderAttemptStates.PendingCreate
            || (pending.State == ProviderAttemptStates.Cancelled && pending.ProviderAssignmentId is null);
        if (!unmapped)
        {
            // The assign request committed this very mapping between our lookup by assignment id and this read: the
            // attempt is ours and current, so the event applies to it. Mapped to anything else, it is not ours.
            return pending.ProviderAssignmentId == assignmentId ? (pending, null, false) : (null, null, false);
        }

        // Record the mapping under the attempt lock BEFORE anything else is sent to the provider. A pending attempt
        // becomes created. A cancelled one (staff cancelled it before its create's answer was recorded) keeps its
        // state and gets the ids plus the ProviderCleanup.CancelPending marker, so the orphan is durable: the cancel at
        // the provider then runs in ProcessAsync's cleanup branch, and if it fails, the staff cancel route and any later
        // event retry it. Cancelling first and recording nothing would lose the orphan on any failure.
        await _repository.MarkCreatedAsync(organizationId, attemptId, assignment, now, cancellationToken).ConfigureAwait(false);
        var recorded = await _repository.FindAttemptAsync(organizationId, attemptId, cancellationToken).ConfigureAwait(false);
        return recorded is not null && recorded.ProviderAssignmentId == assignmentId ? (recorded, null, false) : (null, null, false);
    }

    private async Task<(string Status, string? Code, bool Retry)> ApplyResultAsync(
        Guid organizationId, ProviderEventEnvelope envelope, AttemptRow attempt, JsonElement data, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!TryGuid(data, "result_id", out var resultId))
        {
            return (InboxStatuses.Failed, "invalid_data", false);
        }

        var intake = await ProviderResultIntake.FetchAndStoreAsync(
            _repository, _provider, organizationId, envelope.ProviderTenantId, attempt, resultId, now, cancellationToken)
            .ConfigureAwait(false);
        return (intake.Status, intake.Code, intake.Retry);
    }

    private static bool TryGuid(JsonElement obj, string name, out Guid value)
    {
        value = Guid.Empty;
        return obj.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.String
            && Guid.TryParseExact(node.GetString(), "D", out value);
    }

    private static DateTimeOffset? TryTimestamp(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.String
        && DateTimeOffset.TryParse(node.GetString(), CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value)
            ? value
            : null;
}
