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

/// <summary>The pure compensation kernels (faithful ports of @tims/shared/compensation.ts, FX-free subset).</summary>
public static class CompensationKernels
{
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
}
