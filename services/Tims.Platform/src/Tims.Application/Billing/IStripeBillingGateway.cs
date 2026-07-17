namespace Tims.Application.Billing;

/// <summary>
/// The Stripe API boundary for the tenant SELF-SERVE billing surface (customer / checkout / portal / cancel) —
/// a port so the Application layer stays infra-free (the Stripe.net implementation lives in Infrastructure).
/// Mirrors the outbound calls in the TS <c>billing.service.ts</c>. Idempotency keys collapse retried/rapid
/// double-click creates to a single Stripe object.
/// </summary>
public interface IStripeBillingGateway
{
    /// <summary>Create (idempotently, key <c>customer:{orgId}</c>) a Stripe Customer for the org; returns its id.</summary>
    Task<string> CreateCustomerAsync(string organizationId, string name, string? email, CancellationToken cancellationToken);

    /// <summary>Create a subscription-mode Checkout Session; returns its hosted URL (null if Stripe returns none).</summary>
    Task<string?> CreateCheckoutSessionUrlAsync(CheckoutSessionRequest request, CancellationToken cancellationToken);

    /// <summary>Create a Billing Portal session for the customer; returns its URL. Uses the explicit configuration when given.</summary>
    Task<string> CreatePortalSessionUrlAsync(string customerId, string returnUrl, string? configurationId, CancellationToken cancellationToken);

    /// <summary>Schedule a subscription to cancel at PERIOD END (never an immediate destructive cancel).</summary>
    Task ScheduleCancelAtPeriodEndAsync(string subscriptionId, CancellationToken cancellationToken);
}

/// <summary>The inputs for a self-serve checkout session (orgId carried as client_reference_id + metadata for the webhook).</summary>
public sealed record CheckoutSessionRequest(
    string CustomerId,
    string PriceId,
    string OrganizationId,
    string SuccessUrl,
    string CancelUrl,
    string IdempotencyKey);
