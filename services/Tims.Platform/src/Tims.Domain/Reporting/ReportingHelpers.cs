using System.Collections.Generic;
using System.Linq;

namespace Tims.Domain.Reporting;

/// <summary>
/// Pure span/day helpers shared by the KPI, lost-by-delay and recruiter-SLA kernels — ports of the
/// TS <c>avgDaysFromSpans</c> / <c>hoursInStage</c> (@tims/shared). Timestamps are epoch-milliseconds.
/// </summary>
public static class ReportingHelpers
{
    /// <summary>One day in milliseconds — the divisor for span→day conversions (matches TS <c>DAY_MS</c>).</summary>
    public const double DayMs = 24d * 60 * 60 * 1000;

    /// <summary>Mean of the given millisecond spans converted to whole days (JS half-up round), or
    /// <c>null</c> when there are no spans.</summary>
    public static int? AvgDaysFromSpans(IReadOnlyList<long> spansMs)
    {
        if (spansMs.Count == 0) return null;
        var avg = spansMs.Sum() / (double)spansMs.Count;
        return (int)ReportingMath.JsRound(avg / DayMs);
    }

    /// <summary>Hours an application has sat in its current stage: entered = the latest stage movement
    /// if any, else <paramref name="appliedAtMs"/>.</summary>
    public static double HoursInStage(long appliedAtMs, long? lastMovedAtMs, long untilMs)
    {
        var enteredMs = lastMovedAtMs ?? appliedAtMs;
        return (untilMs - enteredMs) / (1000d * 60 * 60);
    }
}
