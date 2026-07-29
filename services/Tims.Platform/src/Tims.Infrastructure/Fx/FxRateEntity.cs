namespace Tims.Infrastructure.Fx;

/// <summary>
/// EF entity for the efcore-OWNED <c>fx_rates</c> table (Phase-5 Slice 11c). A GLOBAL, org-agnostic FX-rate
/// pin: one row per (base_currency, quote_currency, as_of) — the ECB rate pinned by the daily
/// <c>FxRefreshJob</c>. UNLIKE every other efcore-owned table it is RLS-EXEMPT (FX rates are shared, not tenant
/// data; a tenant GUC would hide every row), so its migration does NOT call <c>EnableTenantRls</c> — it only
/// GRANTs SELECT to <c>app_tenant</c>. Reads/writes go through the plain (non-tenant) <see cref="FxRateDbContext"/>.
/// </summary>
public sealed class FxRateEntity
{
    public Guid Id { get; set; }

    /// <summary>The base currency of the pin (the refresh job pins base = USD = PLATFORM_BILLING_CURRENCY).</summary>
    public string BaseCurrency { get; set; } = string.Empty;

    /// <summary>The quote currency: 1 unit of base = <see cref="Rate"/> units of quote.</summary>
    public string QuoteCurrency { get; set; } = string.Empty;

    /// <summary>base→quote rate (units of quote per 1 unit of base).</summary>
    public double Rate { get; set; }

    /// <summary>The provider's effective date the rate is for.</summary>
    public DateOnly AsOf { get; set; }

    /// <summary>When the refresh job fetched + pinned this rate (provenance; never a parity input).</summary>
    public DateTime FetchedAt { get; set; }

    /// <summary>The rate source — always <c>exchangerate-api</c> for now (see
    /// docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md).</summary>
    public string Source { get; set; } = "exchangerate-api";
}
