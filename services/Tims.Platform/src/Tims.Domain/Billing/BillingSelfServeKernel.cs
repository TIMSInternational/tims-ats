namespace Tims.Domain.Billing;

/// <summary>
/// The stored subscription seen by <see cref="BillingSelfServeKernel.BlocksSelfServeCheckout"/> — the fields
/// the double-billing guard reads (matching the TS <c>getOrgBillingContext</c> subscription select).
/// </summary>
public sealed record SelfServeSubscription
{
    public string? StripeSubscriptionId { get; init; }
    public required string Status { get; init; }
    public required string Plan { get; init; }
}

/// <summary>
/// Pure kernels for the tenant self-serve billing surface — a faithful, dependency-free port of the TS pure
/// helpers (packages/api/src/services/billing.service.ts). Golden-fixtured BOTH stacks
/// (contracts/billing-fixtures/blocks-self-serve-checkout.json).
/// </summary>
public static class BillingSelfServeKernel
{
    /// <summary>
    /// True when self-serve subscription checkout must NOT run because the org already has a live billing
    /// relationship — a second subscription-creating checkout would DOUBLE-BILL. Blocks BOTH a non-cancelled
    /// live Stripe subscription AND a paid local/manually-billed plan (<c>stripeSubscriptionId</c> null, e.g.
    /// invoiced externally). A cancelled subscription (re-subscribe) or a trial with no Stripe subscription is
    /// allowed, as is a missing subscription row. A faithful port of the TS <c>blocksSelfServeCheckout</c>.
    /// </summary>
    public static bool BlocksSelfServeCheckout(SelfServeSubscription? subscription)
    {
        if (subscription is null)
        {
            return false;
        }

        if (subscription.Status == "cancelled")
        {
            return false;
        }

        if (!string.IsNullOrEmpty(subscription.StripeSubscriptionId))
        {
            return true;
        }

        return subscription.Plan != "trial";
    }
}
