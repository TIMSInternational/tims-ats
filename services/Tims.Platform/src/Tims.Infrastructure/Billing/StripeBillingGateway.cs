using Stripe;
using Stripe.Checkout;
using Tims.Application.Billing;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// The Stripe.net implementation of <see cref="IStripeBillingGateway"/> — the outbound self-serve billing
/// calls (customer / checkout / portal / cancel), a faithful port of the TS <c>billing.service.ts</c> Stripe
/// usage. Idempotency keys (<c>customer:{orgId}</c>, <c>checkout:{orgId}:{plan}</c>) collapse retried creates.
/// Takes the secret key as a plain value (wired from <c>StripeBillingOptions</c> in Program.cs) so
/// Infrastructure never references the Api layer.
/// </summary>
public sealed class StripeBillingGateway(string? secretKey) : IStripeBillingGateway
{
    private const string OrgIdMetadataKey = "orgId";

    private readonly string? _secretKey = secretKey;
    private StripeClient? _client;

    public async Task<string> CreateCustomerAsync(string organizationId, string name, string? email, CancellationToken cancellationToken)
    {
        var service = new CustomerService(Client());
        var customer = await service.CreateAsync(
            new CustomerCreateOptions
            {
                Name = name,
                Email = email,
                Metadata = new Dictionary<string, string> { [OrgIdMetadataKey] = organizationId },
            },
            new RequestOptions { IdempotencyKey = $"customer:{organizationId}" },
            cancellationToken).ConfigureAwait(false);
        return customer.Id;
    }

    public async Task<string?> CreateCheckoutSessionUrlAsync(CheckoutSessionRequest request, CancellationToken cancellationToken)
    {
        var service = new SessionService(Client());
        var session = await service.CreateAsync(
            new SessionCreateOptions
            {
                Mode = "subscription",
                Customer = request.CustomerId,
                LineItems = [new SessionLineItemOptions { Price = request.PriceId, Quantity = 1 }],
                ClientReferenceId = request.OrganizationId,
                Metadata = new Dictionary<string, string> { [OrgIdMetadataKey] = request.OrganizationId },
                SubscriptionData = new SessionSubscriptionDataOptions
                {
                    Metadata = new Dictionary<string, string> { [OrgIdMetadataKey] = request.OrganizationId },
                },
                SuccessUrl = request.SuccessUrl,
                CancelUrl = request.CancelUrl,
            },
            new RequestOptions { IdempotencyKey = request.IdempotencyKey },
            cancellationToken).ConfigureAwait(false);
        return session.Url;
    }

    public async Task<string> CreatePortalSessionUrlAsync(string customerId, string returnUrl, string? configurationId, CancellationToken cancellationToken)
    {
        var service = new Stripe.BillingPortal.SessionService(Client());
        var session = await service.CreateAsync(
            new Stripe.BillingPortal.SessionCreateOptions
            {
                Customer = customerId,
                ReturnUrl = returnUrl,
                // Omit when absent OR empty (TS `...(configuration ? {configuration} : {})`) → the account
                // default configuration; sending an empty id would be rejected by Stripe.
                Configuration = string.IsNullOrEmpty(configurationId) ? null : configurationId,
            },
            cancellationToken: cancellationToken).ConfigureAwait(false);
        return session.Url;
    }

    public async Task ScheduleCancelAtPeriodEndAsync(string subscriptionId, CancellationToken cancellationToken)
    {
        var service = new SubscriptionService(Client());
        await service.UpdateAsync(
            subscriptionId,
            new SubscriptionUpdateOptions { CancelAtPeriodEnd = true },
            cancellationToken: cancellationToken).ConfigureAwait(false);
    }

    private StripeClient Client()
    {
        if (string.IsNullOrEmpty(_secretKey))
        {
            throw new InvalidOperationException("Stripe is not configured: SecretKey is missing");
        }

        return _client ??= new StripeClient(_secretKey);
    }
}
