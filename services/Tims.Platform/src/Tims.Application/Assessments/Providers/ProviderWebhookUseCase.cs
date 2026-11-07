using System.Globalization;
using System.Text.Json;
using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

public enum WebhookOutcome
{
    /// <summary>Verified and processed (or recorded as failed for operators; retrying would not help). 200.</summary>
    Accepted,

    /// <summary>Verified, and this event id was already handled. 200, nothing re-applied.</summary>
    Duplicate,

    /// <summary>Verified but not for us (unknown tenant, assignment or event type). 200 so the sender stops retrying.</summary>
    Ignored,

    /// <summary>Signature, timestamp or envelope rejected. 400, which the contract stops retrying after 3 attempts.</summary>
    Rejected,

    /// <summary>A dependency failed while processing; the inbox row stays retryable. 503, so the sender retries.</summary>
    RetryLater,
}

public sealed record WebhookResult(WebhookOutcome Outcome, string Reason);

/// <summary>
/// Inbound TIMS Assessments webhooks (<c>tims-assessments.v1.yaml</c> <c>webhooks</c>). Order of checks:
/// <list type="number">
/// <item>Signature over the RAW body with the 300 s replay window (<see cref="WebhookSignature"/>) — nothing is parsed
/// before this.</item>
/// <item>Envelope shape (<c>AssessmentsEventEnvelopeV1</c>), and the <c>TIMS-Event-Id</c>/<c>TIMS-Event-Type</c>
/// headers must equal the signed body's values.</item>
/// <item>The provider tenant must be bound to an org (pre-tenant lookup); everything after runs under that org.</item>
/// <item>De-duplication on the event id through the inbox's unique key: a redelivery inside the replay window, or a
/// provider replay, is acknowledged without being applied twice.</item>
/// </list>
/// Payloads are minimal by contract (ids, versions, timestamps). Scores are fetched with <c>GET /v1/results/{id}</c>,
/// where the provider enforces visibility for <c>tenant_hr</c>, and validated against the attempt before storage.
///
/// <para>Processing is synchronous within the request (one bounded provider GET for <c>result.ready</c>) instead of the
/// contract's suggested queue: a transient failure answers 503 and the provider's at-least-once retries (72 h) are the
/// queue. The inbox row makes every retry idempotent.</para>
/// </summary>
public sealed class ProviderWebhookUseCase(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    public const int MaxBodyBytes = 65_536;
    public const int MaxDataBytes = 16_384;
    private const string Producer = "tims-assessments";

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

    public async Task<WebhookResult> HandleAsync(
        ReadOnlyMemory<byte> rawBody, string? signature, string? eventIdHeader, string? eventTypeHeader,
        int? deliveryAttempt, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var check = _provider.VerifyWebhook(signature, rawBody.Span, now);
        if (check != WebhookSignatureCheck.Valid)
        {
            return new WebhookResult(WebhookOutcome.Rejected, "signature_" + check.ToString().ToLowerInvariant());
        }

        if (!TryParseEnvelope(rawBody, out var envelope, out var envelopeError))
        {
            return new WebhookResult(WebhookOutcome.Rejected, envelopeError!);
        }

        if (!Guid.TryParseExact(eventIdHeader, "D", out var headerId) || headerId != envelope!.EventId
            || !string.Equals(eventTypeHeader, envelope.EventType, StringComparison.Ordinal))
        {
            return new WebhookResult(WebhookOutcome.Rejected, "header_mismatch");
        }

        // Event types are an extensible enum: a type this connector does not know is acknowledged, not failed.
        if (!ProviderEventTypes.IsKnown(envelope.EventType))
        {
            return new WebhookResult(WebhookOutcome.Ignored, "unknown_event_type");
        }

        var organizationId = await _repository.FindOrganizationByProviderTenantAsync(envelope.ProviderTenantId, cancellationToken)
            .ConfigureAwait(false);
        if (organizationId is not { } org)
        {
            return new WebhookResult(WebhookOutcome.Ignored, "unknown_tenant");
        }

        var inbox = await _repository.RecordInboxAsync(org, envelope, deliveryAttempt, now, cancellationToken)
            .ConfigureAwait(false);
        if (inbox == InboxOutcome.Done)
        {
            return new WebhookResult(WebhookOutcome.Duplicate, "duplicate_event");
        }

        var (status, code, retry) = await ProcessAsync(org, envelope, now, cancellationToken).ConfigureAwait(false);
        await _repository.CompleteInboxAsync(org, envelope.EventId, status, code, now, cancellationToken).ConfigureAwait(false);
        if (retry)
        {
            return new WebhookResult(WebhookOutcome.RetryLater, code ?? "retry");
        }

        return status == InboxStatuses.Ignored
            ? new WebhookResult(WebhookOutcome.Ignored, code ?? "ignored")
            : new WebhookResult(WebhookOutcome.Accepted, code ?? "processed");
    }

    private async Task<(string Status, string? Code, bool Retry)> ProcessAsync(
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
            return (InboxStatuses.Ignored, "unknown_assignment", false);
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

    private async Task<(string Status, string? Code, bool Retry)> ApplyResultAsync(
        Guid organizationId, ProviderEventEnvelope envelope, AttemptRow attempt, JsonElement data, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!TryGuid(data, "result_id", out var resultId))
        {
            return (InboxStatuses.Failed, "invalid_data", false);
        }

        var fetched = await _provider.GetResultAsync(resultId, cancellationToken).ConfigureAwait(false);
        if (!fetched.Ok)
        {
            var failure = fetched.Failure!;
            if (failure.Transient)
            {
                return (InboxStatuses.Failed, failure.Code, true);
            }

            if (failure.Code == "result_not_visible")
            {
                // tenant_hr may see the status only: the attempt is finished, but there is nothing to store or score.
                await _repository.AdvanceAttemptAsync(organizationId, attempt.Id, ProviderAttemptStates.ResultReady,
                    null, now, cancellationToken).ConfigureAwait(false);
                return (InboxStatuses.Processed, failure.Code, false);
            }

            return failure.HttpStatus is 404 or 410
                ? (InboxStatuses.Ignored, "result_gone", false)
                : (InboxStatuses.Failed, failure.Code, false);
        }

        var result = fetched.Value!;
        var matches = result.ResultId == resultId
            && result.TenantId == envelope.ProviderTenantId
            && result.AssignmentId == attempt.ProviderAssignmentId
            && result.Instrument == attempt.Instrument
            && result.Purpose == "selection"
            && result.ExternalVacancyRef == attempt.VacancyId.ToString()
            && result.RenderedFor == "tenant_hr";
        if (!matches)
        {
            return (InboxStatuses.Failed, "result_mismatch", false);
        }

        await _repository.StoreResultAsync(organizationId, attempt, result, now, cancellationToken).ConfigureAwait(false);
        return (InboxStatuses.Processed, null, false);
    }

    internal static bool TryParseEnvelope(ReadOnlyMemory<byte> rawBody, out ProviderEventEnvelope? envelope, out string? error)
    {
        envelope = null;
        error = "invalid_envelope";
        if (rawBody.Length is 0 or > MaxBodyBytes)
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(rawBody, new JsonDocumentOptions { MaxDepth = 32 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !TryGuid(root, "event_id", out var eventId)
                || !TryGuid(root, "tenant_id", out var tenantId)
                || !root.TryGetProperty("event_type", out var type) || type.ValueKind != JsonValueKind.String
                || type.GetString() is not { Length: > 0 and <= 64 } eventType
                || !root.TryGetProperty("event_version", out var version) || !version.TryGetInt32(out var v) || v != 1
                || !root.TryGetProperty("producer", out var producer) || producer.ValueKind != JsonValueKind.String
                || producer.GetString() != Producer
                || TryTimestamp(root, "occurred_at") is not { } occurredAt
                || !root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            var dataJson = data.GetRawText();
            if (dataJson.Length > MaxDataBytes)
            {
                return false;
            }

            envelope = new ProviderEventEnvelope(eventId, eventType, occurredAt, tenantId, dataJson);
            error = null;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
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
