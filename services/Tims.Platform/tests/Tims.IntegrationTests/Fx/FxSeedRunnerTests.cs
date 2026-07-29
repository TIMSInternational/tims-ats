using Microsoft.EntityFrameworkCore;
using FxSeedOnce;

namespace Tims.IntegrationTests.Fx;

/// <summary>
/// Proves FxSeedRunner's composition root actually works end-to-end: the real fx_rates migration
/// (via FxSchemaFixture), a real call to the public ExchangeRate-API, and a real upsert into
/// fx_rates. This is the closest proof possible that the tool Federico runs by hand against
/// production will work, without Claude ever touching production itself.
/// </summary>
[Collection(nameof(FxSchemaCollection))]
public sealed class FxSeedRunnerTests(FxSchemaFixture fixture)
{
    private readonly FxSchemaFixture _fixture = fixture;

    // This is the ONE test in the whole Fx suite that makes a REAL call to the public
    // open.er-api.com API (by design — see the class doc comment above; "a live rate is NEVER
    // golden-parity fixtured" means this can't be faked, it has to hit the real thing). That also
    // makes it the one test whose success depends on a third party's uptime/rate-limits, which is
    // NOT something an unrelated PR's CI run should be able to turn red. Tagged out of the default
    // CI run (dotnet-platform.yml filters "Category!=LiveNetwork") and run explicitly instead —
    // e.g. `dotnet test --filter "Category=LiveNetwork"` or the full `--filter Fx` for a local/manual
    // verification pass.
    [Fact]
    [Trait("Category", "LiveNetwork")]
    public async Task RunAsync_pins_the_seed_currencies_against_the_real_exchange_rate_api()
    {
        await _fixture.ResetAsync();

        var pinned = await FxSeedRunner.RunAsync(_fixture.ConnectionString, CancellationToken.None);

        // NOTE (2026-07-28, corrected 2026-07-29 — see
        // docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md):
        // the original outbound gateway called Frankfurter's v1 (ECB) batch endpoint, whose fixed
        // ~30-currency reference list did NOT publish rates for COP or CRC, so this test's
        // assertion was temporarily narrowed to the 2 currencies that endpoint *did* support
        // (EUR/MXN) when the gap was first discovered live. Frankfurter's v2 API does return real
        // COP/CRC rates (including via a real batch endpoint) — but its own `/v2/currencies`
        // catalog doesn't list either currency even though its rate endpoints serve real data for
        // both, an unexplained catalog/endpoint gap. IFxRateGateway's adapter has since been
        // swapped to ExchangeRateApiGateway, whose ~166-currency catalog consistently includes
        // both COP and CRC with no such mismatch — restoring the assertion below to its original
        // intent (all 4 seed currencies) now that the fix is verified live.
        Assert.True(pinned >= 4, $"expected all 4 seed currencies (COP/CRC/EUR/MXN) — the whole reason for the provider swap; got {pinned}");

        await using var db = _fixture.NewContext();
        var rows = await db.FxRates.AsNoTracking().ToListAsync();
        Assert.True(rows.Count >= 4);
        Assert.All(rows, row =>
        {
            Assert.Equal("USD", row.BaseCurrency);
            Assert.True(row.Rate > 0 && double.IsFinite(row.Rate));
        });
    }
}
