namespace Tims.Application.Billing;

/// <summary>
/// Tenant self-serve billing data access — a faithful port of the TS <c>billing.repository.ts</c>. Runs on the
/// REQUEST (tenant) path UNDER TenantScope (app_tenant + org GUC, RLS-scoped) with an explicit organizationId
/// (defense in depth). Contrast the webhook repository, which is privileged/non-tenant.
/// </summary>
public interface IBillingSelfServeRepository
{
    /// <summary>The org identity + its subscription's Stripe linkage (for ensuring a Customer), or null if the org is not visible.</summary>
    Task<OrgBillingContext?> GetOrgBillingContextAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>
    /// Persist the Stripe Customer id with COMPARE-AND-SET semantics: claim it only while the org still has
    /// none, and return the AUTHORITATIVE id (the existing one if a concurrent request already linked a
    /// customer). Never clobbers an existing linkage — with the caller's Stripe idempotency key, concurrent
    /// checkouts converge on a single customer.
    /// </summary>
    Task<string> SetStripeCustomerIdIfAbsentAsync(string organizationId, string stripeCustomerId, CancellationToken cancellationToken);
}

/// <summary>The org identity + subscription linkage for the self-serve billing flow.</summary>
public sealed record OrgBillingContext(string Id, string Name, string? BillingEmail, OrgBillingSubscription? Subscription);

/// <summary>The subscription linkage the self-serve flow reads (customer/subscription ids + plan/status for the double-billing guard).</summary>
public sealed record OrgBillingSubscription(string Id, string? StripeCustomerId, string? StripeSubscriptionId, string Plan, string Status);
