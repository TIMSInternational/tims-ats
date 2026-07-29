using Tims.Domain.Compensation;

namespace Tims.Application.Fx;

/// <summary>
/// The daily FX-refresh use case (Slice 11c): discover the currencies the reads convert between, fetch the
/// latest ECB base→quote rates via <see cref="IFxRateGateway"/>, and idempotently pin them into <c>fx_rates</c>
/// via <see cref="IFxRateWriteRepository"/>. Base = USD (PLATFORM_BILLING_CURRENCY) so the provider can
/// cross-rate any pair through it. Infra-free orchestration (Domain-only — the Quartz adapter + ResilientJobRunner
/// own the schedule/retry/observability/logging). A run with no non-base currencies to pin is a no-op (returns 0).
///
/// Idempotent by construction: the repository upserts ON CONFLICT(base, quote, as_of), so a ResilientJobRunner
/// retry of the SAME fire (same ECB date) refreshes the rows in place — never a duplicate — while a genuinely
/// later day's fetch (new as_of) writes new rows.
/// </summary>
public sealed class RefreshFxRatesUseCase(IFxRateGateway gateway, IFxRateWriteRepository repository)
{
    private const string BaseCurrency = CurrencyCodes.PlatformBillingCurrency; // USD
    private const string Source = "exchangerate-api";

    // A small seed set so cold-start still pins the common currencies even before any comp/company/band row
    // references them (COP + CRC = the live TIMS/INVU currencies; EUR/MXN common). Unioned with the discovered set.
    private static readonly string[] SeedQuoteCurrencies = { "COP", "CRC", "EUR", "MXN" };

    private readonly IFxRateGateway _gateway = gateway;
    private readonly IFxRateWriteRepository _repository = repository;

    /// <summary>Returns the number of pins written (0 when there is nothing to pin / no usable rates).</summary>
    public async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        var referenced = await _repository.ListReferencedCurrenciesAsync(cancellationToken).ConfigureAwait(false);

        // Normalize + de-dup, drop the base itself (base→base is the identity the provider handles without a pin).
        var quotes = referenced.Concat(SeedQuoteCurrencies)
            .Select(c => CurrencyCodes.NormalizeCurrencyCode(c, BaseCurrency))
            .Where(c => !string.Equals(c, BaseCurrency, StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(c => c, StringComparer.Ordinal)
            .ToList();

        if (quotes.Count == 0)
        {
            return 0;
        }

        var fetched = await _gateway.FetchLatestAsync(BaseCurrency, quotes, cancellationToken).ConfigureAwait(false);

        // Keep only positive, finite rates (a provider quirk must never pin a 0/NaN rate the provider would divide by).
        var rates = fetched.Rates
            .Where(kv => double.IsFinite(kv.Value) && kv.Value > 0)
            .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);

        if (rates.Count == 0)
        {
            return 0;
        }

        return await _repository.UpsertRatesAsync(
            BaseCurrency, fetched.AsOf, rates, DateTime.UtcNow, Source, cancellationToken).ConfigureAwait(false);
    }
}
