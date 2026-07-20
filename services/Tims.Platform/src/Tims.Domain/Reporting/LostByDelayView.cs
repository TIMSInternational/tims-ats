using System.Collections.Generic;
using System.Linq;

namespace Tims.Domain.Reporting;

public sealed record LostByDelayApp(string StageName, double? SlaHours, long? RejectedAtMs, long AppliedAtMs, long? LastMovedAtMs);

/// <summary>One stage row: <see cref="StageName"/>, its SLA in whole days, the <see cref="LostCount"/>
/// rejected while overdue, and the average days over SLA.</summary>
public sealed record LostByDelayItem(string StageName, int SlaDays, int LostCount, int AvgDaysOver);

public sealed record LostByDelayView(int Total, IReadOnlyList<LostByDelayItem> Items);

/// <summary>
/// Pure builder for <c>recruitmentAnalytics.getLostByDelay</c> — port of the TS
/// <c>buildLostByDelayView</c> (@tims/shared). Candidates rejected while STRICTLY overdue on their stage
/// SLA, grouped by stage NAME (first-seen SLA kept; first-seen insertion order preserved for stable
/// tie-breaking). <c>slaDays</c>/<c>avgDaysOver</c> round half-up. Items sort by lostCount descending
/// (stable). Golden-fixtured BOTH stacks (contracts/reporting-fixtures/lost-by-delay-view.json).
/// </summary>
public static class LostByDelayViewBuilder
{
    public static LostByDelayView Build(IReadOnlyList<LostByDelayApp> rejected)
    {
        // Dictionary keyed by stage name; firstSeen preserves JS Map insertion order so the stable
        // lostCount-descending sort below breaks ties identically to the TS `[...byStage.values()]`.
        var byStage = new Dictionary<string, (string StageName, double SlaHours, int Lost, List<double> HoursOver)>();
        var firstSeen = new List<string>();

        foreach (var r in rejected)
        {
            if (!r.SlaHours.HasValue || !r.RejectedAtMs.HasValue) continue;
            var hours = ReportingHelpers.HoursInStage(r.AppliedAtMs, r.LastMovedAtMs, r.RejectedAtMs.Value);
            if (hours <= r.SlaHours.Value) continue;

            if (byStage.TryGetValue(r.StageName, out var e))
            {
                e.HoursOver.Add(hours - r.SlaHours.Value);
                byStage[r.StageName] = (e.StageName, e.SlaHours, e.Lost + 1, e.HoursOver);
            }
            else
            {
                byStage[r.StageName] = (r.StageName, r.SlaHours.Value, 1, new List<double> { hours - r.SlaHours.Value });
                firstSeen.Add(r.StageName);
            }
        }

        var items = firstSeen
            .Select(n => byStage[n])
            .Select(e => new LostByDelayItem(
                e.StageName,
                (int)ReportingMath.JsRound(e.SlaHours / 24),
                e.Lost,
                (int)ReportingMath.JsRound(e.HoursOver.Sum() / e.HoursOver.Count / 24)))
            .OrderByDescending(i => i.LostCount)
            .ToList();

        return new LostByDelayView(items.Sum(i => i.LostCount), items);
    }
}
