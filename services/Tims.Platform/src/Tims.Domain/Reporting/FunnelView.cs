using System;
using System.Collections.Generic;
using System.Linq;

namespace Tims.Domain.Reporting;

/// <summary>One funnel stage on the wire: merged display <see cref="Name"/>, active <see cref="Count"/>,
/// and <see cref="PctOfMax"/> (share of the largest stage, 0–100).</summary>
public sealed record FunnelStageView(string Name, int Count, int PctOfMax);

/// <summary>
/// The <c>recruitmentAnalytics.getFunnel</c> response — a faithful reproduction of the object the TS router
/// returns via the shared <c>buildFunnelView</c> (@tims/shared). INTERNAL staff read = raw view shape, NO
/// <c>schemaVersion</c>. Golden-fixtured BOTH stacks (contracts/reporting-fixtures/funnel-view.json).
/// </summary>
public sealed record FunnelView(
    IReadOnlyList<FunnelStageView> Stages,
    int TotalApplications,
    int TotalHired,
    double? ConversionPct);

public sealed record FunnelStageInput(string Id, string Name, int Order);
public sealed record FunnelCountInput(string StageId, int Count);

/// <summary>
/// Pure builder for <see cref="FunnelView"/> — the port of the TS <c>buildFunnelView</c>. Stages MERGE BY NAME
/// (same-name summed, order = min), sort by order (stable — ties keep first-seen order, matching JS
/// <c>Array.sort</c>), and rounding uses JS <c>Math.round</c> semantics (half-UP toward +Infinity via
/// <c>Floor(x + 0.5)</c>, NOT banker's rounding).
/// </summary>
public static class FunnelViewBuilder
{
    public static FunnelView Build(
        IReadOnlyList<FunnelStageInput> stages,
        IReadOnlyList<FunnelCountInput> counts,
        int totalApplications,
        int totalHired)
    {
        var countByStageId = new Dictionary<string, int>();
        foreach (var c in counts) countByStageId[c.StageId] = c.Count;

        // First-seen insertion order preserved (like a JS Map) so the stable sort below
        // breaks order-ties identically to the TS `[...merged.values()].sort(...)`.
        var merged = new Dictionary<string, (string Name, int Order, int Count)>();
        var firstSeen = new List<string>();
        foreach (var s in stages)
        {
            var add = countByStageId.TryGetValue(s.Id, out var cc) ? cc : 0;
            if (merged.TryGetValue(s.Name, out var e))
            {
                merged[s.Name] = (e.Name, Math.Min(e.Order, s.Order), e.Count + add);
            }
            else
            {
                merged[s.Name] = (s.Name, s.Order, add);
                firstSeen.Add(s.Name);
            }
        }

        var funnel = firstSeen.Select(n => merged[n]).OrderBy(f => f.Order).ToList();
        var maxCount = funnel.Count == 0 ? 1 : Math.Max(1, funnel.Max(f => f.Count));

        var stageViews = funnel
            .Select(f => new FunnelStageView(f.Name, f.Count, (int)ReportingMath.JsRound((double)f.Count / maxCount * 100)))
            .ToList();

        double? conversionPct = totalApplications > 0
            ? ReportingMath.JsRound((double)totalHired / totalApplications * 1000) / 10.0
            : null;

        return new FunnelView(stageViews, totalApplications, totalHired, conversionPct);
    }
}
