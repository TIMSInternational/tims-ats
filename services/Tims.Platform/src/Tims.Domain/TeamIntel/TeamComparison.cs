using Tims.Domain.Reporting;

namespace Tims.Domain.TeamIntel;

/// <summary>Passthrough team-leader ref (compareTeams leader select { id, firstName, lastName }).</summary>
public sealed record TeamComparisonLeader(string Id, string FirstName, string LastName);

/// <summary>One comparison member: its (nullable) job title + createdAt as epoch-ms.</summary>
public sealed record TeamComparisonMember(string? JobTitle, long CreatedAtMs);

/// <summary>One team's comparison input (assembled by the repository from the scoped team set).</summary>
public sealed record TeamComparisonInput(
    string Id,
    string Name,
    TeamComparisonLeader? Leader,
    IReadOnlyList<TeamComparisonMember> Members,
    int OpenVacancies,
    int ActiveOkrs);

/// <summary>One comparison output row. INTERNAL staff read = raw kernel shape, NO <c>schemaVersion</c>.</summary>
public sealed record TeamComparisonRow(
    string TeamId,
    string TeamName,
    TeamComparisonLeader? Leader,
    int MemberCount,
    int UniqueRoles,
    double AvgTenureMonths,
    int OpenVacancies,
    int ActiveOkrs);

/// <summary>The <c>teamIntel.compareTeams</c> response: <c>{ teams: [...] }</c>.</summary>
public sealed record TeamComparisonView(IReadOnlyList<TeamComparisonRow> Teams);

/// <summary>
/// Pure builder for <see cref="TeamComparisonView"/> — a faithful port of the <c>@tims/shared</c>
/// <c>buildTeamComparison</c>. Per team: member count, distinct NON-EMPTY roles, mean 30-DAY-month tenure
/// (one decimal, JS half-up via <see cref="ReportingMath.JsRound"/>), and the passthrough leader + open-vacancy
/// / active-OKR counts. Input order is preserved (no sort — the query order stands).
/// </summary>
public static class TeamComparisonBuilder
{
    private const double MonthMs = 1000d * 60 * 60 * 24 * 30;

    public static TeamComparisonView Build(IReadOnlyList<TeamComparisonInput> teams, long nowMs)
    {
        var rows = new List<TeamComparisonRow>(teams.Count);
        foreach (var team in teams)
        {
            var memberCount = team.Members.Count;

            var uniqueRoles = team.Members
                .Select(m => m.JobTitle)
                .Where(j => !string.IsNullOrEmpty(j))
                .Distinct(StringComparer.Ordinal)
                .Count();

            var avgTenure = 0d;
            if (memberCount > 0)
            {
                var sum = 0d;
                foreach (var m in team.Members)
                {
                    sum += (nowMs - m.CreatedAtMs) / MonthMs;
                }

                avgTenure = sum / memberCount;
            }

            rows.Add(new TeamComparisonRow(
                team.Id,
                team.Name,
                team.Leader,
                memberCount,
                uniqueRoles,
                ReportingMath.JsRound(avgTenure * 10) / 10d,
                team.OpenVacancies,
                team.ActiveOkrs));
        }

        return new TeamComparisonView(rows);
    }
}
