using Tims.Domain.Reporting;

namespace Tims.Domain.TeamIntel;

/// <summary>One balance-score input member: its (nullable) job title + createdAt as epoch-ms.</summary>
public sealed record BalanceScoreMember(string? JobTitle, long CreatedAtMs);

/// <summary>
/// The <c>teamIntel.getBalanceScore</c> body — a faithful port of the <c>@tims/shared</c>
/// <c>buildBalanceScore</c> (the router wraps this with the <c>teamId</c>). INTERNAL staff read = raw kernel
/// shape, NO <c>schemaVersion</c>. Golden-fixtured BOTH stacks (contracts/team-intel-fixtures/balance-score.json).
/// </summary>
public sealed record BalanceScoreView(
    int MemberCount,
    int UniqueRoles,
    int RoleDiversity,
    double AvgTenureMonths,
    int SizeScore,
    int BalanceScore);

/// <summary>
/// Pure builder for <see cref="BalanceScoreView"/>. Tenure uses 30-DAY months (≠ the 365-day years in
/// <see cref="TeamIntelMetrics.ComputeAvgTenureYears"/>); <c>roleDiversity</c> is an INTEGER percent
/// <c>round((uniqueRoles / count) * 100)</c> (≠ the 2-decimal ratio in
/// <see cref="TeamIntelMetrics.ComputeRoleDiversity"/> — both preserved verbatim, do NOT unify); <c>sizeScore</c>
/// is 100 for a 3..10-member team else <c>max(0, 100 - abs(count - 7) * 10)</c>; <c>balanceScore</c> =
/// <c>round((sizeScore + roleDiversity) / 2)</c>. All rounds are JS half-up (<see cref="ReportingMath.JsRound"/>).
/// </summary>
public static class BalanceScoreBuilder
{
    private const double MonthMs = 1000d * 60 * 60 * 24 * 30;

    public static BalanceScoreView Build(IReadOnlyList<BalanceScoreMember> members, long nowMs)
    {
        var memberCount = members.Count;

        var avgTenure = 0d;
        if (memberCount > 0)
        {
            var sum = 0d;
            foreach (var m in members)
            {
                sum += (nowMs - m.CreatedAtMs) / MonthMs;
            }

            avgTenure = sum / memberCount;
        }

        var uniqueRoles = members
            .Select(m => m.JobTitle)
            .Where(j => !string.IsNullOrEmpty(j))
            .Distinct(StringComparer.Ordinal)
            .Count();

        var roleDiversity = memberCount > 0
            ? (int)ReportingMath.JsRound((double)uniqueRoles / memberCount * 100)
            : 0;

        var sizeScore = memberCount is >= 3 and <= 10
            ? 100
            : Math.Max(0, 100 - (Math.Abs(memberCount - 7) * 10));

        var balanceScore = (int)ReportingMath.JsRound((sizeScore + roleDiversity) / 2d);

        return new BalanceScoreView(
            memberCount,
            uniqueRoles,
            roleDiversity,
            ReportingMath.JsRound(avgTenure * 10) / 10d,
            sizeScore,
            balanceScore);
    }
}
