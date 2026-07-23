using Tims.Application.Fx;
using Tims.Domain.Access;
using Tims.Domain.Compensation;

namespace Tims.Application.Compensation;

/// <summary>
/// The FIVE FX-derived compensation reads (Phase-5 Slice 11c) — faithful ports of the deferred bodies of the TS
/// <c>compensation</c> router (getBandDistribution / getPayEquity / getTotalCompBreakdown / getDashboardKpis /
/// simulateAdjustment). This use case does the IMPURE work — repository fetch + FX conversion through the DB-pinned
/// rates (<see cref="FxMoneyConverter"/>) — then hands the ALREADY-CONVERTED amounts + counts + provenance to the
/// PURE <see cref="CompensationKernels"/> shapers (golden-fixtured BOTH stacks). FAIL-SOFT (Federico's DB-pin
/// decision): a cold-start missing pin surfaces as a <c>null</c> conversion → the read omits/suppresses the
/// FX-derived field. simulateAdjustment is the ONE exception (FIX 2): a REQUIRED cross-rate pin missing returns a
/// distinct <see cref="SimulateAdjustmentResultKind.FxUnavailable"/> → 503, NEVER a best-effort wrong %change.
/// </summary>
public sealed class CompensationFxReadUseCase(ICompensationReadRepository repository, FxMoneyConverter fx)
{
    private const string Usd = CurrencyCodes.DefaultCurrency;

    private readonly ICompensationReadRepository _repository = repository;
    private readonly FxMoneyConverter _fx = fx;

    // ── getBandDistribution ─────────────────────────────────────────────────────
    public async Task<IReadOnlyList<BandDistributionBand>> GetBandDistributionAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetBandDistributionDataAsync(organizationId, cancellationToken).ConfigureAwait(false);

        var rows = new List<BandDistributionKernelRow>(data.Rows.Count);
        foreach (var row in data.Rows)
        {
            if (!(row.CurrentSalary > 0))
            {
                continue; // non-positive-salary banded rows are folded into the trigger, never plotted
            }

            // Conversion currency = nested fallback (band → row → USD); DISPLAY currency = normalizeCurrencyCode(
            // band.currency) with a USD fallback (FIX 8 — the display code must NOT inherit the row-currency nested
            // fallback, matching the TS `currency: normalizeCurrencyCode(c.band.currency)`).
            var conversionCurrency = CurrencyCodes.NormalizeCurrencyCode(
                row.BandCurrency, CurrencyCodes.NormalizeCurrencyCode(row.Currency, Usd));
            var displayCurrency = CurrencyCodes.NormalizeCurrencyCode(row.BandCurrency, Usd);
            var converted = await _fx.ConvertAmountAsync(row.CurrentSalary, row.Currency, conversionCurrency, cancellationToken)
                .ConfigureAwait(false);
            if (converted is not { } salaryInBandCurrency)
            {
                return Array.Empty<BandDistributionBand>(); // FX-unavailable → omit the FX-derived surface
            }

            rows.Add(new BandDistributionKernelRow(
                row.BandId.ToString(),
                row.BandLevel ?? string.Empty,
                row.BandTitle ?? string.Empty,
                row.BandMin,
                row.BandMid,
                row.BandMax,
                displayCurrency,
                salaryInBandCurrency));
        }

        var nonPositiveBanded = data.Rows.Count - rows.Count;
        return CompensationKernels.BuildBandDistribution(
            rows, data.UnassignedCount, nonPositiveBanded, data.PositiveUnbandedCount);
    }

    // ── getPayEquity (single org-wide 'all' group) ──────────────────────────────
    public async Task<CompPayEquityView> GetPayEquityAsync(string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetCompAggregateDataAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var displayCurrency = CurrencyCodes.NormalizeCurrencyCode(data.DisplayCurrency, Usd);

        var salaries = new List<double>();
        foreach (var row in data.Rows)
        {
            var amount = row.CurrentSalary;
            if (!(amount > 0))
            {
                continue;
            }

            var converted = await _fx.ConvertAmountAsync(amount, row.Currency, displayCurrency, cancellationToken)
                .ConfigureAwait(false);
            if (converted is not { } value)
            {
                // FX-unavailable → suppress the 'all' group (count/stats null), never a 500 (fail-soft, like dei).
                return new CompPayEquityView(
                    "all",
                    new[] { new CompPayEquityGroup("all", null, true, null, null) },
                    displayCurrency);
            }

            salaries.Add(value);
        }

        return CompensationKernels.BuildCompPayEquity(salaries, displayCurrency);
    }

    // ── getTotalCompBreakdown ───────────────────────────────────────────────────
    public async Task<TotalCompBreakdownView> GetTotalCompBreakdownAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetCompAggregateDataAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var displayCurrency = CurrencyCodes.NormalizeCurrencyCode(data.DisplayCurrency, Usd);

        var baseContributors = data.Rows.Count(r => r.CurrentSalary > 0);
        var variableContributors = data.Rows.Count(r => (r.VariablePay ?? 0) > 0);
        var nonPositiveContributors = data.Rows.Count - baseContributors;

        // Suppress over the counts BEFORE any FX so a sub-floor cohort never triggers a live rate fetch (mirrors
        // the TS early skip-FX path). totals stay null when suppressed; the kernel re-derives the same trigger.
        var suppressed = Suppressed(data.Rows.Count) || Suppressed(baseContributors)
            || Suppressed(variableContributors) || Suppressed(nonPositiveContributors);

        TotalCompTotals? totals = null;
        if (!suppressed)
        {
            var baseTotal = await _fx.SumAsync(
                data.Rows.Where(r => r.CurrentSalary > 0).Select(r => (r.CurrentSalary, r.Currency)).ToList(),
                displayCurrency,
                cancellationToken).ConfigureAwait(false);
            var variableTotal = await _fx.SumAsync(
                data.Rows.Where(r => (r.VariablePay ?? 0) > 0).Select(r => (r.VariablePay ?? 0, r.Currency)).ToList(),
                displayCurrency,
                cancellationToken).ConfigureAwait(false);

            // FX-unavailable (cold start) → leave totals null so the kernel emits the suppressed shape, never a 500.
            if (baseTotal is { } b && variableTotal is { } v)
            {
                totals = new TotalCompTotals(
                    b.Amount, v.Amount, b.Converted || v.Converted, EarliestRatesAsOf(b.RatesAsOf, v.RatesAsOf));
            }
        }

        return CompensationKernels.BuildTotalCompBreakdown(
            data.Rows.Count, baseContributors, variableContributors, totals, displayCurrency);
    }

    // ── getDashboardKpis ────────────────────────────────────────────────────────
    public async Task<CompDashboardKpisView> GetDashboardKpisAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetDashboardDataAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var displayCurrency = CurrencyCodes.NormalizeCurrencyCode(data.DisplayCurrency, Usd);

        // Skip the payroll FX sum for a suppressed compensated cohort (no live rate fetch). A missing pin while
        // NOT k-anon-suppressed leaves payroll null → the kernel's fxUnavailable fail-soft suppresses the aggregates.
        DashboardPayroll? payroll = null;
        if (!Suppressed(data.CompensatedCount))
        {
            var sum = await _fx.SumAsync(
                data.CompensatedRows.Select(r => (r.CurrentSalary, r.Currency)).ToList(),
                displayCurrency,
                cancellationToken).ConfigureAwait(false);
            if (sum is { } s)
            {
                payroll = new DashboardPayroll(s.Amount, s.Converted, s.RatesAsOf);
            }
        }

        return CompensationKernels.BuildCompDashboardKpis(
            data.CompensatedCount,
            data.CompaRatioCount,
            data.PendingAdjustments,
            data.ActiveEmployees,
            data.BenefitEnrollmentCounts,
            data.CompaRatioAvg,
            payroll,
            displayCurrency);
    }

    // ── simulateAdjustment ──────────────────────────────────────────────────────
    public async Task<SimulateAdjustmentResult> SimulateAdjustmentAsync(
        string organizationId,
        Guid subjectUserId,
        double proposedSalary,
        string? proposedCurrencyInput,
        IReadOnlyList<string> compensationFields,
        CancellationToken cancellationToken)
    {
        var row = await _repository.GetSimulateRowAsync(organizationId, subjectUserId, compensationFields, cancellationToken)
            .ConfigureAwait(false);
        if (row is null)
        {
            return new SimulateAdjustmentResult(SimulateAdjustmentResultKind.NotFound, null, null);
        }

        var currentSalary = row.CurrentSalary ?? 0;
        var currentCurrency = CurrencyCodes.NormalizeCurrencyCode(row.Currency, Usd);
        var proposedCurrency = CurrencyCodes.NormalizeCurrencyCode(proposedCurrencyInput, currentCurrency);

        // Convert proposed → current for the %change. Identity (proposed == current) needs no pin. FIX 2: a
        // REQUIRED cross-rate that is missing returns FxUnavailable — NEVER a best-effort unconverted %change.
        var comparison = await _fx.ConvertAmountAsync(proposedSalary, proposedCurrency, currentCurrency, cancellationToken)
            .ConfigureAwait(false);
        if (comparison is not { } proposedSalaryForComparison)
        {
            return new SimulateAdjustmentResult(SimulateAdjustmentResultKind.FxUnavailable, null, null);
        }

        if (!row.CanSeeCompaRatio)
        {
            var baseView = CompensationKernels.BuildSimulateAdjustment(
                currentSalary, currentCurrency, proposedSalary, proposedCurrency, proposedSalaryForComparison, compa: null);
            return new SimulateAdjustmentResult(SimulateAdjustmentResultKind.Ok, baseView, row.RecordId);
        }

        var band = row.BandId is { } bandId
            ? await _repository.GetSimulateBandAsync(organizationId, bandId, cancellationToken).ConfigureAwait(false)
            : null;
        var bandCurrency = band is not null
            ? CurrencyCodes.NormalizeCurrencyCode(band.Currency, currentCurrency)
            : currentCurrency;

        double proposedSalaryForBand;
        if (band is not null)
        {
            var convertedForBand = await _fx.ConvertAmountAsync(proposedSalary, proposedCurrency, bandCurrency, cancellationToken)
                .ConfigureAwait(false);
            if (convertedForBand is not { } forBand)
            {
                return new SimulateAdjustmentResult(SimulateAdjustmentResultKind.FxUnavailable, null, null);
            }

            proposedSalaryForBand = forBand;
        }
        else
        {
            proposedSalaryForBand = proposedSalaryForComparison;
        }

        var compa = new SimulateCompaInput(
            row.CompaRatio ?? 0,
            band is not null ? new SimulateBandInput(band.MinSalary, band.MidSalary, band.MaxSalary, bandCurrency) : null,
            proposedSalaryForBand);
        var view = CompensationKernels.BuildSimulateAdjustment(
            currentSalary, currentCurrency, proposedSalary, proposedCurrency, proposedSalaryForComparison, compa);
        return new SimulateAdjustmentResult(SimulateAdjustmentResultKind.Ok, view, row.RecordId);
    }

    private static bool Suppressed(int count) => KAnonymity.SuppressBelowMin5(count).Suppressed;

    // ratesAsOf across two sums = the earliest present date (yyyy-MM-dd strings sort chronologically) — the TS
    // `[base.ratesAsOf, variable.ratesAsOf].filter(Boolean).sort()[0] ?? null`.
    private static string? EarliestRatesAsOf(string? a, string? b)
    {
        if (a is null)
        {
            return b;
        }

        if (b is null)
        {
            return a;
        }

        return string.CompareOrdinal(a, b) <= 0 ? a : b;
    }
}
