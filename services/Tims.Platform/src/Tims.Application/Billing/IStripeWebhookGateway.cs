namespace Tims.Application.Billing;

/// <summary>
/// The Stripe API boundary the webhook use case depends on — a port so the Application layer stays infra-free
/// and testable with a fake (the real Stripe.net implementation lives in Infrastructure). Mirrors the TS
/// <c>constructWebhookEvent</c> + <c>getStripe().subscriptions.retrieve/cancel</c> surface.
/// </summary>
public interface IStripeWebhookGateway
{
    /// <summary>
    /// Verify the Stripe signature over the RAW body and parse the event, normalized to
    /// <see cref="StripeWebhookEvent"/>. Throws <see cref="WebhookVerificationException"/> on a missing
    /// secret/header, a bad signature, or a parse failure — the endpoint turns that into a 400.
    /// </summary>
    StripeWebhookEvent ConstructEvent(string rawBody, string? signature);

    /// <summary>Retrieve a subscription (the checkout path re-reads it authoritatively before applying it).</summary>
    Task<StripeSubscriptionSnapshot> RetrieveSubscriptionAsync(string subscriptionId, CancellationToken cancellationToken);

    /// <summary>
    /// Cancel a subscription at Stripe (a duplicate at checkout). Throws
    /// <see cref="StripeResourceMissingException"/> when it is already gone (the only swallowed case); any
    /// other Stripe failure propagates so the endpoint 500s and Stripe retries the cancel.
    /// </summary>
    Task CancelSubscriptionAsync(string subscriptionId, CancellationToken cancellationToken);
}
