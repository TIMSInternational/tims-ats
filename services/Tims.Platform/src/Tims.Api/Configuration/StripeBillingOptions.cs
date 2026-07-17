namespace Tims.Api.Configuration;

/// <summary>
/// The deploy's Stripe self-serve billing config, bound from the "Stripe" config section. All optional:
/// billing self-serve is "configured" only when the secret key AND both self-serve price ids are present
/// (the <c>StripeBillingConfig.IsConfigured</c> predicate, golden-parity-locked to the TS
/// <c>isBillingConfigured</c>). Absent today (no Stripe integration in C# yet) → <c>getBillingConfig</c>
/// honestly reports not configured. Secrets are sourced from env / the platform secret store, never committed.
/// </summary>
public sealed class StripeBillingOptions
{
    public const string SectionName = "Stripe";

    public string? SecretKey { get; init; }

    public string? PriceStarter { get; init; }

    public string? PriceProfessional { get; init; }
}
