using Tims.Domain.Billing;

namespace Tims.Application.Billing;

/// <summary>
/// Thrown for ANY Stripe webhook signature/secret/header/parse failure — a faithful port of the TS
/// <c>WebhookVerificationError</c>. The endpoint maps it to <b>400</b> (an unverified event is NEVER
/// processed); every other error propagates to <b>500</b> so Stripe retries the delivery.
/// </summary>
public sealed class WebhookVerificationException(string message) : Exception(message);

/// <summary>
/// Thrown by <see cref="IStripeWebhookGateway.CancelSubscriptionAsync"/> when Stripe reports the subscription
/// no longer exists (<c>resource_missing</c>) — the ONLY genuinely-idempotent cancel error the use case
/// swallows (the duplicate is already gone). Every other Stripe error propagates so the endpoint 500s and
/// Stripe retries the cancel (a swallowed failure would leave the duplicate silently billable).
/// </summary>
public sealed class StripeResourceMissingException(string message) : Exception(message);

/// <summary>The webhook dispatch result echoed to Stripe (200 body): <c>{ received, type, handled }</c>.</summary>
public sealed record WebhookResult(bool Received, string Type, bool Handled);

/// <summary>
/// A verified Stripe event, normalized to an infra-free view the <see cref="BillingWebhookUseCase"/>
/// dispatches on (the gateway maps a real <c>Stripe.Event</c> onto this). Exactly one of
/// <see cref="Checkout"/> / <see cref="Subscription"/> is populated for the handled event types; both are
/// null for an unhandled type.
/// </summary>
public sealed record StripeWebhookEvent(
    string Type,
    DateTimeOffset CreatedAt,
    StripeCheckoutData? Checkout,
    StripeSubscriptionSnapshot? Subscription);

/// <summary>
/// The fields of a <c>checkout.session.completed</c> the handler needs. <see cref="MetaOrgId"/> is
/// <c>metadata.orgId ?? client_reference_id</c> (trusted only as a last resort by org resolution).
/// </summary>
public sealed record StripeCheckoutData(string SessionId, string? CustomerId, string? SubscriptionId, string? MetaOrgId);

/// <summary>
/// A Stripe subscription (from a subscription event OR a retrieve) normalized for the handler: the pure
/// <see cref="StripeSubscriptionLike"/> shape (for the kernel mappers) plus the customer id and
/// <c>metadata.orgId</c> the handler resolves the owning org from.
/// </summary>
public sealed record StripeSubscriptionSnapshot(StripeSubscriptionLike Subscription, string? CustomerId, string? MetaOrgId);

/// <summary>
/// Diagnostic signals the webhook emits (the C# analog of the TS <c>logger.warn(...)</c> calls). A PORT
/// (like <c>IJobFailureAlerter</c>/<c>IConnectorSecretStore</c>) so the Application layer stays infra-free;
/// the real ILogger-backed implementation lives in Infrastructure. The signals are observability only — the
/// security-relevant BEHAVIOR (authoritative org resolution, duplicate cancellation) is in the control flow.
/// </summary>
public interface IBillingWebhookLog
{
    /// <summary>A verified event carried a <c>metadata.orgId</c> that disagreed with the recorded owner (never followed).</summary>
    void MetadataOrgMismatch(string by, string metaOrgId, string owner);

    /// <summary>A handled event could not be attributed to any org (no linkage, no usable metadata) — skipped.</summary>
    void UnresolvedOrg(string context, string reference);

    /// <summary>A checkout completed for an org that already has a different live subscription; cancelling the new one.</summary>
    void CancellingDuplicate(string orgId, string duplicateId);

    /// <summary>The duplicate we tried to cancel was already gone at Stripe (<c>resource_missing</c>, swallowed).</summary>
    void DuplicateAlreadyCancelled(string orgId, string duplicateId);

    /// <summary>A subscription event was not applied (duplicate/stale) — informational.</summary>
    void EventNotApplied(string orgId, string incoming, string outcome);
}

/// <summary>No-op <see cref="IBillingWebhookLog"/> (default when none is wired — e.g. unit tests).</summary>
public sealed class NullBillingWebhookLog : IBillingWebhookLog
{
    public static readonly NullBillingWebhookLog Instance = new();

    public void MetadataOrgMismatch(string by, string metaOrgId, string owner)
    {
    }

    public void UnresolvedOrg(string context, string reference)
    {
    }

    public void CancellingDuplicate(string orgId, string duplicateId)
    {
    }

    public void DuplicateAlreadyCancelled(string orgId, string duplicateId)
    {
    }

    public void EventNotApplied(string orgId, string incoming, string outcome)
    {
    }
}
