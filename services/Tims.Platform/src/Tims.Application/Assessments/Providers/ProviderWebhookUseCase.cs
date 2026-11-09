using System.Globalization;
using System.Text.Json;
using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

public enum WebhookOutcome
{
    /// <summary>Verified and durably recorded in the inbox; the inbox worker processes it. 200.</summary>
    Queued,

    /// <summary>Verified, and this event id was already processed or deliberately ignored. 200, nothing re-applied.</summary>
    Duplicate,

    /// <summary>Verified but not for us (unknown tenant or event type). 200 so the sender stops retrying.</summary>
    Ignored,

    /// <summary>Signature, timestamp or envelope rejected. 400, which the contract stops retrying after 3 attempts.</summary>
    Rejected,

    /// <summary>The receiver cannot verify (no secret configured). 503, so the sender retries.</summary>
    RetryLater,
}

public sealed record WebhookResult(WebhookOutcome Outcome, string Reason);

/// <summary>
/// Inbound TIMS Assessments webhooks (<c>tims-assessments.v1.yaml</c> <c>webhooks</c>, step 6: answer 2xx within 10 s and
/// process asynchronously). The request does only what must precede the acknowledgement:
/// <list type="number">
/// <item>Signature over the RAW body with the 300 s replay window (<see cref="WebhookSignature"/>) — nothing is parsed
/// before this.</item>
/// <item>Envelope shape (<c>AssessmentsEventEnvelopeV1</c>), and the <c>TIMS-Event-Id</c>/<c>TIMS-Event-Type</c>
/// headers must equal the signed body's values.</item>
/// <item>The provider tenant must be bound to an org (pre-tenant lookup).</item>
/// <item>The event is COMMITTED to the inbox (unique on org + event id) before the 2xx: the row is the durable record
/// and carries <c>next_attempt_at</c>. A crash after the commit loses nothing; a redelivery of an event already applied
/// is acknowledged without being applied twice.</item>
/// </list>
/// Everything else (reconcile, result fetch, the #312 cascade) runs in the inbox worker
/// (<see cref="ProviderInboxWorkerUseCase"/>, <see cref="ProviderInboxProcessor"/>) under a lease, with retries; the
/// D17 poller stays the backstop. A database failure while recording answers 5xx, so the sender retries.
/// </summary>
public sealed class ProviderWebhookUseCase(
    IAssessmentProviderRepository repository, IAssessmentProvider provider, ProviderInboxSignal? signal = null)
{
    public const int MaxBodyBytes = 65_536;
    public const int MaxDataBytes = 16_384;
    private const string Producer = "tims-assessments";

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;
    private readonly ProviderInboxSignal? _signal = signal;

    public async Task<WebhookResult> HandleAsync(
        ReadOnlyMemory<byte> rawBody, string? signature, string? eventIdHeader, string? eventTypeHeader,
        int? deliveryAttempt, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var check = _provider.VerifyWebhook(signature, rawBody.Span, now);
        if (check == WebhookSignatureCheck.NoSecretConfigured)
        {
            // OUR misconfiguration, not the sender's: 503 keeps the delivery in the provider's retry schedule instead
            // of the 400 that stops it after 3 attempts.
            return new WebhookResult(WebhookOutcome.RetryLater, "receiver_unconfigured");
        }

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

        // Committed before the acknowledgement. A row not yet processed (new, or one a redelivery finds still failing)
        // is due now; the worker is woken so the event is usually applied within seconds.
        var inbox = await _repository.RecordInboxAsync(org, envelope, deliveryAttempt, now, cancellationToken)
            .ConfigureAwait(false);
        if (inbox == InboxOutcome.Done)
        {
            return new WebhookResult(WebhookOutcome.Duplicate, "duplicate_event");
        }

        _signal?.Notify();
        return new WebhookResult(WebhookOutcome.Queued, inbox == InboxOutcome.New ? "queued" : "requeued");
    }

    public static bool TryParseEnvelope(ReadOnlyMemory<byte> rawBody, out ProviderEventEnvelope? envelope, out string? error)
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
