using Tims.Application.Fx;

namespace Tims.UnitTests.FxRates;

/// <summary>
/// Unit tests for <see cref="RefreshFxRatesUseCase"/> with a FAKE gateway + FAKE repository (no I/O, no DB, no
/// live rate). Proves: base = USD is passed with the discovered ∪ seed quote set (base dropped); non-positive /
/// non-finite rates are filtered before pinning; an empty quote set short-circuits; the written count is returned.
/// </summary>
public sealed class RefreshFxRatesUseCaseTests
{
    [Fact]
    public async Task Fetches_base_USD_with_discovered_plus_seed_quotes_and_upserts_positive_rates()
    {
        var gateway = new FakeGateway(new FxGatewayRates(
            "USD",
            new DateOnly(2026, 7, 21),
            new Dictionary<string, double>(StringComparer.Ordinal)
            {
                ["COP"] = 4000,
                ["EUR"] = 0.92,
                ["GBP"] = 0,      // non-positive → filtered
                ["JPY"] = double.NaN, // non-finite → filtered
            }));
        var repo = new FakeRepository(referenced: new[] { "GBP", "usd" }); // 'usd' normalizes to base → dropped
        var useCase = new RefreshFxRatesUseCase(gateway, repo);

        var written = await useCase.RunAsync(default);

        Assert.Equal("USD", gateway.LastBase);
        // discovered {GBP} ∪ seed {COP,CRC,EUR,MXN}, base USD dropped, sorted ordinal.
        Assert.Equal(new[] { "COP", "CRC", "EUR", "GBP", "MXN" }, gateway.LastQuotes);
        // Only the positive finite rates are pinned (GBP=0 + JPY=NaN filtered out).
        Assert.Equal(2, written);
        Assert.Equal(new DateOnly(2026, 7, 21), repo.LastAsOf);
        Assert.Equal(2, repo.LastRates!.Count);
        Assert.True(repo.LastRates.ContainsKey("COP"));
        Assert.True(repo.LastRates.ContainsKey("EUR"));
    }

    [Fact]
    public async Task No_usable_rates_returns_zero_without_upserting()
    {
        var gateway = new FakeGateway(new FxGatewayRates(
            "USD", new DateOnly(2026, 7, 21), new Dictionary<string, double> { ["COP"] = 0 }));
        var repo = new FakeRepository(referenced: Array.Empty<string>());
        var useCase = new RefreshFxRatesUseCase(gateway, repo);

        var written = await useCase.RunAsync(default);

        Assert.Equal(0, written);
        Assert.Null(repo.LastRates); // upsert never called
    }

    private sealed class FakeGateway(FxGatewayRates result) : IFxRateGateway
    {
        public string? LastBase { get; private set; }

        public IReadOnlyList<string>? LastQuotes { get; private set; }

        public Task<FxGatewayRates> FetchLatestAsync(
            string baseCurrency, IReadOnlyCollection<string> quoteCurrencies, CancellationToken cancellationToken)
        {
            LastBase = baseCurrency;
            LastQuotes = quoteCurrencies.ToList();
            return Task.FromResult(result);
        }
    }

    private sealed class FakeRepository(IReadOnlyList<string> referenced) : IFxRateWriteRepository
    {
        public DateOnly? LastAsOf { get; private set; }

        public IReadOnlyDictionary<string, double>? LastRates { get; private set; }

        public Task<IReadOnlyList<string>> ListReferencedCurrenciesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(referenced);

        public Task<int> UpsertRatesAsync(
            string baseCurrency,
            DateOnly asOf,
            IReadOnlyDictionary<string, double> rates,
            DateTime fetchedAt,
            string source,
            CancellationToken cancellationToken)
        {
            LastAsOf = asOf;
            LastRates = rates;
            return Task.FromResult(rates.Count);
        }
    }
}
