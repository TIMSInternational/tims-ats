namespace Tims.Domain.Compensation;

/// <summary>
/// A faithful port of the currency-code helpers in <c>packages/shared/src/constants/currencies.ts</c> used by
/// the FX-derived reads (Slice 11c). <see cref="NormalizeCurrencyCode"/> mirrors the TS normalizeCurrencyCode:
/// trim + upper-case, and if the result is a valid ISO-4217 code return it, else the fallback. The TS validity
/// test is <c>/^[A-Z]{3}$/</c> AND <c>Intl.NumberFormat</c> acceptance; <see cref="KnownCurrencyCodes"/> is the
/// SAME ISO-4217 set the TS <c>FALLBACK_CURRENCY_CODES</c> lists (what Intl.supportedValuesOf('currency')
/// returns), so the two stacks agree for every real code — the only ones the DB ever stores.
/// </summary>
public static class CurrencyCodes
{
    public const string DefaultCurrency = "USD";
    public const string PlatformBillingCurrency = "USD";

    // ISO-4217 active codes — the same list as packages/shared/src/constants/currencies.ts FALLBACK_CURRENCY_CODES.
    private static readonly HashSet<string> KnownCurrencyCodes = new(StringComparer.Ordinal)
    {
        "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
        "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL",
        "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY",
        "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP",
        "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD",
        "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR",
        "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF",
        "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD",
        "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR",
        "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD",
        "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON",
        "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP",
        "SLE", "SOS", "SRD", "SSP", "STN", "SYP", "SZL", "THB", "TJS", "TMT",
        "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU",
        "UZS", "VES", "VND", "VUV", "WST", "XAF", "XCD", "XOF", "XPF", "YER",
        "ZAR", "ZMW", "ZWG",
    };

    /// <summary>Port of normalizeCurrencyCode(code, fallback = 'USD'): trim + upper-case; a valid ISO-4217 code
    /// is returned, else the <paramref name="fallback"/>.</summary>
    public static string NormalizeCurrencyCode(string? code, string fallback = DefaultCurrency)
    {
        var normalized = (code ?? string.Empty).Trim().ToUpperInvariant();
        return IsCurrencyCode(normalized) ? normalized : fallback;
    }

    /// <summary>Port of isCurrencyCode: exactly three A–Z letters AND a known ISO-4217 code.</summary>
    public static bool IsCurrencyCode(string? code) =>
        code is { Length: 3 } && code.All(c => c is >= 'A' and <= 'Z') && KnownCurrencyCodes.Contains(code);
}
