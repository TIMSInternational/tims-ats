using Tims.Application.Fx;
using Tims.Domain.Compensation;

namespace Tims.Application.PlatformDashboard;

/// <summary>
/// The three FX-DERIVED platform dashboard reads (Phase-5 slice 23 / issue #81, PR 3 of 3):
/// <c>getDashboardKpis</c>, <c>getRevenueByCustomer</c> and <c>getChurnRisk</c>. What sets them apart from
/// the nine already ported is one call each to <c>sumMoney</c>, which resolves a rate before any arithmetic
/// can happen — so unlike every other read in this cluster, these three can FAIL for a reason that is not
/// about their own data.
///
/// <para><b>The FX plane is consulted through a per-call <see cref="MemoizingFxRateProvider"/>.</b> Each
/// method builds its own converter over the injected provider, so a currency pair is resolved at most once
/// per request — matching the TS side, whose <c>getFxRate</c> cache makes every row of one procedure call
/// convert at the same rate. See that class for why this is fidelity rather than an optimization.</para>
///
/// <para><b>A missing pin is a 503, not a suppressed field.</b> <c>FxMoneyConverter.SumAsync</c> returns
/// <c>null</c> fail-soft; every method here turns the first such null into
/// <see cref="PlatformDashboardFxResultKind.FxUnavailable"/> and abandons the whole payload, because TS's
/// <c>getFxRate</c> throws and takes the entire procedure down with it. See
/// <see cref="PlatformDashboardFxResultKind"/> for the full argument and who decided it.</para>
///
/// <para><b>No cache, and that is a DELIBERATE, recorded divergence.</b> TS's <c>getDashboardKpis</c> — and
/// only that one, of all thirteen — wraps its result in a 45-second <c>cacheGet</c>/<c>cacheSet</c> under
/// the key <c>tims:kpis:platform:global</c>. This port does not. Federico's call, 2026-08-15, on three
/// grounds: writing the SAME key from both stacks would let whichever answered first serve its payload to
/// the other, which during the dark period means a C#-shaped body reaching live TS callers and, in a parity
/// run, a payload being compared against ITSELF; a C#-only key would reproduce the staleness while adding a
/// stale-versus-fresh flake to every parity run; and the divergence that remains is invisible on the wire —
/// it is freshness, not shape. Recorded in
/// <c>docs/architecture/csharp-migration/phase-5-slice-23-pr3-dashboard-fx.md</c> §Recorded divergences and
/// pinned by <c>PlatformDashboardFxUseCaseTests</c>.</para>
/// </summary>
public sealed class PlatformDashboardFxUseCase(
    IPlatformDashboardFxRepository repository,
    IFxRateProvider rateProvider)
{
    private readonly IPlatformDashboardFxRepository _repository = repository;

    private readonly IFxRateProvider _rateProvider = rateProvider;

    /// <summary>The display currency every one of the three procedures converts INTO —
    /// <c>PLATFORM_BILLING_CURRENCY</c>, hardcoded at each call site in TS rather than configured.</summary>
    public const string DisplayCurrency = CurrencyCodes.PlatformBillingCurrency;

    // ── getDashboardKpis ─────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>getDashboardKpis</c> — nine counts plus the outstanding-invoice total.
    ///
    /// <para><b>The month bounds are UTC here and HOST-LOCAL in TS, which is the same recorded assumption
    /// <c>getMrrForecast</c> carries.</b> TS writes <c>new Date(now.getFullYear(), now.getMonth(), 1)</c> —
    /// the LOCAL-time constructor, not <c>Date.UTC</c> — so both "this month" deltas and the previous-month
    /// MRR snapshot move with the deployed Node process's zone. Mirroring that would import the C# host's
    /// zone instead, which is strictly worse; the two agree exactly while both hosts run UTC, which is how
    /// this platform deploys. See <see cref="PlatformDashboardReadUseCase.MonthBucketKeys"/> for the same
    /// argument at length.</para>
    ///
    /// <para><c>prevMonthStart</c> is computed by the TS procedure and never read. Not reproduced — the
    /// same disposition as <c>getCustomerHealth</c>'s unused <c>fourteenDaysAgo</c>.</para>
    /// </summary>
    public async Task<PlatformDashboardFxResult<PlatformDashboardKpis>> GetDashboardKpisAsync(
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var monthStart = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        // `new Date(y, m, 0, 23, 59, 59, 999)` — day ZERO of the current month is the last day of the
        // previous one, at its final millisecond. That is exactly one millisecond before the month start,
        // which is how it is expressed here so the two bounds cannot drift apart.
        var prevMonthEnd = monthStart.AddMilliseconds(-1);

        var sevenDaysFromNow = nowUtc.AddDays(7);

        var inputs = await _repository
            .GetKpiInputsAsync(nowUtc, monthStart, prevMonthEnd, sevenDaysFromNow, cancellationToken)
            .ConfigureAwait(false);

        var converter = NewConverter();
        var outstanding = await converter
            .SumAsync(ToMoneyRows(inputs.OverdueInvoices), DisplayCurrency, cancellationToken)
            .ConfigureAwait(false);

        if (outstanding is not { } sum)
        {
            return PlatformDashboardFxResult<PlatformDashboardKpis>.FxUnavailable();
        }

        return PlatformDashboardFxResult<PlatformDashboardKpis>.Ok(new PlatformDashboardKpis(
            inputs.TotalOrgs,
            inputs.NewOrgsThisMonth,
            inputs.TotalUsers,
            inputs.NewUsersThisMonth,
            SumPlanPrices(inputs.ActivePlans),
            SumPlanPrices(inputs.PrevMonthActivePlans),
            inputs.ActiveTrials,
            inputs.TrialsExpiringSoon,
            inputs.OverdueInvoices.Count,
            sum.Amount,
            DisplayCurrency,
            sum.Converted,
            sum.RatesAsOf));
    }

    /// <summary><c>subs.reduce((sum, s) =&gt; sum + (PLAN_PRICES[s.plan] || 0), 0)</c>, evaluated over
    /// grouped counts instead of individual rows. <see cref="PlanPrices.For"/> carries the <c>|| 0</c>, so
    /// an unknown plan contributes nothing rather than throwing.</summary>
    public static long SumPlanPrices(IReadOnlyList<PlanCount> plans) =>
        plans.Sum(p => (long)p.Count * PlanPrices.For(p.Plan));

    // ── getRevenueByCustomer ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>getRevenueByCustomer</c> — one row per organization, sorted by MRR descending.
    ///
    /// <para>TWO sums per organization, folded through the same memoized converter, and either one being
    /// unresolvable fails the whole request. The <c>converted</c> flag on the wire is the OR of both, so a
    /// tenant billed in mixed currencies reports <c>true</c> even when only one bucket needed a rate.</para>
    ///
    /// <para><b>The sort is stable and its input order is unspecified.</b> TS sorts an array built from an
    /// unordered <c>findMany</c>, so two organizations on the same plan can legitimately come back in
    /// different orders from the two stacks. That is a property of the procedure — recorded as a parity
    /// caveat, not patched with an <c>ORDER BY</c> TS does not send.</para>
    /// </summary>
    public async Task<PlatformDashboardFxResult<IReadOnlyList<RevenueByCustomerRow>>> GetRevenueByCustomerAsync(
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var thirtyDaysAgo = nowUtc.AddDays(-30);
        var rows = await _repository.GetRevenueRowsAsync(thirtyDaysAgo, cancellationToken).ConfigureAwait(false);

        var converter = NewConverter();
        var result = new List<RevenueByCustomerRow>(rows.Count);

        foreach (var row in rows)
        {
            var paid = await converter
                .SumAsync(ToMoneyRows(row.PaidLast30d), DisplayCurrency, cancellationToken)
                .ConfigureAwait(false);
            var outstanding = await converter
                .SumAsync(ToMoneyRows(row.Outstanding), DisplayCurrency, cancellationToken)
                .ConfigureAwait(false);

            if (paid is not { } paidSum || outstanding is not { } outstandingSum)
            {
                return PlatformDashboardFxResult<IReadOnlyList<RevenueByCustomerRow>>.FxUnavailable();
            }

            var plan = row.SubscriptionPlan ?? PlatformDashboardAccountsUseCase.DefaultPlan;
            var isActive = string.Equals(row.SubscriptionStatus, "active", StringComparison.Ordinal);

            result.Add(new RevenueByCustomerRow(
                row.OrgId,
                row.OrgName,
                plan,
                isActive ? PlanPrices.For(plan) : 0,
                paidSum.Amount,
                outstandingSum.Amount,
                DisplayCurrency,
                paidSum.Converted || outstandingSum.Converted,
                row.UserCount,
                row.LastActiveAt));
        }

        return PlatformDashboardFxResult<IReadOnlyList<RevenueByCustomerRow>>.Ok(
            result.OrderByDescending(r => r.Mrr).ToList());
    }

    // ── getChurnRisk ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>getChurnRisk</c> — the five-signal health score per organization, worst first.
    ///
    /// <para>One sum per organization over its OVERDUE invoices. The converted total is not just a wire
    /// field: it is interpolated into the risk DESCRIPTION through
    /// <c>toLocaleString()</c>, so the FX result reaches the payload as text as well as a number. The
    /// scoring itself is pure and lives in <see cref="ChurnRiskKernel"/>.</para>
    /// </summary>
    public async Task<PlatformDashboardFxResult<ChurnRiskResult>> GetChurnRiskAsync(
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var sevenDaysAgo = nowUtc.AddDays(-7);

        // `thirtyDaysAgo` is computed by the TS procedure and never used — same disposition as
        // getDashboardKpis' prevMonthStart and getCustomerHealth's fourteenDaysAgo.
        var rows = await _repository.GetChurnRowsAsync(nowUtc, sevenDaysAgo, cancellationToken).ConfigureAwait(false);

        var converter = NewConverter();
        var converted = new List<ChurnOrgConverted>(rows.Count);

        foreach (var row in rows)
        {
            var overdue = await converter
                .SumAsync(ToMoneyRows(row.OverdueInvoices), DisplayCurrency, cancellationToken)
                .ConfigureAwait(false);

            if (overdue is not { } sum)
            {
                return PlatformDashboardFxResult<ChurnRiskResult>.FxUnavailable();
            }

            converted.Add(new ChurnOrgConverted(row, sum.Amount, sum.Converted));
        }

        return PlatformDashboardFxResult<ChurnRiskResult>.Ok(ChurnRiskKernel.Build(converted, nowUtc));
    }

    // ── shared plumbing ──────────────────────────────────────────────────────────────────────────────

    /// <summary>A converter over a FRESH memo — one per use-case call, never shared between requests.</summary>
    private FxMoneyConverter NewConverter() => new(new MemoizingFxRateProvider(_rateProvider));

    /// <summary>The repository's row shape as <c>FxMoneyConverter.SumAsync</c> wants it. The converter
    /// normalizes each currency itself (<c>null</c> → <c>USD</c>), exactly as the TS <c>sumMoney</c> does.
    /// </summary>
    private static IReadOnlyList<(double Amount, string? Currency)> ToMoneyRows(IReadOnlyList<DashboardMoneyRow> rows) =>
        rows.Select(r => (r.Amount, r.Currency)).ToList();
}
