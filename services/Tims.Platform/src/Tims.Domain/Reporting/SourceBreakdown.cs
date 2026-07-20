using System.Collections.Generic;
using System.Linq;

namespace Tims.Domain.Reporting;

public sealed record SourceApplications(string Source, int Applications);

/// <summary>One source row on the wire: <see cref="Source"/>, its <see cref="Applications"/> count in
/// the period, and the <see cref="Hires"/> that converted from it.</summary>
public sealed record SourceBreakdownItem(string Source, int Applications, int Hires);

/// <summary>
/// Pure builder for <c>recruitmentAnalytics.getSourceBreakdown</c> — port of the TS
/// <c>buildSourceBreakdown</c> (@tims/shared). Applications + hires per source, top 6 by application
/// volume descending (STABLE — ties keep input order, matching JS <c>Array.sort</c> + LINQ
/// <c>OrderByDescending</c>). Golden-fixtured BOTH stacks (contracts/reporting-fixtures/source-breakdown.json).
/// </summary>
public static class SourceBreakdownBuilder
{
    public static IReadOnlyList<SourceBreakdownItem> Build(
        IReadOnlyList<SourceApplications> apps,
        IReadOnlyList<string> hireSources)
    {
        var hiresBySource = new Dictionary<string, int>();
        foreach (var s in hireSources)
            hiresBySource[s] = (hiresBySource.TryGetValue(s, out var c) ? c : 0) + 1;

        return apps
            .Select(a => new SourceBreakdownItem(
                a.Source,
                a.Applications,
                hiresBySource.TryGetValue(a.Source, out var h) ? h : 0))
            .OrderByDescending(a => a.Applications)
            .Take(6)
            .ToList();
    }
}
