using System.Collections.Generic;
using System.Linq;

namespace Tims.Domain.Reporting;

public sealed record RecruiterVacancy(string Id, string AssignedTo, string? FirstName, string? LastName);
public sealed record RecruiterAppCount(string VacancyId, int Count);
public sealed record RecruiterAcceptedOffer(string VacancyId, long? RespondedAtMs, long VacancyCreatedAtMs);
public sealed record RecruiterActiveApp(string VacancyId, double? SlaHours, long AppliedAtMs, long? LastMovedAtMs);

public sealed record RecruiterSlaInput(
    long NowMs,
    IReadOnlyList<RecruiterVacancy> Vacancies,
    IReadOnlyList<RecruiterAppCount> AppCounts,
    IReadOnlyList<RecruiterAcceptedOffer> Accepted,
    IReadOnlyList<RecruiterActiveApp> Active);

/// <summary>One recruiter row: display <see cref="Name"/>, <see cref="Vacancies"/> owned,
/// <see cref="Candidates"/> across them, average time-to-fill days, and active-pipeline SLA compliance %.</summary>
public sealed record RecruiterSlaRow(string Name, int Vacancies, int Candidates, int? AvgTtfDays, int? SlaCompliancePct);

/// <summary>
/// Pure builder for <c>recruitmentAnalytics.getRecruiterSla</c> — port of the TS
/// <c>buildRecruiterSlaView</c> (@tims/shared). Recruiters keyed by <c>assignedTo</c> (first-seen assignee
/// name kept; first-seen insertion order preserved for stable tie-breaking); candidates = applications
/// across their vacancies; avgTtf = mean non-negative accepted-offer span; slaCompliance = share of active
/// apps within stage SLA (SLA-less stages excluded). Rows sort by vacancy count descending (stable).
/// Golden-fixtured BOTH stacks (contracts/reporting-fixtures/recruiter-sla-view.json).
/// </summary>
public static class RecruiterSlaViewBuilder
{
    private sealed class Row
    {
        public required string Name { get; init; }
        public List<string> VacancyIds { get; } = new();
        public int Candidates { get; set; }
        public List<long> TtfSpans { get; } = new();
        public int ActiveTotal { get; set; }
        public int ActiveOnTime { get; set; }
    }

    public static IReadOnlyList<RecruiterSlaRow> Build(RecruiterSlaInput input)
    {
        var appsByVacancy = new Dictionary<string, int>();
        foreach (var c in input.AppCounts) appsByVacancy[c.VacancyId] = c.Count;

        // Insertion-order-preserving map (like a JS Map) so the stable vacancy-descending sort at the
        // end breaks ties identically to the TS `[...byRecruiter.values()]`.
        var byRecruiter = new Dictionary<string, Row>();
        var firstSeen = new List<string>();
        foreach (var v in input.Vacancies)
        {
            if (!byRecruiter.TryGetValue(v.AssignedTo, out var row))
            {
                row = new Row { Name = $"{v.FirstName ?? string.Empty} {v.LastName ?? string.Empty}".Trim() };
                byRecruiter[v.AssignedTo] = row;
                firstSeen.Add(v.AssignedTo);
            }
            row.VacancyIds.Add(v.Id);
            row.Candidates += appsByVacancy.TryGetValue(v.Id, out var n) ? n : 0;
        }

        var vacancyToRecruiter = new Dictionary<string, Row>();
        foreach (var key in firstSeen)
            foreach (var id in byRecruiter[key].VacancyIds)
                vacancyToRecruiter[id] = byRecruiter[key];

        foreach (var o in input.Accepted)
        {
            if (vacancyToRecruiter.TryGetValue(o.VacancyId, out var row) && o.RespondedAtMs.HasValue)
            {
                var span = o.RespondedAtMs.Value - o.VacancyCreatedAtMs;
                if (span >= 0) row.TtfSpans.Add(span);
            }
        }

        foreach (var app in input.Active)
        {
            if (!vacancyToRecruiter.TryGetValue(app.VacancyId, out var row)) continue;
            if (!app.SlaHours.HasValue) continue; // stages without an SLA don't count against compliance
            row.ActiveTotal++;
            if (ReportingHelpers.HoursInStage(app.AppliedAtMs, app.LastMovedAtMs, input.NowMs) <= app.SlaHours.Value)
                row.ActiveOnTime++;
        }

        return firstSeen
            .Select(key => byRecruiter[key])
            .Select(r => new RecruiterSlaRow(
                r.Name,
                r.VacancyIds.Count,
                r.Candidates,
                ReportingHelpers.AvgDaysFromSpans(r.TtfSpans),
                r.ActiveTotal > 0 ? (int)ReportingMath.JsRound((double)r.ActiveOnTime / r.ActiveTotal * 100) : null))
            .OrderByDescending(r => r.Vacancies)
            .ToList();
    }
}
