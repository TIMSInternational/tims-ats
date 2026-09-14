using Tims.Domain.Compensation;

namespace Tims.UnitTests.FxRates;

/// <summary>
/// Direct pins for <see cref="CurrencyCodes.NormalizeCurrencyCode"/> (2026-08-15). The helper had ZERO
/// direct tests while carrying a SECURITY property nobody wrote down as one: it is the collapse that
/// bounds the FX refresh's discovery output. `ListReferencedCurrenciesAsync` runs an unbounded DISTINCT
/// over tenant-writable currency columns; every value then passes through this normalize, where anything
/// that is not exactly a known ISO-4217 code becomes the fallback — so garbage collapses to the base
/// currency and is dropped, the quote list is hard-capped at the known-code set, and no tenant-authored
/// byte can reach the gateway. That chain is only as strong as this function.
/// </summary>
public sealed class CurrencyCodesTests
{
    [Theory]
    [InlineData("COP", "COP")]
    [InlineData("cop", "COP")] // lower-case is normalized, not rejected
    [InlineData("  eur  ", "EUR")] // trimmed
    [InlineData("usd", "USD")]
    public void Known_codes_survive_whatever_their_casing_or_padding(string input, string expected)
    {
        Assert.Equal(expected, CurrencyCodes.NormalizeCurrencyCode(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("ABC")] // three A–Z letters but NOT a known ISO code
    [InlineData("US")] // too short
    [InlineData("USDX")] // too long
    [InlineData("U$D")] // metacharacter
    [InlineData("../../etc")] // path-shaped garbage
    [InlineData("USD;DROP TABLE fx_rates")] // SQL-shaped garbage
    public void Everything_else_collapses_to_the_fallback(string? input)
    {
        Assert.Equal("USD", CurrencyCodes.NormalizeCurrencyCode(input));
        Assert.Equal("EUR", CurrencyCodes.NormalizeCurrencyCode(input, "EUR"));
    }

    [Fact]
    public void The_refresh_quote_pipeline_drops_collapsed_garbage_entirely()
    {
        // The property as the refresh actually uses it: normalize with fallback = BASE, then drop the
        // base. Garbage therefore contributes NOTHING to the quote list — not a fallback entry.
        string?[] discovered = ["COP", "garbage!", null, "usd", "XYZ"];
        var quotes = discovered
            .Select(c => CurrencyCodes.NormalizeCurrencyCode(c, CurrencyCodes.PlatformBillingCurrency))
            .Where(c => !string.Equals(c, CurrencyCodes.PlatformBillingCurrency, StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        Assert.Equal(["COP"], quotes);
    }
}
