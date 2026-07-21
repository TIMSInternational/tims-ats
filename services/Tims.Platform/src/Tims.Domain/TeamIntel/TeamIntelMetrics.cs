using Tims.Domain.Reporting;

namespace Tims.Domain.TeamIntel;

/// <summary>
/// The two team-intel org-rollup metric kernels — faithful ports of the <c>@tims/shared</c>
/// <c>computeAvgTenureYears</c> / <c>computeRoleDiversity</c> (the SINGLE source the TS
/// <c>teamIntel.getDashboardKpis</c> returns). Golden-fixtured BOTH stacks
/// (contracts/team-intel-fixtures/{avg-tenure-years,role-diversity}.json).
///
/// PARITY PINS: <see cref="ComputeAvgTenureYears"/> divides by 365-DAY years (≠ the 30-DAY months in
/// <see cref="BalanceScoreBuilder"/>/<see cref="TeamComparisonBuilder"/>); <see cref="ComputeRoleDiversity"/>
/// returns a 2-DECIMAL ratio (≠ the integer percent in balance). Both use JS half-up rounding
/// (<see cref="ReportingMath.JsRound"/> = <c>Floor(x + 0.5)</c>), never banker's. Diversity counts DISTINCT
/// NON-EMPTY job titles (null/empty dropped). Empty input → 0. Timestamps arrive as epoch-milliseconds.
/// </summary>
public static class TeamIntelMetrics
{
    private const double YearMs = 1000d * 60 * 60 * 24 * 365;

    /// <summary>Mean tenure in 365-day years, rounded to one decimal (JS half-up). Empty → 0.</summary>
    public static double ComputeAvgTenureYears(IReadOnlyList<long> createdAtMs, long nowMs)
    {
        if (createdAtMs.Count == 0)
        {
            return 0;
        }

        var sum = 0d;
        foreach (var created in createdAtMs)
        {
            sum += (nowMs - created) / YearMs;
        }

        var years = sum / createdAtMs.Count;
        return ReportingMath.JsRound(years * 10) / 10d;
    }

    /// <summary>Role diversity as a 2-decimal ratio: <c>round((distinctNonEmpty / count) * 100) / 100</c>. Empty → 0.</summary>
    public static double ComputeRoleDiversity(IReadOnlyList<string?> jobTitles)
    {
        if (jobTitles.Count == 0)
        {
            return 0;
        }

        var unique = jobTitles.Where(j => !string.IsNullOrEmpty(j)).Distinct(StringComparer.Ordinal).Count();
        return ReportingMath.JsRound((double)unique / jobTitles.Count * 100) / 100d;
    }
}
