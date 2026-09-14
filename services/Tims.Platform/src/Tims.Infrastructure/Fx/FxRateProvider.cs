using Microsoft.EntityFrameworkCore;
using Tims.Application.Fx;
using Tims.Domain.Compensation;

namespace Tims.Infrastructure.Fx;

/// <summary>
/// <see cref="IFxRateProvider"/> over the GLOBAL, RLS-exempt <see cref="FxRateDbContext"/> — reads the LATEST
/// effective-dated pin (as_of desc) the refresh wrote — any of its three composition roots (the Workers
/// <c>FxRefreshJob</c>, the API-hosted <c>FxRefreshHostedService</c>, the one-off <c>FxSeedOnce</c>). All pins are stored base = USD
/// (PLATFORM_BILLING_CURRENCY), so any pair cross-rates through USD:
/// <c>rate(from→to) = rate(USD→to) / rate(USD→from)</c> (1 from = 1/rf USD = rt/rf to). FAIL-SOFT (Federico's
/// DB-pin decision): identity → 1.0 (no DB touch); a missing pin on EITHER leg (cold start / a currency the job
/// has never pinned) → <c>null</c>, and the caller omits/suppresses the FX-derived field instead of throwing.
/// Runs on a PLAIN connection (no <see cref="TenantScope"/>): fx_rates has no RLS policy and the read is global.
/// </summary>
public sealed class FxRateProvider(FxRateDbContext db) : IFxRateProvider
{
    private const string BaseCurrency = CurrencyCodes.PlatformBillingCurrency; // USD

    private readonly FxRateDbContext _db = db;

    public async Task<FxPin?> GetPinAsync(string from, string to, CancellationToken cancellationToken)
    {
        var normalizedFrom = (from ?? string.Empty).Trim().ToUpperInvariant();
        var normalizedTo = (to ?? string.Empty).Trim().ToUpperInvariant();

        if (string.Equals(normalizedFrom, normalizedTo, StringComparison.Ordinal))
        {
            return new FxPin(1.0, null, Identity: true); // identity — no pin needed, no date
        }

        var fromLeg = await LegFromBaseAsync(normalizedFrom, cancellationToken).ConfigureAwait(false);
        var toLeg = await LegFromBaseAsync(normalizedTo, cancellationToken).ConfigureAwait(false);

        // Cold-start / missing pair on either leg → fail-soft null (the read omits/suppresses the FX field).
        if (fromLeg is not { } fl || toLeg is not { } tl || fl.Rate <= 0)
        {
            return null;
        }

        // Cross-rate through the USD base; as_of = EARLIEST non-identity leg date (a USD leg is identity and
        // carries no date — matching the TS wrapper, which never records an identity provider's date).
        return new FxPin(tl.Rate / fl.Rate, EarliestDate(fl.AsOf, tl.AsOf), Identity: false);
    }

    // USD→cur: the base itself is (1.0, no date) — an identity leg; otherwise the latest pin (base=USD,
    // quote=cur) by as_of desc, carrying that pin's effective date.
    private async Task<(double Rate, DateOnly? AsOf)?> LegFromBaseAsync(string currency, CancellationToken cancellationToken)
    {
        if (string.Equals(currency, BaseCurrency, StringComparison.Ordinal))
        {
            return (1.0, (DateOnly?)null);
        }

        var pin = await _db.FxRates.AsNoTracking()
            .Where(r => r.BaseCurrency == BaseCurrency && r.QuoteCurrency == currency)
            .OrderByDescending(r => r.AsOf)
            .Select(r => new { r.Rate, r.AsOf })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        return pin is not null && pin.Rate > 0 ? (pin.Rate, pin.AsOf) : null;
    }

    // The earliest of two nullable dates (null legs contribute nothing) — the USD cross-rate's effective date.
    private static DateOnly? EarliestDate(DateOnly? a, DateOnly? b)
    {
        if (a is null)
        {
            return b;
        }

        if (b is null)
        {
            return a;
        }

        return a < b ? a : b;
    }
}
