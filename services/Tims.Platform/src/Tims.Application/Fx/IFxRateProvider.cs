namespace Tims.Application.Fx;

/// <summary>
/// The inbound port the FX-derived reads use to resolve a conversion rate from the DB-pinned <c>fx_rates</c>
/// (the latest effective-dated pin). Implemented by <c>FxRateProvider</c> over the global (RLS-exempt)
/// FxRateDbContext. FAIL-SOFT (Federico's DB-pin decision): identity (<paramref name="from"/> ==
/// <paramref name="to"/>) → 1.0 with no pin needed; a cross-currency pair with NO pin (cold start / missing
/// currency) → <c>null</c>, and the caller OMITS/SUPPRESSES the FX-derived field rather than throwing (never a
/// 500). Cross-rates resolve through the pin base (USD).
/// </summary>
public interface IFxRateProvider
{
    /// <summary>The latest pinned <paramref name="from"/>→<paramref name="to"/> conversion as an
    /// <see cref="FxPin"/> (rate + earliest non-identity leg <c>as_of</c> + identity flag), or <c>null</c> on
    /// cold-start / missing pair (fail-soft). Identity pairs return <c>Rate = 1.0, AsOf = null, Identity = true</c>
    /// without touching the DB. The <c>as_of</c> is surfaced so the Application-layer converter can thread
    /// <c>ratesAsOf</c> (FIX 4) without polluting the pure MoneySum golden.</summary>
    Task<FxPin?> GetPinAsync(string from, string to, CancellationToken cancellationToken);
}
