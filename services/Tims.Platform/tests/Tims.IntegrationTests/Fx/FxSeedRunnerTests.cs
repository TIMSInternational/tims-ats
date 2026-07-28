using Microsoft.EntityFrameworkCore;
using FxSeedOnce;

namespace Tims.IntegrationTests.Fx;

/// <summary>
/// Proves FxSeedRunner's composition root actually works end-to-end: the real fx_rates migration
/// (via FxSchemaFixture), a real call to the public Frankfurter API, and a real upsert into
/// fx_rates. This is the closest proof possible that the tool Federico runs by hand against
/// production will work, without Claude ever touching production itself.
/// </summary>
[Collection(nameof(FxSchemaCollection))]
public sealed class FxSeedRunnerTests(FxSchemaFixture fixture)
{
    private readonly FxSchemaFixture _fixture = fixture;

    [Fact]
    public async Task RunAsync_pins_the_seed_currencies_against_the_real_frankfurter_api()
    {
        await _fixture.ResetAsync();

        var pinned = await FxSeedRunner.RunAsync(_fixture.ConnectionString, CancellationToken.None);

        // NOTE (verified live against api.frankfurter.dev, 2026-07-28 — see task-1-report.md):
        // Frankfurter/ECB does NOT publish rates for COP or CRC at all (its currency set is the
        // fixed ECB reference list of ~31 majors). RefreshFxRatesUseCase's SeedQuoteCurrencies
        // {COP, CRC, EUR, MXN} is therefore only ever satisfiable for EUR/MXN via this provider —
        // COP/CRC (the two currencies TIMS/INVU actually need) can never be pinned this way. This
        // is a pre-existing gap in RefreshFxRatesUseCase/FrankfurterFxGateway (untouched by this
        // task) surfaced for the first time by this test actually calling the real API — flagged
        // to Federico rather than silently worked around. The brief's original `>= 4` assumed all
        // 4 seed currencies were fetchable; corrected here to the verified real minimum (EUR+MXN).
        Assert.True(pinned >= 2, $"expected at least the 2 Frankfurter-supported seed currencies (EUR/MXN), got {pinned}");

        await using var db = _fixture.NewContext();
        var rows = await db.FxRates.AsNoTracking().ToListAsync();
        Assert.True(rows.Count >= 2);
        Assert.All(rows, row =>
        {
            Assert.Equal("USD", row.BaseCurrency);
            Assert.True(row.Rate > 0 && double.IsFinite(row.Rate));
        });
    }
}
