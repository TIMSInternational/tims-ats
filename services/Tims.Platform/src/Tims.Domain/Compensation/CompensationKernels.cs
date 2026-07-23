using Tims.Domain.Access;
using Tims.Domain.Reporting;

namespace Tims.Domain.Compensation;

// Pure compensation shaping kernels — a faithful port of the FX-free aggregate kernels in @tims/shared
// `compensation.ts` (Phase-5 compensation strangler, Slice 9). No DB, no I/O, no clock. Each is
// golden-fixtured against the SAME contracts/compensation-fixtures/*.json the TS export asserts
// (Tims.UnitTests). All rounding uses JS half-UP via ReportingMath.JsRound (Math.Floor(x + 0.5)), NOT
// .NET banker's rounding. min-5 k-anonymity reuses the ALREADY-ported Tims.Domain.Access.KAnonymity
// (byte-identical to the TS suppressBelowMin5) — no re-port.
//
// INTERNAL reads = raw kernel shape, NO schemaVersion. Records serialize camelCase to match the tRPC wire.

// ── Read 4: getCompaRatioDistribution ─────────────────────────────────────────

/// <summary>One compensation row for the compa-ratio distribution (currentSalary + nullable compaRatio).</summary>
public sealed record CompaRatioRow(double CurrentSalary, double? CompaRatio);

/// <summary>One bucket's suppressed count (count null when suppressed).</summary>
public sealed record CompaRatioBucketCount(bool Suppressed, int? Count);

/// <summary>The compa-ratio distribution view (raw kernel shape, no schemaVersion). <see cref="Distribution"/>
/// is EMPTY (no keys) whenever <see cref="Suppressed"/> is true (all-or-nothing).</summary>
public sealed record CompaRatioDistribution(
    IReadOnlyDictionary<string, CompaRatioBucketCount> Distribution,
    double? AvgCompaRatio,
    int? TotalEmployees,
    bool Suppressed);

// ── Read 3: getBenefitsUtilization ─────────────────────────────────────────────

/// <summary>One benefit plan's enrollment input for the utilization rollup.</summary>
public sealed record BenefitPlanInput(string Id, string Name, string Category, int Enrolled);

/// <summary>One benefit-utilization output row (raw kernel shape).</summary>
public sealed record BenefitUtilizationItem(
    string Id,
    string Name,
    string Category,
    int Enrolled,
    double Utilization);

// ── Slice 11c: FX-derived money kernels (PURE given a rate) ─────────────────────

/// <summary>One converted-money view (raw kernel shape). Serializes camelCase to match the tRPC wire.</summary>
public sealed record ConvertedMoney(
    double OriginalAmount,
    string OriginalCurrency,
    double Amount,
    string Currency,
    double Rate);

/// <summary>One input row for <see cref="CompensationKernels.SumMoney"/> — an amount in its source currency
/// plus the ALREADY-RESOLVED FX rate to the display currency (identity = 1).</summary>
public sealed record MoneyRow(double Amount, string From, double Rate);

/// <summary>The total of a <see cref="CompensationKernels.SumMoney"/> fold.</summary>
public sealed record MoneySum(double Amount, bool Converted);

/// <summary>The pure compensation kernels (faithful ports of @tims/shared/compensation.ts, FX-free subset +
/// the Slice-11c FX-derived money kernels).</summary>
public static class CompensationKernels
{
    // The JS Number.EPSILON (2^-52) — NOT .NET double.Epsilon (the smallest denormal). roundMoney adds this
    // bias so an exact half-cent boundary (e.g. 1.005, which is a hair BELOW 1.005 in binary float) is lifted
    // just above the boundary and rounds UP, matching JS Math.round's half-up-toward-+Infinity.
    private const double JsNumberEpsilon = 2.220446049250313e-16;

    /// <summary>roundMoney — JS half-up to 2 decimals with the Number.EPSILON bias, byte-identical to
    /// @tims/shared roundMoney (Math.round((x + Number.EPSILON) * 100) / 100). JS Math.round is
    /// Floor(x + 0.5) toward +Infinity; money amounts are non-negative so this coincides with away-from-zero.</summary>
    public static double RoundMoney(double amount) =>
        Math.Floor((amount + JsNumberEpsilon) * 100 + 0.5) / 100d;

    /// <summary>The PURE convert kernel (convertMoneyWithRate): shape one converted amount given an
    /// already-resolved FX <paramref name="rate"/> (identity = 1). <paramref name="from"/>/<paramref name="to"/>
    /// pass through verbatim — the CALLER normalizes them (like the live convertMoney). originalAmount uses the
    /// JS <c>Number(amount) || 0</c> coercion (a non-finite double → 0).</summary>
    public static ConvertedMoney ConvertMoney(double amount, string from, string to, double rate)
    {
        var originalAmount = double.IsFinite(amount) ? amount : 0d;
        return new ConvertedMoney(originalAmount, from, RoundMoney(originalAmount * rate), to, rate);
    }

    /// <summary>The PURE sum kernel (sumMoneyWithRates): fold {amount, from, rate} rows into one display-currency
    /// total. Mirrors the live sumMoney EXACTLY — each row is roundMoney(amount*rate), summed, then the total is
    /// roundMoney'd once more (round-then-sum-then-round). <see cref="MoneySum.Converted"/> is true iff ANY row's
    /// source currency differs from <paramref name="to"/> (an identity row never flips it).</summary>
    public static MoneySum SumMoney(IReadOnlyList<MoneyRow> rows, string to)
    {
        var total = 0d;
        var converted = false;
        foreach (var row in rows)
        {
            total += ConvertMoney(row.Amount, row.From, to, row.Rate).Amount;
            converted |= !string.Equals(row.From, to, StringComparison.Ordinal);
        }

        return new MoneySum(RoundMoney(total), converted);
    }

    // The six fixed compa-ratio buckets, in wire order (Σ buckets = the positive-salary population).
    private const string BucketLt80 = "<0.80";
    private const string Bucket80To90 = "0.80-0.90";
    private const string Bucket90To100 = "0.90-1.00";
    private const string Bucket100To110 = "1.00-1.10";
    private const string Bucket110To120 = "1.10-1.20";
    private const string BucketGt120 = ">1.20";

    /// <summary>The read-#4 kernel (buildCompaRatioDistribution). Buckets ONLY positive-salary rows into the
    /// six fixed bands; avgCompaRatio is the mean of the non-null/non-zero ratios floored on the CONTRIBUTOR
    /// count (JS half-up 2-dec, null when 1..4 contributed or 0). All-or-nothing: any sub-floor bucket OR
    /// sub-floor positive/non-positive population collapses to an EMPTY distribution + null total + suppressed;
    /// 0 population → non-suppressed empty distribution; totalEmployees == positiveCount (NOT rows.Count).</summary>
    public static CompaRatioDistribution BuildCompaRatioDistribution(IReadOnlyList<CompaRatioRow> rows)
    {
        // Ordered bucket accumulators (wire order preserved for readability; equality is order-insensitive).
        var order = new[] { BucketLt80, Bucket80To90, Bucket90To100, Bucket100To110, Bucket110To120, BucketGt120 };
        var buckets = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var key in order)
        {
            buckets[key] = 0;
        }

        var positiveCount = 0;
        foreach (var emp in rows)
        {
            var salary = emp.CurrentSalary;
            if (!(salary > 0))
            {
                continue;
            }

            positiveCount += 1;
            var cr = emp.CompaRatio ?? 0; // Number(compaRatio) || 0 — null/0 → 0
            if (cr < 0.8)
            {
                buckets[BucketLt80]++;
            }
            else if (cr < 0.9)
            {
                buckets[Bucket80To90]++;
            }
            else if (cr < 1.0)
            {
                buckets[Bucket90To100]++;
            }
            else if (cr < 1.1)
            {
                buckets[Bucket100To110]++;
            }
            else if (cr < 1.2)
            {
                buckets[Bucket110To120]++;
            }
            else
            {
                buckets[BucketGt120]++;
            }
        }

        var nonPositiveCount = rows.Count - positiveCount;

        // avgCompaRatio: mean of the NON-null/NON-zero ratios (`|| 0` then filter truthy), floored on the
        // CONTRIBUTOR count (ratios.Count), JS half-up 2-dec. null when 1..4 contributed OR 0.
        var ratios = rows.Select(e => e.CompaRatio ?? 0).Where(v => v != 0).ToList();
        double? avgCompaRatio =
            ratios.Count > 0 && !KAnonymity.SuppressBelowMin5(ratios.Count).Suppressed
                ? ReportingMath.JsRound(ratios.Sum() / ratios.Count * 100) / 100d
                : null;

        var anyBucketSuppressed = order.Any(key => KAnonymity.SuppressBelowMin5(buckets[key]).Suppressed);
        if (KAnonymity.SuppressBelowMin5(positiveCount).Suppressed
            || KAnonymity.SuppressBelowMin5(nonPositiveCount).Suppressed
            || anyBucketSuppressed)
        {
            // All-or-nothing: no keys survive (present-key cardinality + N−Σ oracle), null total, suppressed.
            return new CompaRatioDistribution(
                new Dictionary<string, CompaRatioBucketCount>(StringComparer.Ordinal),
                avgCompaRatio,
                null,
                true);
        }

        var distribution = new Dictionary<string, CompaRatioBucketCount>(StringComparer.Ordinal);
        foreach (var key in order)
        {
            distribution[key] = new CompaRatioBucketCount(false, buckets[key]);
        }

        // totalEmployees = positiveCount (NOT rows.Count) so cross-endpoint subtraction collapses.
        return new CompaRatioDistribution(distribution, avgCompaRatio, positiveCount, false);
    }

    /// <summary>The read-#3 kernel (buildBenefitsUtilization). utilization = round((enrolled/totalUsers)*10000)
    /// /100 JS half-up, 0 when no users. Deliberately NO min-5 (benefits enrollment is not in the §21 matrix).
    /// Input order preserved.</summary>
    public static IReadOnlyList<BenefitUtilizationItem> BuildBenefitsUtilization(
        IReadOnlyList<BenefitPlanInput> plans,
        int totalUsers)
    {
        var items = new List<BenefitUtilizationItem>(plans.Count);
        foreach (var b in plans)
        {
            var utilization = totalUsers != 0
                ? ReportingMath.JsRound((double)b.Enrolled / totalUsers * 10000) / 100d
                : 0d;
            items.Add(new BenefitUtilizationItem(b.Id, b.Name, b.Category, b.Enrolled, utilization));
        }

        return items;
    }

    // ── Slice 11c: the five FX-derived READ shaping kernels (PURE given already-converted amounts + counts) ──
    // Faithful ports of the @tims/shared buildBandDistribution / buildCompPayEquity / buildTotalCompBreakdown /
    // buildCompDashboardKpis / buildSimulateAdjustment kernels, golden-fixtured BOTH stacks against
    // contracts/compensation-fixtures/*.json. The use case does the impure FX conversion (FxMoneyConverter) and
    // hands these ALREADY-CONVERTED amounts + counts + provenance. min-5 reuses the ported KAnonymity floor.

    private static bool Suppress(int count) => KAnonymity.SuppressBelowMin5(count).Suppressed;

    /// <summary>The band-distribution shaper (buildBandDistribution): group positive-salary banded rows (already
    /// converted into their band currency), plot each as a clamped dot, sort bands by mid DESC, and apply the
    /// all-or-nothing min-5 trigger — any sub-floor band / unbanded bucket / non-positive-banded complement /
    /// (FIX 1) positive-unbanded sub-bucket ⇒ EMPTY bands. 0 population ⇒ [].</summary>
    public static IReadOnlyList<BandDistributionBand> BuildBandDistribution(
        IReadOnlyList<BandDistributionKernelRow> rows,
        int unassignedCount,
        int nonPositiveBanded,
        int positiveUnbanded)
    {
        var order = new List<string>();
        var byBand = new Dictionary<string, BandAccumulator>(StringComparer.Ordinal);
        foreach (var r in rows)
        {
            if (!byBand.TryGetValue(r.BandId, out var acc))
            {
                acc = new BandAccumulator(r.Level, r.Title, r.Min, r.Mid, r.Max, r.Currency);
                byBand[r.BandId] = acc;
                order.Add(r.BandId);
            }

            var span = r.Max - r.Min;
            var rawPos = span > 0 ? (r.SalaryInBandCurrency - r.Min) / span * 100 : 50;
            acc.Dots.Add(new BandDot(Math.Min(100, Math.Max(0, rawPos)), rawPos < 0 || rawPos > 100));
        }

        var allBands = order.Select(id => byBand[id]).OrderByDescending(b => b.Mid).ToList();
        var bandedPopulation = allBands.Sum(b => b.Dots.Count) + unassignedCount;
        var anyBandSuppressed = allBands.Any(b => Suppress(b.Dots.Count))
            || Suppress(unassignedCount)
            || Suppress(nonPositiveBanded)
            // FIX 1: the positive-unbanded sub-bucket closes the compensatedEmployees − Σdots oracle.
            || Suppress(positiveUnbanded);
        if (Suppress(bandedPopulation) || anyBandSuppressed)
        {
            return Array.Empty<BandDistributionBand>();
        }

        return allBands
            .Select(b => new BandDistributionBand(b.Level, b.Title, b.Min, b.Mid, b.Max, b.Currency, b.Dots, false))
            .ToList();
    }

    /// <summary>The compensation pay-equity shaper (buildCompPayEquity): single org-wide 'all' group over the
    /// already-converted positive salaries. avg = mean (JS round), median = sorted[floor(n/2)]; count/avg/median
    /// nulled when the group is 1..4.</summary>
    public static CompPayEquityView BuildCompPayEquity(IReadOnlyList<double> convertedSalaries, string displayCurrency)
    {
        var avg = convertedSalaries.Count > 0 ? convertedSalaries.Sum() / convertedSalaries.Count : 0d;
        var sorted = convertedSalaries.OrderBy(v => v).ToList();
        var median = sorted.Count > 0 ? sorted[sorted.Count / 2] : 0d;
        var s = KAnonymity.SuppressBelowMin5(convertedSalaries.Count);
        var group = s.Suppressed
            ? new CompPayEquityGroup("all", null, true, null, null)
            : new CompPayEquityGroup("all", convertedSalaries.Count, false, (int)ReportingMath.JsRound(avg), median);
        return new CompPayEquityView("all", new[] { group }, displayCurrency);
    }

    /// <summary>The total-comp-breakdown shaper (buildTotalCompBreakdown): base/variable split from the two summed
    /// totals. All-or-nothing min-5 over {rowCount, baseContributors, variableContributors, non-positive
    /// complement}; absent totals (null — suppressed cohort OR FX-unavailable fail-soft) also suppress.
    /// employeeCount = baseContributors; percentages round2, 0 when the total is 0.</summary>
    public static TotalCompBreakdownView BuildTotalCompBreakdown(
        int rowCount,
        int baseContributors,
        int variableContributors,
        TotalCompTotals? totals,
        string displayCurrency)
    {
        var nonPositive = rowCount - baseContributors;
        var suppressed = Suppress(rowCount) || Suppress(baseContributors)
            || Suppress(variableContributors) || Suppress(nonPositive);
        if (suppressed || totals is null)
        {
            return new TotalCompBreakdownView(
                null, displayCurrency, false, null,
                new CompBreakdownBreakdown(new CompBreakdownLine(null, null), new CompBreakdownLine(null, null)),
                null, true);
        }

        var normalizedTotalComp = RoundMoney(totals.BaseAmount + totals.VariableAmount);
        double? basePct = normalizedTotalComp != 0 ? ReportingMath.JsRound(totals.BaseAmount / normalizedTotalComp * 10000) / 100d : 0;
        double? varPct = normalizedTotalComp != 0 ? ReportingMath.JsRound(totals.VariableAmount / normalizedTotalComp * 10000) / 100d : 0;
        return new TotalCompBreakdownView(
            normalizedTotalComp,
            displayCurrency,
            totals.Converted,
            totals.RatesAsOf,
            new CompBreakdownBreakdown(
                new CompBreakdownLine(totals.BaseAmount, basePct),
                new CompBreakdownLine(totals.VariableAmount, varPct)),
            baseContributors,
            false);
    }

    /// <summary>The dashboard-KPIs shaper (buildCompDashboardKpis): compensated aggregates suppressed when the
    /// compensated population is 1..4 OR (fail-soft) payroll is null; avgCompaRatio suppressed when &lt;5 compaRatio
    /// rows contributed OR — FIX 7 — the mean is exactly 0; pendingAdjustments min-5 floored;
    /// benefitsUtilizationPct = mean over plans of enrolled/activeEmployees.</summary>
    public static CompDashboardKpisView BuildCompDashboardKpis(
        int compensatedCount,
        int compaRatioCount,
        int pendingAdjustments,
        int activeEmployees,
        IReadOnlyList<int> benefitEnrollmentCounts,
        double? compaRatioAvg,
        DashboardPayroll? payroll,
        string displayCurrency)
    {
        var benefitsUtilizationPct = benefitEnrollmentCounts.Count > 0 && activeEmployees > 0
            ? ReportingMath.JsRound(
                benefitEnrollmentCounts.Sum(c => (double)c / activeEmployees) / benefitEnrollmentCounts.Count * 1000) / 10d
            : 0d;

        var compensatedSuppressed = Suppress(compensatedCount);
        var compaRatioSuppressed = Suppress(compaRatioCount);
        var pendingFloor = KAnonymity.SuppressBelowMin5(pendingAdjustments);
        var fxUnavailable = !compensatedSuppressed && payroll is null;
        var effectiveCompensatedSuppressed = compensatedSuppressed || fxUnavailable;

        double? totalPayroll = effectiveCompensatedSuppressed ? null : payroll!.Amount;
        int? avgSalary = effectiveCompensatedSuppressed
            ? null
            : (int)ReportingMath.JsRound(payroll!.Amount / compensatedCount);
        // FIX 7: null when the mean is exactly 0 too (the TS `!avgCompaRatio` Float-falsy check).
        double? avgCompaRatio = compaRatioSuppressed || compaRatioAvg is not { } cr || cr == 0
            ? null
            : ReportingMath.JsRound(cr * 100) / 100d;

        return new CompDashboardKpisView(
            totalPayroll,
            avgSalary,
            displayCurrency,
            !effectiveCompensatedSuppressed && payroll is { Converted: true },
            effectiveCompensatedSuppressed ? null : payroll!.RatesAsOf,
            effectiveCompensatedSuppressed ? null : compensatedCount,
            effectiveCompensatedSuppressed,
            activeEmployees,
            pendingFloor.Count,
            pendingFloor.Suppressed,
            benefitsUtilizationPct,
            avgCompaRatio);
    }

    /// <summary>The simulate-adjustment shaper (buildSimulateAdjustment): the seven always-present projection
    /// fields; the six compa/band fields are added ONLY when the caller is entitled (<paramref name="compa"/> not
    /// null) — returned as the derived <see cref="SimulateAdjustmentWithCompaView"/> (all six present, incl.
    /// nulls). When entitled but band-less, bandCurrency falls back to the CURRENT currency (never null — FIX 3).
    /// currentCompaRatio is <c>cr != 0 ? cr : null</c>; percentageChange round2 (0 when no salary). The endpoint
    /// boxes the result to <c>object</c> so STJ serializes the runtime type (base vs derived shape).</summary>
    public static SimulateAdjustmentView BuildSimulateAdjustment(
        double currentSalary,
        string currentCurrency,
        double proposedSalary,
        string proposedCurrency,
        double proposedSalaryForComparison,
        SimulateCompaInput? compa)
    {
        var percentageChange = currentSalary != 0
            ? ReportingMath.JsRound((proposedSalaryForComparison - currentSalary) / currentSalary * 10000) / 100d
            : 0d;
        if (compa is null)
        {
            return new SimulateAdjustmentView(
                currentSalary, currentCurrency, proposedSalary, proposedCurrency,
                proposedSalaryForComparison, currentCurrency, percentageChange);
        }

        var band = compa.Band;
        var midpoint = band?.Mid ?? 0;
        return new SimulateAdjustmentWithCompaView(
            currentSalary, currentCurrency, proposedSalary, proposedCurrency,
            proposedSalaryForComparison, currentCurrency, percentageChange,
            compa.CurrentCompaRatio != 0 ? compa.CurrentCompaRatio : null,
            midpoint != 0 ? ReportingMath.JsRound(compa.ProposedSalaryForBand / midpoint * 100) / 100d : null,
            band?.Min,
            band?.Max,
            band is not null ? band.BandCurrency : currentCurrency,
            band is not null ? compa.ProposedSalaryForBand >= band.Min && compa.ProposedSalaryForBand <= band.Max : null);
    }

    private sealed record BandAccumulator(
        string Level, string Title, double Min, double Mid, double Max, string Currency)
    {
        public List<BandDot> Dots { get; } = new();
    }
}
