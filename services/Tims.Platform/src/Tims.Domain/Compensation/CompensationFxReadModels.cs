namespace Tims.Domain.Compensation;

// Wire shapes for the FIVE FX-derived compensation reads (Phase-5 Slice 11c). INTERNAL reads = raw model shape,
// NO schemaVersion; camelCase to match the tRPC wire. Faithful ports of the TS compensation router returns.

/// <summary>getBandDistribution: one plotted dot (position 0..100, outlier when the raw pos fell outside).</summary>
public sealed record BandDot(double Pos, bool Outlier);

/// <summary>getBandDistribution: one visible band (dots dropped to [] on any sub-floor band — all-or-nothing).</summary>
public sealed record BandDistributionBand(
    string Level, string Title, double Min, double Mid, double Max, string Currency,
    IReadOnlyList<BandDot> Dots, bool Suppressed);

/// <summary>getPayEquity (comp, single 'all' group): count/avg/median null when the group is 1..4.</summary>
public sealed record CompPayEquityGroup(
    string Group, int? Count, bool Suppressed, int? AverageSalary, double? MedianSalary);

public sealed record CompPayEquityView(string GroupBy, IReadOnlyList<CompPayEquityGroup> Results, string Currency);

/// <summary>getTotalCompBreakdown: total comp + base/variable split; totals null + suppressed on any sub-floor
/// contributor population; FX-unavailable (cold start) also suppresses.</summary>
public sealed record CompBreakdownLine(double? Total, double? Percentage);

public sealed record TotalCompBreakdownView(
    double? TotalComp,
    string Currency,
    bool Converted,
    string? RatesAsOf,
    CompBreakdownBreakdown Breakdown,
    int? EmployeeCount,
    bool Suppressed);

public sealed record CompBreakdownBreakdown(CompBreakdownLine BaseSalary, CompBreakdownLine VariablePay);

/// <summary>getDashboardKpis: the compensation dashboard headline KPIs (compensated aggregates min-5 floored).</summary>
public sealed record CompDashboardKpisView(
    double? TotalMonthlyPayroll,
    int? AvgSalary,
    string Currency,
    bool Converted,
    string? RatesAsOf,
    int? CompensatedEmployees,
    bool CompensatedSuppressed,
    int ActiveEmployees,
    int? PendingAdjustments,
    bool PendingAdjustmentsSuppressed,
    double BenefitsUtilizationPct,
    double? AvgCompaRatio);

/// <summary>simulateAdjustment: the SEVEN always-present projection fields (FIX 3 — the base of the DTO
/// inheritance pair). When the caller is NOT entitled to compaRatio this exact base shape is returned (the six
/// compa/band keys ABSENT). When entitled, the derived <see cref="SimulateAdjustmentWithCompaView"/> is returned
/// instead (all six keys PRESENT, incl. nulls — mirroring the TS all-6-or-none spread keyed on canSeeCompaRatio).
/// The endpoint boxes the result to <c>object</c> so STJ serializes the RUNTIME type (base vs derived), never the
/// declared base — a per-field <c>JsonIgnore(WhenWritingNull)</c> could not express all-or-nothing (it would drop
/// legitimately-null keys when band == null while canSee == true, the common case).</summary>
public record SimulateAdjustmentView(
    double CurrentSalary,
    string Currency,
    double ProposedSalary,
    string ProposedCurrency,
    double ProposedSalaryForComparison,
    string ComparisonCurrency,
    double PercentageChange);

/// <summary>simulateAdjustment for an entitled caller (FIX 3): the base seven + the six compa/band fields, ALL
/// serialized (NO JsonIgnore) so they are present-with-null when the subject has no band. bandCurrency is the
/// band's currency, falling back to the CURRENT currency (never null) when band == null.</summary>
public sealed record SimulateAdjustmentWithCompaView(
    double CurrentSalary,
    string Currency,
    double ProposedSalary,
    string ProposedCurrency,
    double ProposedSalaryForComparison,
    string ComparisonCurrency,
    double PercentageChange,
    double? CurrentCompaRatio,
    double? NewCompaRatio,
    double? BandMin,
    double? BandMax,
    string BandCurrency,
    bool? WithinBand)
    : SimulateAdjustmentView(
        CurrentSalary, Currency, ProposedSalary, ProposedCurrency, ProposedSalaryForComparison,
        ComparisonCurrency, PercentageChange);

// ── Slice 11c: the FX-read shaping kernels' INPUT records (already-converted amounts + provenance) ──────────

/// <summary>One positive-salary banded row for <see cref="CompensationKernels.BuildBandDistribution"/>, ALREADY
/// converted into its band currency. <c>Currency</c> is the band's DISPLAY currency (FIX 8).</summary>
public sealed record BandDistributionKernelRow(
    string BandId, string Level, string Title, double Min, double Mid, double Max, string Currency, double SalaryInBandCurrency);

/// <summary>The two already-summed display-currency totals + provenance for
/// <see cref="CompensationKernels.BuildTotalCompBreakdown"/> (from the impure <c>FxMoneyConverter.SumAsync</c>).</summary>
public sealed record TotalCompTotals(double BaseAmount, double VariableAmount, bool Converted, string? RatesAsOf);

/// <summary>The already-summed payroll total + provenance for
/// <see cref="CompensationKernels.BuildCompDashboardKpis"/>.</summary>
public sealed record DashboardPayroll(double Amount, bool Converted, string? RatesAsOf);

/// <summary>A salary band's bounds for <see cref="CompensationKernels.BuildSimulateAdjustment"/>.</summary>
public sealed record SimulateBandInput(double Min, double Mid, double Max, string BandCurrency);

/// <summary>The compaRatio/band block for <see cref="CompensationKernels.BuildSimulateAdjustment"/>, present only
/// when the caller is entitled. <c>ProposedSalaryForBand</c> is already converted into the band currency (or the
/// comparison amount when band-less).</summary>
public sealed record SimulateCompaInput(double CurrentCompaRatio, SimulateBandInput? Band, double ProposedSalaryForBand);
