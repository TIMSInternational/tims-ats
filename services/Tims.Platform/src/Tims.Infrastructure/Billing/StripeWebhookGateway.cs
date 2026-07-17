using Stripe;
using Tims.Application.Billing;
using Tims.Domain.Billing;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// The Stripe.net implementation of <see cref="IStripeWebhookGateway"/> — the ONLY Stripe SDK surface in the
/// webhook path. Owns exactly the two security-critical / API-shape-heavy pieces a vetted SDK should own:
/// HMAC signature verification (<see cref="EventUtility.ConstructEvent(string, string, string, long, bool)"/>)
/// and the typed outbound calls (retrieve / cancel). It NORMALIZES the SDK objects onto the infra-free
/// <see cref="StripeWebhookEvent"/> / <see cref="StripeSubscriptionSnapshot"/> the use case dispatches on, so
/// the pure kernels + orchestration never touch Stripe types. Its config (secret key + webhook signing
/// secret) is supplied by Program.cs from <c>StripeBillingOptions</c> — the gateway takes plain values so
/// Infrastructure never references the Api layer.
/// </summary>
public sealed class StripeWebhookGateway(string? secretKey, string? webhookSecret) : IStripeWebhookGateway
{
    private const string OrgIdMetadataKey = "orgId";
    private const string ResourceMissingCode = "resource_missing";

    private readonly string? _secretKey = secretKey;
    private readonly string? _webhookSecret = webhookSecret;
    private StripeClient? _client;

    public StripeWebhookEvent ConstructEvent(string rawBody, string? signature)
    {
        // Mirror the TS constructWebhookEvent guards: a missing secret/header is a verification failure (400),
        // never a 500 — an unverified event is never processed.
        if (string.IsNullOrEmpty(_webhookSecret))
        {
            throw new WebhookVerificationException("Stripe webhook secret is not configured");
        }

        if (string.IsNullOrEmpty(signature))
        {
            throw new WebhookVerificationException("Missing Stripe-Signature header");
        }

        // TS `constructWebhookEvent` calls getStripe() during verification (lib/stripe.ts), which requires
        // STRIPE_SECRET_KEY and throws when it is absent → the route returns 400 BEFORE processing. Reproduce
        // that fail-closed parity: never process an event on a half-configured deploy (webhook secret present
        // but API secret absent), matching TS and satisfying the compliance-by-design fail-closed posture.
        if (string.IsNullOrEmpty(_secretKey))
        {
            throw new WebhookVerificationException("Stripe is not configured: SecretKey is missing");
        }

        Event stripeEvent;
        try
        {
            // throwOnApiVersionMismatch:false — an account/library API-version skew must NOT reject a
            // genuinely-signed event (the signature is what authenticates the delivery), matching Node's
            // constructEvent which does not version-gate.
            stripeEvent = EventUtility.ConstructEvent(rawBody, signature, _webhookSecret, throwOnApiVersionMismatch: false);
        }
        catch (StripeException ex)
        {
            throw new WebhookVerificationException(ex.Message);
        }
        catch (Exception ex)
        {
            // Any parse failure on a signed payload is still a verification failure → 400 (TS wraps every
            // construct throw into WebhookVerificationError).
            throw new WebhookVerificationException(ex.Message);
        }

        var createdAt = new DateTimeOffset(DateTime.SpecifyKind(stripeEvent.Created, DateTimeKind.Utc));

        return stripeEvent.Type switch
        {
            "checkout.session.completed" =>
                new StripeWebhookEvent(stripeEvent.Type, createdAt, MapCheckout((Stripe.Checkout.Session)stripeEvent.Data.Object), Subscription: null),
            "customer.subscription.created"
                or "customer.subscription.updated"
                or "customer.subscription.deleted" =>
                new StripeWebhookEvent(stripeEvent.Type, createdAt, Checkout: null, MapSubscription((Subscription)stripeEvent.Data.Object)),
            _ => new StripeWebhookEvent(stripeEvent.Type, createdAt, Checkout: null, Subscription: null),
        };
    }

    public async Task<StripeSubscriptionSnapshot> RetrieveSubscriptionAsync(string subscriptionId, CancellationToken cancellationToken)
    {
        var service = new SubscriptionService(Client());
        var subscription = await service.GetAsync(subscriptionId, cancellationToken: cancellationToken).ConfigureAwait(false);
        return MapSubscription(subscription);
    }

    public async Task CancelSubscriptionAsync(string subscriptionId, CancellationToken cancellationToken)
    {
        var service = new SubscriptionService(Client());
        try
        {
            await service.CancelAsync(subscriptionId, cancellationToken: cancellationToken).ConfigureAwait(false);
        }
        catch (StripeException ex) when (string.Equals(ex.StripeError?.Code, ResourceMissingCode, StringComparison.Ordinal))
        {
            // The subscription is already gone — the only idempotent cancel error to swallow (as
            // StripeResourceMissingException the use case catches). Every other StripeException propagates.
            throw new StripeResourceMissingException(ex.Message);
        }
    }

    private StripeClient Client()
    {
        if (string.IsNullOrEmpty(_secretKey))
        {
            throw new InvalidOperationException("Stripe is not configured: SecretKey is missing");
        }

        return _client ??= new StripeClient(_secretKey);
    }

    private static StripeCheckoutData MapCheckout(Stripe.Checkout.Session session)
    {
        var metaOrgId = session.Metadata is not null && session.Metadata.TryGetValue(OrgIdMetadataKey, out var orgId)
            ? orgId
            : session.ClientReferenceId;
        return new StripeCheckoutData(session.Id, session.CustomerId, session.SubscriptionId, NullIfEmpty(metaOrgId));
    }

    private static StripeSubscriptionSnapshot MapSubscription(Subscription subscription)
    {
        var metaOrgId = subscription.Metadata is not null && subscription.Metadata.TryGetValue(OrgIdMetadataKey, out var orgId)
            ? orgId
            : null;

        var items = (subscription.Items?.Data ?? [])
            .Select(item => new StripeSubscriptionItem
            {
                Price = new StripePrice { Id = item.Price?.Id },
                CurrentPeriodStart = ToUnixSeconds(item.CurrentPeriodStart),
                CurrentPeriodEnd = ToUnixSeconds(item.CurrentPeriodEnd),
            })
            .ToList();

        var like = new StripeSubscriptionLike
        {
            Id = subscription.Id,
            Status = subscription.Status,
            CancelAtPeriodEnd = subscription.CancelAtPeriodEnd,
            CancelAt = ToNullableUnixSeconds(subscription.CancelAt),
            CanceledAt = ToNullableUnixSeconds(subscription.CanceledAt),
            Items = new StripeSubscriptionItems { Data = items },
        };

        return new StripeSubscriptionSnapshot(like, subscription.CustomerId, NullIfEmpty(metaOrgId));
    }

    private static long ToUnixSeconds(DateTime value) =>
        new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc)).ToUnixTimeSeconds();

    private static long? ToNullableUnixSeconds(DateTime? value) =>
        value is { } instant ? ToUnixSeconds(instant) : null;

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}
