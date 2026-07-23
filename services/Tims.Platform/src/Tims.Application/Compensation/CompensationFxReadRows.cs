namespace Tims.Application.Compensation;

// Repository DTOs for the FIVE FX-derived compensation reads (Phase-5 Slice 11c). Kept infra-free (Application).
// The FX conversion happens in the use case (FxMoneyConverter); these carry the raw amounts + currencies.

/// <summary>One comp row's amount + currency (pay-equity / total-comp / dashboard aggregates).</summary>
public sealed record CompAmountRow(double CurrentSalary, double? VariablePay, string? Currency);

/// <summary>getPayEquity (comp, single 'all' group) + getTotalCompBreakdown / getDashboardKpis input: the comp
/// rows + the org display currency (companies.currency, earliest).</summary>
public sealed record CompAggregateData(IReadOnlyList<CompAmountRow> Rows, string? DisplayCurrency);

/// <summary>getDashboardKpis input bundle (the extra scalars beyond the compensated rows).</summary>
public sealed record CompDashboardData(
    IReadOnlyList<CompAmountRow> CompensatedRows,
    int CompensatedCount,
    int PendingAdjustments,
    double? CompaRatioAvg,
    int CompaRatioCount,
    int ActiveEmployees,
    IReadOnlyList<int> BenefitEnrollmentCounts,
    string? DisplayCurrency);

/// <summary>One banded comp row for getBandDistribution: the employee salary/currency + its band bounds.</summary>
public sealed record BandDistributionRow(
    double CurrentSalary,
    string? Currency,
    Guid BandId,
    string? BandLevel,
    string? BandTitle,
    double BandMin,
    double BandMid,
    double BandMax,
    string? BandCurrency);

/// <summary>getBandDistribution input: the banded rows (bandId not null) + the unbanded (bandId null) count +
/// the POSITIVE-salary unbanded sub-bucket count (FIX 1 — the missing operand in the k-anon differencing trigger:
/// <c>dashboard.compensatedEmployees − Σdots = positiveUnbanded</c>).</summary>
public sealed record BandDistributionData(
    IReadOnlyList<BandDistributionRow> Rows, int UnassignedCount, int PositiveUnbandedCount);

/// <summary>simulateAdjustment field-authed comp row (only the columns selectFor entitles). Nulls mean the
/// column was NOT selected (not entitled) — the endpoint/use case treats absent like the TS dynamic select.</summary>
public sealed record SimulateCompRow(
    string RecordId,
    double? CurrentSalary,
    string? Currency,
    double? CompaRatio,
    Guid? BandId,
    bool CanSeeCompaRatio);

/// <summary>simulateAdjustment band bounds (only loaded when the caller is entitled to compaRatio + has a band).</summary>
public sealed record SimulateBand(double MinSalary, double MidSalary, double MaxSalary, string? Currency);

/// <summary>The outcome of <see cref="CompensationFxReadUseCase.SimulateAdjustmentAsync"/> (FIX 2): the endpoint
/// maps <see cref="SimulateAdjustmentResultKind.NotFound"/> → 404, <see cref="SimulateAdjustmentResultKind.FxUnavailable"/>
/// → 503 <c>{ error: "fx_unavailable" }</c> (a REQUIRED cross-rate pin is missing — NEVER a best-effort wrong
/// %change), and <see cref="SimulateAdjustmentResultKind.Ok"/> → audit + 200 with the (base or derived) view.</summary>
public enum SimulateAdjustmentResultKind
{
    NotFound,
    FxUnavailable,
    Ok,
}

/// <summary>The discriminated result carried out of the simulate use case. <c>View</c> is the boxed base/derived
/// simulate view (FIX 3) — only set when <c>Kind == Ok</c>. Stored as <c>object</c> so the endpoint serializes the
/// RUNTIME type (base 7 fields, or derived 13).</summary>
public readonly record struct SimulateAdjustmentResult(
    SimulateAdjustmentResultKind Kind, object? View, string? RecordId);
