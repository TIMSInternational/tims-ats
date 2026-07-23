using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure;
using Tims.Infrastructure.Fx;

namespace Tims.IntegrationTests.Fx;

/// <summary>
/// Real-RLS Testcontainers proof for the fx_rates pin plane (Slice 11c): the idempotent refresh upsert, the
/// RLS-EXEMPT-but-app_tenant-SELECT posture, and the FxRateProvider's cross-rate + FAIL-SOFT cold-start. Uses
/// the SAME migration that ships (applied by <see cref="FxSchemaFixture"/>).
/// </summary>
[Collection(nameof(FxSchemaCollection))]
public sealed class FxRatePinTests(FxSchemaFixture fixture)
{
    private readonly FxSchemaFixture _fixture = fixture;

    private static IReadOnlyDictionary<string, double> Rates(params (string Quote, double Rate)[] pairs) =>
        pairs.ToDictionary(p => p.Quote, p => p.Rate, StringComparer.Ordinal);

    [Fact]
    public async Task Upsert_is_idempotent_same_as_of_updates_in_place_new_as_of_adds_a_row()
    {
        await _fixture.ResetAsync();
        await using var db = _fixture.NewContext();
        var repo = new FxRateWriteRepository(db);
        var asOf1 = new DateOnly(2026, 7, 21);
        var asOf2 = new DateOnly(2026, 7, 22);

        // First pin for as_of1.
        var w1 = await repo.UpsertRatesAsync("USD", asOf1, Rates(("COP", 4000)), DateTime.UtcNow, "frankfurter", default);
        Assert.Equal(1, w1);

        // SAME as_of, new rate → the existing row is UPDATED in place (no duplicate).
        var w2 = await repo.UpsertRatesAsync("USD", asOf1, Rates(("COP", 4001)), DateTime.UtcNow, "frankfurter", default);
        Assert.Equal(1, w2);

        await using (var verify = _fixture.NewContext())
        {
            var sameAsOfRows = await verify.FxRates.AsNoTracking()
                .Where(r => r.BaseCurrency == "USD" && r.QuoteCurrency == "COP" && r.AsOf == asOf1)
                .ToListAsync();
            Assert.Single(sameAsOfRows); // NO duplicate for the same as_of
            Assert.Equal(4001, sameAsOfRows[0].Rate); // rate refreshed in place
        }

        // A NEW as_of → a NEW row (history preserved).
        await repo.UpsertRatesAsync("USD", asOf2, Rates(("COP", 4002)), DateTime.UtcNow, "frankfurter", default);
        await using (var verify = _fixture.NewContext())
        {
            var allCop = await verify.FxRates.AsNoTracking()
                .Where(r => r.BaseCurrency == "USD" && r.QuoteCurrency == "COP")
                .ToListAsync();
            Assert.Equal(2, allCop.Count);
        }
    }

    [Fact]
    public async Task Fx_rates_is_RLS_exempt_a_tenant_read_with_NO_org_GUC_still_returns_the_pin()
    {
        await _fixture.ResetAsync();
        await using (var seed = _fixture.NewContext())
        {
            await new FxRateWriteRepository(seed).UpsertRatesAsync(
                "USD", new DateOnly(2026, 7, 21), Rates(("COP", 4000)), DateTime.UtcNow, "frankfurter", default);
        }

        // Read UNDER a tenant scope: SET LOCAL ROLE app_tenant + an EMPTY org GUC (organizationId: null). For an
        // RLS-protected table the fail-closed policy would hide EVERY row; fx_rates has NO policy (RLS-EXEMPT) and
        // app_tenant was GRANTed SELECT, so the pin is still visible — the exemption + the grant both proven.
        await using var db = _fixture.NewContext();
        await using var scope = await TenantScope.BeginAsync(db, organizationId: null);
        var count = await db.FxRates.AsNoTracking().CountAsync();
        await scope.CommitAsync();

        Assert.Equal(1, count);
    }

    [Fact]
    public async Task Provider_cross_rates_through_the_USD_base_and_fails_soft_on_cold_start()
    {
        await _fixture.ResetAsync();
        await using (var seed = _fixture.NewContext())
        {
            await new FxRateWriteRepository(seed).UpsertRatesAsync(
                "USD",
                new DateOnly(2026, 7, 21),
                Rates(("COP", 4000), ("EUR", 0.92)),
                DateTime.UtcNow,
                "frankfurter",
                default);
        }

        await using var db = _fixture.NewContext();
        var provider = new FxRateProvider(db);

        // identity → 1 with no pin needed, no date, Identity flag set
        var usdUsd = await provider.GetPinAsync("USD", "USD", default);
        Assert.Equal(1.0, usdUsd!.Rate);
        Assert.True(usdUsd.Identity);
        Assert.Null(usdUsd.AsOf);
        Assert.Equal(1.0, (await provider.GetPinAsync("COP", "COP", default))!.Rate);
        // base → quote is the direct pin, carrying the pin's effective date (non-identity)
        var usdCop = await provider.GetPinAsync("USD", "COP", default);
        Assert.Equal(4000, usdCop!.Rate);
        Assert.False(usdCop.Identity);
        Assert.Equal(new DateOnly(2026, 7, 21), usdCop.AsOf);
        // quote → base is 1 / pin
        Assert.Equal(1.0 / 4000, (await provider.GetPinAsync("COP", "USD", default))!.Rate);
        // cross-rate through USD: COP → EUR = rate(USD→EUR) / rate(USD→COP)
        var copEur = await provider.GetPinAsync("COP", "EUR", default);
        Assert.Equal(0.92 / 4000, copEur!.Rate);
        Assert.Equal(new DateOnly(2026, 7, 21), copEur.AsOf); // earliest non-identity leg date
        // FAIL-SOFT cold start: JPY was never pinned → null (the read omits/suppresses the FX field, never 500)
        Assert.Null(await provider.GetPinAsync("COP", "JPY", default));
        Assert.Null(await provider.GetPinAsync("JPY", "USD", default));
    }

    [Fact]
    public async Task Provider_reads_the_LATEST_effective_dated_pin()
    {
        await _fixture.ResetAsync();
        await using (var seed = _fixture.NewContext())
        {
            var repo = new FxRateWriteRepository(seed);
            await repo.UpsertRatesAsync("USD", new DateOnly(2026, 7, 20), Rates(("COP", 4000)), DateTime.UtcNow, "frankfurter", default);
            await repo.UpsertRatesAsync("USD", new DateOnly(2026, 7, 22), Rates(("COP", 4200)), DateTime.UtcNow, "frankfurter", default);
        }

        await using var db = _fixture.NewContext();
        var provider = new FxRateProvider(db);

        // Two pins for USD→COP; the provider takes the newest as_of (2026-07-22 → 4200).
        var latest = await provider.GetPinAsync("USD", "COP", default);
        Assert.Equal(4200, latest!.Rate);
        Assert.Equal(new DateOnly(2026, 7, 22), latest.AsOf); // the newest effective date is surfaced
    }
}
