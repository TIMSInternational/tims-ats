using Tims.Domain.Billing;

namespace Tims.Application.Billing;

/// <summary>
/// The Stripe-webhook subscription state-sync repository port — a faithful port of the TS
/// <c>billing-webhook.repository.ts</c>. Every method resolves/scopes by EXPLICIT <c>organizationId</c> and
/// runs on the PRIVILEGED (non-tenant) connection: the webhook carries no org GUC (Stripe is not a tenant),
/// so it must NOT go through TenantScope (whose RLS GUC would be unset → fail-closed). A verified signature
/// proves DELIVERY, not tenant authorization — the org is resolved authoritatively from our recorded linkage.
/// </summary>
public interface IBillingWebhookRepository
{
    /// <summary>The org that owns <paramref name="stripeSubscriptionId"/> (recorded unique column), or null.</summary>
    Task<string?> FindOrgIdBySubscriptionAsync(string stripeSubscriptionId, CancellationToken cancellationToken);

    /// <summary>The org that owns <paramref name="stripeCustomerId"/> (recorded unique column), or null.</summary>
    Task<string?> FindOrgIdByCustomerAsync(string stripeCustomerId, CancellationToken cancellationToken);

    /// <summary>
    /// Atomically apply a Stripe subscription state to the org's stored subscription, serialized per-org by a
    /// transaction-scoped advisory lock: read-once → decide duplicate/stale (the pure kernels) → upsert by the
    /// unique <c>organization_id</c> + mirror <c>plan</c> onto <c>organizations.plan</c> (only when known).
    /// </summary>
    Task<ApplyOutcome> ApplySubscriptionAsync(
        string organizationId,
        string? stripeCustomerId,
        SubscriptionSyncFields fields,
        DateTimeOffset eventAt,
        CancellationToken cancellationToken);

    /// <summary>Link a Stripe customer to an org (checkout completed with no subscription yet) — upsert the customer id only.</summary>
    Task LinkCustomerAsync(string organizationId, string stripeCustomerId, CancellationToken cancellationToken);
}
