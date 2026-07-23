using System.Globalization;
using Tims.Domain.Compensation;

namespace Tims.Application.Fx;

/// <summary>
/// The Application-layer bridge the FX-derived reads use: it normalizes the currency codes (like the live
/// convertMoney: from/to fall back to USD), resolves the DB-pinned rate via <see cref="IFxRateProvider"/>, and
/// shapes money through the pure <see cref="CompensationKernels"/> (golden-fixtured both stacks). FAIL-SOFT: a
/// missing pin (cold start) surfaces as a <c>null</c> return — the caller OMITS/SUPPRESSES the FX-derived field,
/// never a 500. Identity conversions (from == to after normalization) never need a pin, so a single-currency org
/// works fully even before the first refresh.
/// </summary>
public sealed class FxMoneyConverter(IFxRateProvider provider)
{
    private readonly IFxRateProvider _provider = provider;

    /// <summary>Convert one amount; <c>null</c> when the required cross-rate is unavailable (fail-soft).</summary>
    public async Task<ConvertedMoney?> ConvertAsync(
        double amount, string? from, string? to, CancellationToken cancellationToken)
    {
        var fromN = CurrencyCodes.NormalizeCurrencyCode(from, CurrencyCodes.DefaultCurrency);
        var toN = CurrencyCodes.NormalizeCurrencyCode(to, CurrencyCodes.PlatformBillingCurrency);
        var pin = await _provider.GetPinAsync(fromN, toN, cancellationToken).ConfigureAwait(false);
        return pin is { } p ? CompensationKernels.ConvertMoney(amount, fromN, toN, p.Rate) : null;
    }

    /// <summary>Convert one amount, returning ONLY the converted numeric amount; <c>null</c> on missing rate.</summary>
    public async Task<double?> ConvertAmountAsync(
        double amount, string? from, string? to, CancellationToken cancellationToken)
    {
        var money = await ConvertAsync(amount, from, to, cancellationToken).ConfigureAwait(false);
        return money?.Amount;
    }

    /// <summary>Sum a set of (amount, currency) rows into <paramref name="displayCurrency"/> via the pure
    /// round-then-sum kernel. Returns <c>null</c> when ANY row's required cross-rate is unavailable (fail-soft —
    /// the caller suppresses the FX-derived totals). Mirrors the live sumMoney arithmetic exactly, and threads
    /// <c>ratesAsOf</c> = the EARLIEST non-identity pin date across the rows (FIX 4 — the pin as_of lives here,
    /// in the impure wrapper, NOT in the pure MoneySum golden).</summary>
    public async Task<FxSumResult?> SumAsync(
        IReadOnlyList<(double Amount, string? Currency)> rows,
        string? displayCurrency,
        CancellationToken cancellationToken)
    {
        var toN = CurrencyCodes.NormalizeCurrencyCode(displayCurrency, CurrencyCodes.PlatformBillingCurrency);
        var moneyRows = new List<MoneyRow>(rows.Count);
        DateOnly? earliestAsOf = null;
        foreach (var (amount, currency) in rows)
        {
            var fromN = CurrencyCodes.NormalizeCurrencyCode(currency, CurrencyCodes.DefaultCurrency);
            var pin = await _provider.GetPinAsync(fromN, toN, cancellationToken).ConfigureAwait(false);
            if (pin is not { } p)
            {
                return null; // fail-soft: one missing rate suppresses the whole sum
            }

            moneyRows.Add(new MoneyRow(amount, fromN, p.Rate));

            // Collect the earliest NON-identity pin date (identity rows carry no date — TS parity).
            if (!p.Identity && p.AsOf is { } asOf && (earliestAsOf is null || asOf < earliestAsOf))
            {
                earliestAsOf = asOf;
            }
        }

        var sum = CompensationKernels.SumMoney(moneyRows, toN);
        return new FxSumResult(
            sum.Amount,
            sum.Converted,
            earliestAsOf?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }
}
