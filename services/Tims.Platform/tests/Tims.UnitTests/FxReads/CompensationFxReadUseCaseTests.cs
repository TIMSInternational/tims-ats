using Tims.Application.Compensation;
using Tims.Application.Fx;
using Tims.Domain.Access;
using Tims.Domain.Compensation;

namespace Tims.UnitTests.FxReads;

/// <summary>
/// Unit tests for the Slice-11c compensation FX reads with a FAKE repository + FAKE FX provider (no I/O). Covers
/// the two required bites at the read level: cold-start FAIL-SOFT (a missing pin suppresses the FX totals, never
/// throws) and the min-5 k-anon guard; plus the simulateAdjustment field-auth shape (the compaRatio/band block is
/// present ONLY when the caller is entitled to compaRatio).
/// </summary>
public sealed class CompensationFxReadUseCaseTests
{
    private const string Org = "11111111-1111-1111-1111-111111111111";

    private static CompensationFxReadUseCase Build(FakeRepo repo, FakeProvider provider) =>
        new(repo, new FxMoneyConverter(provider));

    [Fact]
    public async Task TotalComp_cold_start_missing_pin_fails_soft_to_suppressed_not_throw()
    {
        // Six rows, mixed USD + COP. The provider has NO COP→USD pin (cold start) → SumAsync null → suppress.
        var rows = new[]
        {
            new CompAmountRow(100000, 5000, "USD"),
            new CompAmountRow(90000, 4000, "USD"),
            new CompAmountRow(80000, 3000, "USD"),
            new CompAmountRow(70000, 2000, "USD"),
            new CompAmountRow(400000000, 1000, "COP"),
            new CompAmountRow(300000000, 0, "COP"),
        };
        var useCase = Build(new FakeRepo { Aggregate = new CompAggregateData(rows, "USD") }, new FakeProvider(coldStart: true));

        var view = await useCase.GetTotalCompBreakdownAsync(Org, default);

        Assert.True(view.Suppressed);
        Assert.Null(view.TotalComp);
    }

    [Fact]
    public async Task TotalComp_sub_floor_population_suppresses()
    {
        var rows = new[]
        {
            new CompAmountRow(100000, 0, "USD"),
            new CompAmountRow(90000, 0, "USD"),
            new CompAmountRow(80000, 0, "USD"),
        };
        var useCase = Build(new FakeRepo { Aggregate = new CompAggregateData(rows, "USD") }, new FakeProvider());

        var view = await useCase.GetTotalCompBreakdownAsync(Org, default);

        Assert.True(view.Suppressed);
    }

    [Fact]
    public async Task TotalComp_happy_single_currency_needs_no_pin_and_totals()
    {
        var rows = Enumerable.Range(0, 5).Select(_ => new CompAmountRow(100000, 10000, "USD")).ToArray();
        var useCase = Build(new FakeRepo { Aggregate = new CompAggregateData(rows, "USD") }, new FakeProvider(coldStart: true));

        var view = await useCase.GetTotalCompBreakdownAsync(Org, default);

        Assert.False(view.Suppressed); // identity conversions need no pin even in cold start
        Assert.Equal(550000, view.TotalComp);
        Assert.Equal(5, view.EmployeeCount);
    }

    [Fact]
    public async Task Simulate_omits_the_compaRatio_block_for_a_non_entitled_caller()
    {
        var repo = new FakeRepo
        {
            SimulateRow = new SimulateCompRow("rec-1", 100000, "USD", null, null, CanSeeCompaRatio: false),
        };
        var useCase = Build(repo, new FakeProvider());

        var result = await useCase.SimulateAdjustmentAsync(Org, Guid.NewGuid(), 110000, null, new[] { "currentSalary", "currency" }, default);

        Assert.Equal(SimulateAdjustmentResultKind.Ok, result.Kind);
        // The runtime type is the BASE record (the six compa/band keys ABSENT), NOT the derived compa view.
        Assert.IsType<SimulateAdjustmentView>(result.View); // exact type — not SimulateAdjustmentWithCompaView
        var view = (SimulateAdjustmentView)result.View!;
        Assert.Equal(10, view.PercentageChange); // (110000-100000)/100000*100
    }

    [Fact]
    public async Task Simulate_includes_the_compaRatio_block_for_an_entitled_caller_with_a_band()
    {
        var bandId = Guid.NewGuid();
        var repo = new FakeRepo
        {
            SimulateRow = new SimulateCompRow("rec-1", 100000, "USD", 0.95, bandId, CanSeeCompaRatio: true),
            SimulateBand = new SimulateBand(80000, 100000, 120000, "USD"),
        };
        var useCase = Build(repo, new FakeProvider());

        var result = await useCase.SimulateAdjustmentAsync(
            Org, Guid.NewGuid(), 110000, null, new[] { "currentSalary", "currency", "compaRatio", "bandId" }, default);

        Assert.Equal(SimulateAdjustmentResultKind.Ok, result.Kind);
        var view = Assert.IsType<SimulateAdjustmentWithCompaView>(result.View);
        Assert.Equal(0.95, view.CurrentCompaRatio);
        Assert.Equal(1.1, view.NewCompaRatio); // 110000 / 100000 midpoint
        Assert.Equal(80000, view.BandMin);
        Assert.Equal(true, view.WithinBand);
    }

    [Fact]
    public async Task Simulate_entitled_but_band_less_emits_all_six_keys_with_bandCurrency_equal_currentCurrency()
    {
        // FIX 3 bite: canSee == true + band == null (COMMON). All six compa/band keys are PRESENT (derived view):
        // newCompaRatio/bandMin/bandMax/withinBand null, bandCurrency = the CURRENT currency (never null).
        var repo = new FakeRepo
        {
            SimulateRow = new SimulateCompRow("rec-1", 100000, "COP", 1.02, BandId: null, CanSeeCompaRatio: true),
        };
        var useCase = Build(repo, new FakeProvider());

        var result = await useCase.SimulateAdjustmentAsync(
            Org, Guid.NewGuid(), 110000, null, new[] { "currentSalary", "currency", "compaRatio", "bandId" }, default);

        Assert.Equal(SimulateAdjustmentResultKind.Ok, result.Kind);
        var view = Assert.IsType<SimulateAdjustmentWithCompaView>(result.View);
        Assert.Equal(1.02, view.CurrentCompaRatio);
        Assert.Null(view.NewCompaRatio);
        Assert.Null(view.BandMin);
        Assert.Null(view.BandMax);
        Assert.Null(view.WithinBand);
        Assert.Equal("COP", view.BandCurrency); // currentCurrency fallback — NEVER null
    }

    [Fact]
    public async Task Simulate_cross_currency_missing_pin_returns_FxUnavailable_not_a_wrong_percent()
    {
        // FIX 2 bite: proposed EUR vs current USD, cold-start provider has no EUR→USD pin → FxUnavailable (→ 503),
        // NEVER a best-effort %change computed on an unconverted EUR amount treated as USD.
        var repo = new FakeRepo
        {
            SimulateRow = new SimulateCompRow("rec-1", 100000, "USD", null, null, CanSeeCompaRatio: false),
        };
        var useCase = Build(repo, new FakeProvider(coldStart: true));

        var result = await useCase.SimulateAdjustmentAsync(
            Org, Guid.NewGuid(), 90000, "EUR", new[] { "currentSalary", "currency" }, default);

        Assert.Equal(SimulateAdjustmentResultKind.FxUnavailable, result.Kind);
        Assert.Null(result.View);
    }

    [Fact]
    public async Task Simulate_identity_currency_needs_no_pin_even_in_cold_start()
    {
        // Identity (proposed == current) needs no pin → 200 even on cold start (contrast the cross-currency bite).
        var repo = new FakeRepo
        {
            SimulateRow = new SimulateCompRow("rec-1", 100000, "USD", null, null, CanSeeCompaRatio: false),
        };
        var useCase = Build(repo, new FakeProvider(coldStart: true));

        var result = await useCase.SimulateAdjustmentAsync(
            Org, Guid.NewGuid(), 110000, "USD", new[] { "currentSalary", "currency" }, default);

        Assert.Equal(SimulateAdjustmentResultKind.Ok, result.Kind);
        Assert.Equal(10, ((SimulateAdjustmentView)result.View!).PercentageChange);
    }

    [Fact]
    public async Task BandDistribution_display_currency_is_the_band_currency_with_a_USD_fallback_not_the_row_currency()
    {
        // FIX 8 bite: a band with an EMPTY/invalid currency → DISPLAY currency USD (normalizeCurrencyCode(band.currency)),
        // even though the conversion uses the nested row-currency fallback (COP → COP identity here).
        var rows = Enumerable.Range(0, 5)
            .Select(_ => new BandDistributionRow(100000, "COP", Guid.Parse("22222222-2222-2222-2222-222222222222"), "L1", "Band", 80000, 100000, 120000, ""))
            .ToList();
        var repo = new FakeRepo { BandData = new BandDistributionData(rows, 0, 0) };
        var useCase = Build(repo, new FakeProvider());

        var bands = await useCase.GetBandDistributionAsync(Org, default);

        Assert.Single(bands);
        Assert.Equal("USD", bands[0].Currency); // display currency = USD fallback, NOT the row currency "COP"
    }

    private sealed class FakeProvider(bool coldStart = false) : IFxRateProvider
    {
        public Task<FxPin?> GetPinAsync(string from, string to, CancellationToken cancellationToken)
        {
            if (string.Equals(from, to, StringComparison.Ordinal))
            {
                return Task.FromResult<FxPin?>(new FxPin(1.0, null, Identity: true));
            }

            // Cold start: no cross-currency pin → null (fail-soft). Otherwise a fixed COP↔USD rate with a date.
            return Task.FromResult(coldStart
                ? (FxPin?)null
                : new FxPin(0.00025, new DateOnly(2026, 7, 21), Identity: false));
        }
    }

    private sealed class FakeRepo : ICompensationReadRepository
    {
        public CompAggregateData Aggregate { get; set; } = new(Array.Empty<CompAmountRow>(), "USD");

        public SimulateCompRow? SimulateRow { get; set; }

        public SimulateBand? SimulateBand { get; set; }

        public BandDistributionData? BandData { get; set; }

        public Task<CompAggregateData> GetCompAggregateDataAsync(string organizationId, CancellationToken cancellationToken) =>
            Task.FromResult(Aggregate);

        public Task<SimulateCompRow?> GetSimulateRowAsync(
            string organizationId, Guid subjectUserId, IReadOnlyList<string> compensationFields, CancellationToken cancellationToken) =>
            Task.FromResult(SimulateRow);

        public Task<SimulateBand?> GetSimulateBandAsync(string organizationId, Guid bandId, CancellationToken cancellationToken) =>
            Task.FromResult(SimulateBand);

        public Task<CompDashboardData> GetDashboardDataAsync(string organizationId, CancellationToken cancellationToken) =>
            throw new NotImplementedException();

        public Task<BandDistributionData> GetBandDistributionDataAsync(string organizationId, CancellationToken cancellationToken) =>
            Task.FromResult(BandData ?? throw new NotImplementedException());

        public Task<IReadOnlyList<Tims.Domain.Compensation.SalaryBandRow>> GetSalaryBandsAsync(string organizationId, CancellationToken cancellationToken) =>
            throw new NotImplementedException();

        public Task<IReadOnlyList<Tims.Domain.Compensation.MarketComparisonRow>> GetMarketComparisonAsync(string organizationId, string? jobLevel, CancellationToken cancellationToken) =>
            throw new NotImplementedException();

        public Task<BenefitsUtilizationData> GetBenefitsUtilizationDataAsync(string organizationId, CancellationToken cancellationToken) =>
            throw new NotImplementedException();

        public Task<IReadOnlyList<Tims.Domain.Compensation.CompaRatioRow>> GetCompaRatioRowsAsync(string organizationId, CancellationToken cancellationToken) =>
            throw new NotImplementedException();

        public Task<PendingAdjustmentsResult> ListPendingAdjustmentsAsync(string organizationId, IReadOnlyList<string> adjustmentFields, ScopePredicate scope, CancellationToken cancellationToken) =>
            throw new NotImplementedException();

        public Task<EmployeeCompReadResult?> GetEmployeeCompAsync(string organizationId, Guid subjectUserId, IReadOnlyList<string> compensationFields, CancellationToken cancellationToken) =>
            throw new NotImplementedException();
    }
}
