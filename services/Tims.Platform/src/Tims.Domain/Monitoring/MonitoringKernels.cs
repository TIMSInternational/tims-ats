using Tims.Domain.Access;

namespace Tims.Domain.Monitoring;

/// <summary>One module's active-alert health band (<c>getModuleHealth</c>).</summary>
public sealed record ModuleHealthPoint(string Module, int ActiveAlerts, string Status);

/// <summary>
/// One month of the rolling <c>getCrossModuleTrend</c> window: the <c>YYYY-MM</c> label and the
/// INCLUSIVE <c>[Start, End]</c> bounds, both as Unspecified-kind wall-clock values so they can be
/// compared directly against the Prisma <c>timestamp(3) without time zone</c> columns.
/// </summary>
public sealed record TrendMonth(string Label, DateTime Start, DateTime End);

/// <summary>One point of a trend series. <c>Value</c> is null exactly when <c>Suppressed</c> is true.</summary>
public sealed record TrendPoint(string Month, int? Value, bool Suppressed);

/// <summary>
/// The pure monitoring kernels — the C# port of <c>packages/api/src/services/monitoring.service.ts</c>
/// (Phase-5 Q0b slice 1, issue #100). Infra-free, deterministic, and golden-fixtured against the SAME
/// literals as the TS side (<c>tests/monitoring/monitoring-kernels.test.ts</c> ↔
/// <c>tests/Tims.UnitTests/Monitoring/MonitoringKernelsTests.cs</c>).
///
/// Two quirks of the live TS reader are reproduced deliberately rather than "fixed": the month upper
/// bound is MIDNIGHT on the final day of the month (not end-of-day), and the month shift keeps the
/// anchor's day-of-month so short months overflow forward (31 March − 1 month → 3 March). Changing
/// either would move production dashboard numbers, so both are pinned on both stacks.
///
/// TIMEZONE: the TS kernel builds LOCAL-time dates. This port builds UTC. They agree exactly when the
/// Node host runs UTC, which is the production configuration (Vercel) — an explicit parity
/// PRECONDITION, not a measurement. A non-UTC Node host would shift every bucket boundary by its
/// offset; that risk is identical to the one the live TS reader already carries.
/// </summary>
public static class MonitoringKernels
{
    /// <summary>The 8 modules <c>getModuleHealth</c> reports on, in output order.</summary>
    public static readonly IReadOnlyList<string> Modules =
    [
        "recruitment",
        "onboarding",
        "people",
        "engagement",
        "compensation",
        "dei",
        "time",
        "performance",
    ];

    public const string Healthy = "healthy";
    public const string Warning = "warning";
    public const string Critical = "critical";

    /// <summary>Months per <c>getCrossModuleTrend</c> period. Unknown period ⇒ caller-side 400.</summary>
    public static int? TrendMonths(string period) => period switch
    {
        "6m" => 6,
        "12m" => 12,
        "24m" => 24,
        _ => null,
    };

    /// <summary>0 → healthy · 1..2 → warning · 3+ → critical (TS: <c>!n ? healthy : n &lt;= 2 ? warning : critical</c>).</summary>
    public static string ModuleHealthStatus(int activeAlerts)
    {
        if (activeAlerts == 0)
        {
            return Healthy;
        }

        return activeAlerts <= 2 ? Warning : Critical;
    }

    /// <summary>
    /// Project a sparse <c>module → active alert count</c> map onto the fixed 8-module list. A module
    /// absent from the map reports 0/healthy, so an EMPTY database yields eight honest zero rows —
    /// never an empty array, never a tick that hides "no data".
    /// </summary>
    public static IReadOnlyList<ModuleHealthPoint> BuildModuleHealth(IReadOnlyDictionary<string, int> alertCountsByModule)
    {
        var points = new List<ModuleHealthPoint>(Modules.Count);
        foreach (var module in Modules)
        {
            var count = alertCountsByModule.TryGetValue(module, out var c) ? c : 0;
            points.Add(new ModuleHealthPoint(module, count, ModuleHealthStatus(count)));
        }

        return points;
    }

    /// <summary>
    /// The rolling month window, oldest → newest, from an injected <paramref name="nowUtc"/>.
    ///
    /// Reproduces JS <c>date.setMonth(date.getMonth() - i)</c> exactly: the anchor's day-of-month is
    /// preserved and, when the target month is too short, rolls forward into the next month (the roll
    /// is at most 3 days, so it never crosses two months). The resulting <c>YYYY-MM</c> label is taken
    /// from the ROLLED date, which is why a window anchored on 31 March can label two points 2026-03.
    /// </summary>
    public static IReadOnlyList<TrendMonth> BuildMonthWindow(DateTime nowUtc, int months)
    {
        var window = new List<TrendMonth>(Math.Max(months, 0));
        for (var i = months - 1; i >= 0; i--)
        {
            var (year, month) = ShiftMonthsBackJsStyle(nowUtc, i);
            var start = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Unspecified);

            // JS `new Date(y, m + 1, 0)` = day 0 of the FOLLOWING month = the last day of THIS month,
            // at 00:00:00.000 — deliberately NOT end-of-day (see the class remarks).
            var end = new DateTime(year, month, DateTime.DaysInMonth(year, month), 0, 0, 0, DateTimeKind.Unspecified);

            window.Add(new TrendMonth($"{year:D4}-{month:D2}", start, end));
        }

        return window;
    }

    /// <summary>
    /// All-or-nothing k-anonymity floor for the <c>engagement</c> trend (a raw COUNT over the
    /// §21-restricted <c>survey_responses</c> population).
    ///
    /// If ANY month is sub-floor (1..4) EVERY month is nulled and flagged suppressed. Per-point
    /// suppression is insufficient: a caller who knows the window total can subtract the visible
    /// months to recover the hidden one (the monthly-differencing oracle). A 0 passes through — an
    /// empty bucket identifies nobody, so an EMPTY database returns honest zeroes, not a privacy tick.
    /// </summary>
    public static IReadOnlyList<TrendPoint> ApplyEngagementTrendFloor(
        IReadOnlyList<string> labels, IReadOnlyList<int> rawCounts)
    {
        var anyMonthSubFloor = rawCounts.Any(c => KAnonymity.SuppressBelowMin5(c).Suppressed);

        var points = new List<TrendPoint>(labels.Count);
        for (var i = 0; i < labels.Count; i++)
        {
            int? value = anyMonthSubFloor ? null : i < rawCounts.Count ? rawCounts[i] : null;
            points.Add(new TrendPoint(labels[i], value, anyMonthSubFloor));
        }

        return points;
    }

    // JS Date.prototype.setMonth semantics: target = month0 - back; the year borrows by floor-division,
    // then a day-of-month past the end of the target month rolls FORWARD into the following month.
    private static (int Year, int Month) ShiftMonthsBackJsStyle(DateTime anchor, int back)
    {
        var target = anchor.Month - 1 - back;              // 0-based, may be negative
        var year = anchor.Year + (int)Math.Floor(target / 12d);
        var month0 = ((target % 12) + 12) % 12;            // 0..11
        var month = month0 + 1;

        var daysInTarget = DateTime.DaysInMonth(year, month);
        if (anchor.Day <= daysInTarget)
        {
            return (year, month);
        }

        // Overflow: JS rolls the excess days into the next month (max excess is 3, so one step).
        if (month == 12)
        {
            return (year + 1, 1);
        }

        return (year, month + 1);
    }
}
