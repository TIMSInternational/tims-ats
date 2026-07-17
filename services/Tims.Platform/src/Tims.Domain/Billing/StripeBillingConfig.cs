namespace Tims.Domain.Billing;

/// <summary>
/// The <c>billing.getBillingConfig</c> gating predicate — a faithful port of the pure TS
/// <c>isBillingConfigured(env)</c> (packages/api/src/lib/stripe.ts). Config-presence IS the gate (no separate
/// flag): billing self-serve is "configured" only when the Stripe secret key AND both self-serve price ids
/// (starter + professional) are present and non-empty. Fail-CLOSED — any missing/empty value → not configured
/// (the UI hides Upgrade/Manage; a caller never fabricates a checkout URL). Golden-fixtured BOTH stacks
/// (billing-config.json).
/// </summary>
public static class StripeBillingConfig
{
    public static bool IsConfigured(string? secretKey, string? priceStarter, string? priceProfessional) =>
        !string.IsNullOrEmpty(secretKey)
        && !string.IsNullOrEmpty(priceStarter)
        && !string.IsNullOrEmpty(priceProfessional);
}

/// <summary>The <c>getBillingConfig</c> wire shape: <c>{ "configured": bool }</c>.</summary>
public sealed record BillingConfigV1(bool Configured);
