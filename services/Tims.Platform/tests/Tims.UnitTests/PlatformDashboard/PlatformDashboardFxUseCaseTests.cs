using Tims.Application.Fx;
using Tims.Application.PlatformDashboard;

namespace Tims.UnitTests.PlatformDashboard;

/// <summary>
/// Unit coverage for the three FX-derived dashboard reads (Phase-5 slice 23 / issue #81, PR 3 of 3):
/// the month-boundary derivation, the plan-price fold over grouped counts, the two invoice buckets, and
/// the FX-unavailable path that must fail the WHOLE request rather than emit a partial total.
///
/// <para>These drive the use case through a FAKE repository, so they prove the orchestration and the
/// shaping. They deliberately do NOT stand in for the endpoint tests: a fake repository cannot kill a
/// mutation in the real one, which is a lesson this slice already paid for once.</para>
/// </summary>
public sealed class PlatformDashboardFxUseCaseTests
{
    private static readonly DateTime Now = new(2026, 8, 14, 12, 0, 0, DateTimeKind.Utc);

    // ── getDashboardKpis ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Kpis_derive_the_month_bounds_from_the_single_request_instant()
    {
        var repository = new FakeFxRepository();
        var useCase = new PlatformDashboardFxUseCase(repository, new FakeRateProvider());

        await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);

        Assert.Equal(Now, repository.KpiNow);
        Assert.Equal(new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc), repository.KpiMonthStart);

        // `new Date(y, m, 0, 23, 59, 59, 999)` — the final millisecond of the previous month, which is
        // exactly one millisecond before the month start.
        Assert.Equal(new DateTime(2026, 7, 31, 23, 59, 59, 999, DateTimeKind.Utc), repository.KpiPrevMonthEnd);
        Assert.Equal(new DateTime(2026, 8, 21, 12, 0, 0, DateTimeKind.Utc), repository.KpiSevenDaysFromNow);
    }

    [Fact]
    public async Task Kpis_fold_plan_prices_over_grouped_counts_and_ignore_unknown_plans()
    {
        var repository = new FakeFxRepository
        {
            Kpis = Inputs(
                activePlans: [new PlanCount("professional", 3), new PlanCount("enterprise", 2), new PlanCount("mystery", 7)],
                prevMonthPlans: [new PlanCount("starter", 1)]),
        };
        var useCase = new PlatformDashboardFxUseCase(repository, new FakeRateProvider());

        var result = await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);

        // 3 × 999 + 2 × 2499 = 2997 + 4998. The unknown plan contributes 0 — `PLAN_PRICES[plan] || 0`.
        Assert.Equal(7995, result.Value!.Mrr);
        Assert.Equal(499, result.Value.MrrPrevMonth);
    }

    [Fact]
    public async Task Kpis_report_an_identity_sum_as_unconverted_with_no_rate_date()
    {
        var repository = new FakeFxRepository
        {
            Kpis = Inputs(overdue: [new DashboardMoneyRow(1234.5, "USD"), new DashboardMoneyRow(10.005, "USD")]),
        };
        var useCase = new PlatformDashboardFxUseCase(repository, new FakeRateProvider());

        var result = await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);

        // roundMoney(10.005) = 10.01 — the Number.EPSILON bias lifts the exact half-cent boundary UP.
        Assert.Equal(1244.51, result.Value!.OutstandingAmount);
        Assert.False(result.Value.OutstandingConverted);
        Assert.Null(result.Value.OutstandingRatesAsOf);
        Assert.Equal("USD", result.Value.Currency);

        // The count is the ROW count, not the sum — two invoices.
        Assert.Equal(2, result.Value.OverdueInvoices);
    }

    [Fact]
    public async Task Kpis_thread_the_earliest_non_identity_pin_date_onto_the_wire()
    {
        var repository = new FakeFxRepository
        {
            Kpis = Inputs(overdue: [new DashboardMoneyRow(100, "EUR"), new DashboardMoneyRow(50, "USD")]),
        };
        var provider = new FakeRateProvider { EurToUsd = new FxPin(1.25, new DateOnly(2026, 7, 31), Identity: false) };
        var useCase = new PlatformDashboardFxUseCase(repository, provider);

        var result = await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);

        Assert.Equal(175, result.Value!.OutstandingAmount);
        Assert.True(result.Value.OutstandingConverted);
        Assert.Equal("2026-07-31", result.Value.OutstandingRatesAsOf);
    }

    // ── the FX-unavailable path ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Kpis_fail_the_whole_request_when_a_required_rate_is_missing()
    {
        var repository = new FakeFxRepository { Kpis = Inputs(overdue: [new DashboardMoneyRow(100, "JPY")]) };
        var useCase = new PlatformDashboardFxUseCase(repository, new FakeRateProvider());

        var result = await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);

        // NOT a suppressed field and NOT a zero — the counts this payload also carries are discarded with it.
        Assert.Equal(PlatformDashboardFxResultKind.FxUnavailable, result.Kind);
        Assert.Null(result.Value);
    }

    [Fact]
    public async Task RevenueByCustomer_fails_the_whole_request_when_one_organization_cannot_convert()
    {
        var repository = new FakeFxRepository
        {
            RevenueRows =
            [
                Revenue("org-1", outstanding: [new DashboardMoneyRow(10, "USD")]),
                Revenue("org-2", outstanding: [new DashboardMoneyRow(10, "JPY")]),
            ],
        };
        var useCase = new PlatformDashboardFxUseCase(repository, new FakeRateProvider());

        var result = await useCase.GetRevenueByCustomerAsync(Now, CancellationToken.None);

        // One unconvertible tenant takes the whole list down, exactly as a throw inside Promise.all does.
        Assert.Equal(PlatformDashboardFxResultKind.FxUnavailable, result.Kind);
    }

    [Fact]
    public async Task ChurnRisk_fails_the_whole_request_when_one_organization_cannot_convert()
    {
        var repository = new FakeFxRepository
        {
            ChurnRows = [Churn("org-1", overdue: [new DashboardMoneyRow(10, "JPY")])],
        };
        var useCase = new PlatformDashboardFxUseCase(repository, new FakeRateProvider());

        var result = await useCase.GetChurnRiskAsync(Now, CancellationToken.None);

        Assert.Equal(PlatformDashboardFxResultKind.FxUnavailable, result.Kind);
    }

    // ── getRevenueByCustomer ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RevenueByCustomer_credits_mrr_only_to_an_active_subscription()
    {
        var repository = new FakeFxRepository
        {
            RevenueRows =
            [
                Revenue("org-1", plan: "enterprise", status: "active"),
                Revenue("org-2", plan: "enterprise", status: "trialing"),
                Revenue("org-3", plan: null, status: null),
            ],
        };
        var useCase = new PlatformDashboardFxUseCase(repository, new FakeRateProvider());

        var rows = (await useCase.GetRevenueByCustomerAsync(Now, CancellationToken.None)).Value!;

        // Sorted by MRR descending, so the active enterprise tenant leads.
        Assert.Equal(["org-1", "org-2", "org-3"], rows.Select(r => r.OrgId));
        Assert.Equal(2499, rows[0].Mrr);
        Assert.Equal(0, rows[1].Mrr);

        // No subscription at all → the plan LABEL falls back to trial, and MRR to zero.
        Assert.Equal("trial", rows[2].Plan);
        Assert.Equal(0, rows[2].Mrr);
    }

    [Fact]
    public async Task RevenueByCustomer_sets_converted_when_EITHER_bucket_needed_a_rate()
    {
        var repository = new FakeFxRepository
        {
            RevenueRows =
            [
                Revenue("org-1", paid: [new DashboardMoneyRow(100, "EUR")], outstanding: [new DashboardMoneyRow(40, "USD")]),
                Revenue("org-2", paid: [new DashboardMoneyRow(100, "USD")], outstanding: [new DashboardMoneyRow(40, "USD")]),
            ],
        };
        var provider = new FakeRateProvider { EurToUsd = new FxPin(1.25, new DateOnly(2026, 7, 31), Identity: false) };
        var useCase = new PlatformDashboardFxUseCase(repository, provider);

        var rows = (await useCase.GetRevenueByCustomerAsync(Now, CancellationToken.None)).Value!;
        var org1 = rows.Single(r => r.OrgId == "org-1");
        var org2 = rows.Single(r => r.OrgId == "org-2");

        Assert.Equal(125, org1.PaidLast30d);
        Assert.Equal(40, org1.OutstandingAmount);
        Assert.True(org1.Converted); // the PAID bucket alone flipped it
        Assert.False(org2.Converted);

        // There is no ratesAsOf key on this payload at all — the dates are resolved and discarded by TS.
        Assert.DoesNotContain("ratesAsOf", System.Text.Json.JsonSerializer.Serialize(org1), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task RatesAsOf_is_the_EARLIEST_pin_date_across_the_rows_not_the_latest()
    {
        // Every other test in this PR — and every test in FxRatePinTests — has exactly ONE non-identity
        // pin date, so `asOf < earliestAsOf` in FxMoneyConverter could be flipped to `>` and stay green
        // everywhere. Two distinct dates is the only input that separates them, and this value is on a
        // platform-wide wire contract.
        var repository = new FakeFxRepository
        {
            Kpis = Inputs(overdue:
            [
                new DashboardMoneyRow(100, "EUR"),
                new DashboardMoneyRow(100, "GBP"),
                new DashboardMoneyRow(100, "USD"),
            ]),
        };
        var provider = new FakeRateProvider();
        provider.Pins["EUR"] = new FxPin(1.25, new DateOnly(2026, 7, 31), Identity: false);
        provider.Pins["GBP"] = new FxPin(1.5, new DateOnly(2026, 6, 15), Identity: false); // EARLIER
        var useCase = new PlatformDashboardFxUseCase(repository, provider);

        var result = await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);

        // The earlier of the two, regardless of which row was seen first — and the identity USD row
        // contributes no date at all rather than "today".
        Assert.Equal("2026-06-15", result.Value!.OutstandingRatesAsOf);
        Assert.Equal(375, result.Value.OutstandingAmount);
    }

    // ── the derived window bounds the repository receives ────────────────────────────────────────────

    [Fact]
    public async Task RevenueByCustomer_bounds_its_paid_bucket_at_thirty_days_before_the_request()
    {
        var repository = new FakeFxRepository();
        var useCase = new PlatformDashboardFxUseCase(repository, new FakeRateProvider());

        await useCase.GetRevenueByCustomerAsync(Now, CancellationToken.None);

        Assert.Equal(Now.AddDays(-30), repository.RevenueThirtyDaysAgo);
    }

    [Fact]
    public async Task ChurnRisk_bounds_its_recent_login_window_at_seven_days_before_the_request()
    {
        // This window is applied in SQL (`COUNT(*) FILTER (WHERE last_login_at >= bound)`), so no kernel
        // test can reach it and no fixture row sits on the boundary. Asserting the ARGUMENT is what makes
        // AddDays(-7) -> AddDays(-8) fail somewhere.
        var repository = new FakeFxRepository();
        var useCase = new PlatformDashboardFxUseCase(repository, new FakeRateProvider());

        await useCase.GetChurnRiskAsync(Now, CancellationToken.None);

        Assert.Equal(Now, repository.ChurnNow);
        Assert.Equal(Now.AddDays(-7), repository.ChurnSevenDaysAgo);
    }

    // ── the memo, and the deliberate ABSENCE of a cache ───────────────────────────────────────────────

    [Fact]
    public async Task A_currency_pair_is_resolved_once_per_request_however_many_rows_share_it()
    {
        var repository = new FakeFxRepository
        {
            Kpis = Inputs(overdue:
            [
                new DashboardMoneyRow(10, "EUR"),
                new DashboardMoneyRow(20, "EUR"),
                new DashboardMoneyRow(30, "EUR"),
            ]),
        };
        var provider = new FakeRateProvider { EurToUsd = new FxPin(1.25, new DateOnly(2026, 7, 31), Identity: false) };
        var useCase = new PlatformDashboardFxUseCase(repository, provider);

        var result = await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);

        // Three rows, ONE lookup — matching the TS rateCache, which makes every row of one procedure call
        // convert at the same rate. Without MemoizingFxRateProvider this is 3.
        Assert.Equal(1, provider.CallCount);
        Assert.Equal(75, result.Value!.OutstandingAmount);
    }

    [Fact]
    public async Task The_memo_does_NOT_survive_across_requests()
    {
        var repository = new FakeFxRepository { Kpis = Inputs(overdue: [new DashboardMoneyRow(10, "EUR")]) };
        var provider = new FakeRateProvider { EurToUsd = new FxPin(1.25, new DateOnly(2026, 7, 31), Identity: false) };
        var useCase = new PlatformDashboardFxUseCase(repository, provider);

        await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);
        await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);

        // A pin refreshed between two requests must be picked up by the second one, so the memo is built
        // per CALL. A field-level memo would make this 1.
        Assert.Equal(2, provider.CallCount);
    }

    [Fact]
    public async Task The_KPI_read_is_NOT_cached_unlike_its_TS_original()
    {
        var repository = new FakeFxRepository();
        var useCase = new PlatformDashboardFxUseCase(repository, new FakeRateProvider());

        await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);
        await useCase.GetDashboardKpisAsync(Now, CancellationToken.None);

        // TS wraps this ONE procedure in a 45-second cacheGet/cacheSet; the port deliberately does not
        // (Federico's call, 2026-08-15 — see PlatformDashboardFxUseCase for the three grounds). This pin
        // is what turns "we chose not to cache" into a fact a future edit has to argue with.
        Assert.Equal(2, repository.KpiCallCount);
    }

    // ── fakes ────────────────────────────────────────────────────────────────────────────────────────

    private static DashboardKpiInputs Inputs(
        IReadOnlyList<PlanCount>? activePlans = null,
        IReadOnlyList<PlanCount>? prevMonthPlans = null,
        IReadOnlyList<DashboardMoneyRow>? overdue = null) =>
        new(1, 2, 3, 4, activePlans ?? [], 5, 6, prevMonthPlans ?? [], overdue ?? []);

    private static RevenueOrgRow Revenue(
        string id,
        string? plan = "starter",
        string? status = "active",
        IReadOnlyList<DashboardMoneyRow>? paid = null,
        IReadOnlyList<DashboardMoneyRow>? outstanding = null) =>
        new(id, $"Org {id}", plan, status, paid ?? [], outstanding ?? [], 0, null);

    private static ChurnOrgRow Churn(string id, IReadOnlyList<DashboardMoneyRow>? overdue = null) =>
        new(id, $"Org {id}", Now.AddDays(-400), "starter", "active", null, overdue ?? [], 1, 1, Now, 0);

    private sealed class FakeFxRepository : IPlatformDashboardFxRepository
    {
        public DashboardKpiInputs Kpis { get; init; } = Inputs();

        public IReadOnlyList<RevenueOrgRow> RevenueRows { get; init; } = [];

        public IReadOnlyList<ChurnOrgRow> ChurnRows { get; init; } = [];

        public int KpiCallCount { get; private set; }

        public DateTime KpiNow { get; private set; }

        public DateTime KpiMonthStart { get; private set; }

        public DateTime KpiPrevMonthEnd { get; private set; }

        public DateTime KpiSevenDaysFromNow { get; private set; }

        public Task<DashboardKpiInputs> GetKpiInputsAsync(
            DateTime nowUtc,
            DateTime monthStartUtc,
            DateTime prevMonthEndUtc,
            DateTime sevenDaysFromNowUtc,
            CancellationToken cancellationToken)
        {
            KpiCallCount++;
            KpiNow = nowUtc;
            KpiMonthStart = monthStartUtc;
            KpiPrevMonthEnd = prevMonthEndUtc;
            KpiSevenDaysFromNow = sevenDaysFromNowUtc;
            return Task.FromResult(Kpis);
        }

        // RECORDED, not discarded. The first draft of this fake threw these bounds away while the KPI
        // method captured all four — an asymmetry that made the -30 and -7 day windows unreachable from
        // any unit test, and the -7 one unreachable from ANY test (it is computed in SQL, so the
        // integration fixture is the only other place it could be caught, and no fixture row sits on it).
        public DateTime RevenueThirtyDaysAgo { get; private set; }

        public DateTime ChurnNow { get; private set; }

        public DateTime ChurnSevenDaysAgo { get; private set; }

        public Task<IReadOnlyList<RevenueOrgRow>> GetRevenueRowsAsync(
            DateTime thirtyDaysAgoUtc,
            CancellationToken cancellationToken)
        {
            RevenueThirtyDaysAgo = thirtyDaysAgoUtc;
            return Task.FromResult(RevenueRows);
        }

        public Task<IReadOnlyList<ChurnOrgRow>> GetChurnRowsAsync(
            DateTime nowUtc,
            DateTime sevenDaysAgoUtc,
            CancellationToken cancellationToken)
        {
            ChurnNow = nowUtc;
            ChurnSevenDaysAgo = sevenDaysAgoUtc;
            return Task.FromResult(ChurnRows);
        }
    }

    /// <summary>Resolves an identity pair itself (as the real provider does, before any DB touch), any
    /// explicitly configured pin, and <c>null</c> for everything else — the cold-start shape.</summary>
    private sealed class FakeRateProvider : IFxRateProvider
    {
        /// <summary>Shorthand for the common single-pin case.</summary>
        public FxPin? EurToUsd
        {
            init
            {
                if (value is not null)
                {
                    Pins["EUR"] = value;
                }
            }
        }

        /// <summary>Source currency → pin, for the cases needing more than one.</summary>
        public Dictionary<string, FxPin> Pins { get; } = new(StringComparer.Ordinal);

        public int CallCount { get; private set; }

        public Task<FxPin?> GetPinAsync(string from, string to, CancellationToken cancellationToken)
        {
            CallCount++;

            if (string.Equals(from, to, StringComparison.Ordinal))
            {
                return Task.FromResult<FxPin?>(new FxPin(1.0, null, Identity: true));
            }

            return Task.FromResult(
                string.Equals(to, "USD", StringComparison.Ordinal) && Pins.TryGetValue(from, out var pin)
                    ? pin
                    : null);
        }
    }
}
