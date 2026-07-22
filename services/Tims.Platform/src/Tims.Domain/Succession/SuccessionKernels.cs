using System.Text.Json.Serialization;
using Tims.Domain.Reporting;

namespace Tims.Domain.Succession;

// Pure succession shaping/scoring kernels — a faithful port of the @tims/shared `succession.ts` module
// (Phase-5 succession strangler, Slice 8). No DB, no I/O, no clock. Each is golden-fixtured against the
// SAME contracts/succession-fixtures/*.json the TS export asserts (Tims.UnitTests). All rounding uses
// JS half-UP via ReportingMath.JsRound (Math.Floor(x + 0.5)), NOT .NET banker's rounding.
//
// INTERNAL reads = raw kernel shape, NO schemaVersion. Records serialize camelCase to match the tRPC wire.

// ── Read 4: getCompetencyCoverage ────────────────────────────────────────────

/// <summary>One successor's readiness (the only field competency-coverage reads).</summary>
public sealed record CoverageSuccessorInput(string Readiness);

/// <summary>One role's coverage input: id/title/criticality + its (scope-filtered) successors' readiness.</summary>
public sealed record CoverageRoleInput(
    string Id,
    string Title,
    string Criticality,
    IReadOnlyList<CoverageSuccessorInput> Successors);

/// <summary>One coverage output row (raw kernel shape, no schemaVersion).</summary>
public sealed record CoverageRow(
    string RoleId,
    string Title,
    string Criticality,
    int TotalSuccessors,
    int ReadyNow,
    int ReadySoon,
    int Developing,
    string CoverageStatus);

// ── Read 9: getDashboardKpis ─────────────────────────────────────────────────

/// <summary>The six pre-computed org counts feeding the succession KPI rollup.</summary>
public sealed record SuccessionKpiCounts(
    int TotalCriticalRoles,
    int TotalSuccessors,
    int RolesWithoutSuccessor,
    int ReadyNowCount,
    int Ready1To2YearsCount,
    int HighFlightRiskRoles);

/// <summary>The succession dashboard KPI view (field order matches the tRPC output).</summary>
public sealed record SuccessionKpiView(
    int TotalCriticalRoles,
    int TotalSuccessors,
    int RolesWithoutSuccessor,
    int CoverageRate,
    int ReadyNowCount,
    // TS wire field is `ready1to2YearsCount` (lowercase "to"); the camelCase policy would emit
    // `ready1To2YearsCount`, so pin the exact wire name.
    [property: JsonPropertyName("ready1to2YearsCount")] int Ready1To2YearsCount,
    int HighFlightRiskRoles,
    double AvgSuccessorsPerRole);

// ── Read 8: simulateExit ─────────────────────────────────────────────────────

/// <summary>The (nullable-safe) display name of a successor for the exit recommendation.</summary>
public sealed record ExitSuccessorUser(string FirstName, string LastName);

/// <summary>One successor's readiness + name for the exit-impact decision.</summary>
public sealed record ExitSuccessorInput(string Readiness, ExitSuccessorUser User);

/// <summary>The exit-impact decision (risk + recommendation + counts).</summary>
public sealed record ExitSimulation(
    string RiskLevel,
    string Recommendation,
    int ReadyNowCount,
    int PipelineCount);

// ── Read 7: getSuggestedSuccessors ───────────────────────────────────────────

/// <summary>The user display object passed through on a suggestion.</summary>
public sealed record SuggestedUser(
    string Id,
    string FirstName,
    string LastName,
    string? Avatar,
    string? JobTitle);

/// <summary>One nine-box evaluation input (userId + quadrant + scores + user).</summary>
public sealed record SuggestedEvaluationInput(
    string UserId,
    string Quadrant,
    double PotentialScore,
    double PerformanceScore,
    SuggestedUser User);

/// <summary>One ranked successor suggestion (raw kernel shape).</summary>
public sealed record SuggestedSuccessor(
    string UserId,
    SuggestedUser User,
    string Quadrant,
    double PotentialScore,
    double PerformanceScore,
    string SuggestedReadiness);

// ── Read 6: getCompGapAlerts (detection) ─────────────────────────────────────

/// <summary>The successor display object on a comp-gap alert.</summary>
public sealed record CompGapUser(string Id, string FirstName, string LastName, string? Avatar);

/// <summary>One ready-now successor input for comp-gap detection.</summary>
public sealed record CompGapSuccessorInput(string Id, string UserId, CompGapUser User);

/// <summary>One role's comp-gap input: id/title/targetBandLevel + its ready-now successors.</summary>
public sealed record CompGapRoleInput(
    string Id,
    string Title,
    string? TargetBandLevel,
    IReadOnlyList<CompGapSuccessorInput> Successors);

/// <summary>A salary band (level → midpoint) for the soft level match.</summary>
public sealed record CompGapBandInput(string Level, double MidSalary);

/// <summary>A successor's compensation. CurrentSalary/Currency are NULLABLE: null = the caller's roles are
/// not entitled to the restricted field (selectFor omitted it) → the successor is skipped (never a null-ed
/// sensitive field), mirroring the TS <c>undefined</c> skip.</summary>
public sealed record CompGapCompInput(string Id, string UserId, double? CurrentSalary, string? Currency);

/// <summary>One comp-gap alert (raw kernel shape).</summary>
public sealed record CompGapAlert(
    string SuccessorId,
    string RoleId,
    string RoleTitle,
    string UserId,
    CompGapUser User,
    double CurrentSalary,
    string Currency,
    double MidSalary,
    string BandLevel,
    int GapPercent);

/// <summary>The comp-gap detection result: the alerts + the EXPOSED comp ids the caller must audit.</summary>
public sealed record CompGapResult(
    IReadOnlyList<CompGapAlert> Alerts,
    IReadOnlyList<string> AuditedCompIds);

/// <summary>The pure succession kernels (faithful ports of @tims/shared/succession.ts).</summary>
public static class SuccessionKernels
{
    private const string ReadyNow = "ready_now";
    private const string Ready1Year = "ready_1_year";
    private const string Ready2Years = "ready_2_years";
    private const double CompGapThreshold = 0.9;

    /// <summary>Per-role coverage rollup (buildCompetencyCoverage). Row order = input order.</summary>
    public static IReadOnlyList<CoverageRow> BuildCompetencyCoverage(IReadOnlyList<CoverageRoleInput> roles)
    {
        var rows = new List<CoverageRow>(roles.Count);
        foreach (var role in roles)
        {
            var totalSuccessors = role.Successors.Count;
            var readyNow = role.Successors.Count(s => s.Readiness == ReadyNow);
            var readySoon = role.Successors.Count(s => s.Readiness is Ready1Year or Ready2Years);

            rows.Add(new CoverageRow(
                role.Id,
                role.Title,
                role.Criticality,
                totalSuccessors,
                readyNow,
                readySoon,
                totalSuccessors - readyNow - readySoon,
                readyNow >= 1 ? "covered" : totalSuccessors >= 1 ? "partial" : "uncovered"));
        }

        return rows;
    }

    /// <summary>The succession dashboard KPI rollup (buildSuccessionKpis). coverageRate integer percent,
    /// avgSuccessorsPerRole one-decimal; both JS half-up and 0 when there are no roles.</summary>
    public static SuccessionKpiView BuildSuccessionKpis(SuccessionKpiCounts c)
    {
        var coverageRate = c.TotalCriticalRoles > 0
            ? (int)ReportingMath.JsRound(
                (double)(c.TotalCriticalRoles - c.RolesWithoutSuccessor) / c.TotalCriticalRoles * 100)
            : 0;
        var avgSuccessorsPerRole = c.TotalCriticalRoles > 0
            ? ReportingMath.JsRound((double)c.TotalSuccessors / c.TotalCriticalRoles * 10) / 10d
            : 0d;

        return new SuccessionKpiView(
            c.TotalCriticalRoles,
            c.TotalSuccessors,
            c.RolesWithoutSuccessor,
            coverageRate,
            c.ReadyNowCount,
            c.Ready1To2YearsCount,
            c.HighFlightRiskRoles,
            avgSuccessorsPerRole);
    }

    /// <summary>The exit-impact decision (buildExitSimulation). Names the FIRST ready-now successor (repo
    /// readiness-asc order). Recommendation strings are ASCII verbatim from the router.</summary>
    public static ExitSimulation BuildExitSimulation(IReadOnlyList<ExitSuccessorInput> successors)
    {
        var readyNow = successors.Where(s => s.Readiness == ReadyNow).ToList();
        var readySoon = successors.Count(s => s.Readiness is Ready1Year or Ready2Years);

        string riskLevel;
        string recommendation;
        if (readyNow.Count >= 1)
        {
            riskLevel = "low";
            recommendation = $"Sucesor listo: {readyNow[0].User.FirstName} {readyNow[0].User.LastName}";
        }
        else if (readySoon >= 1)
        {
            riskLevel = "medium";
            recommendation = "Sucesor disponible en 1-2 anos. Considerar plan de aceleracion.";
        }
        else
        {
            riskLevel = "high";
            recommendation = "Sin sucesores identificados. Iniciar busqueda inmediata.";
        }

        return new ExitSimulation(riskLevel, recommendation, readyNow.Count, successors.Count);
    }

    /// <summary>Ranked successor suggestions (buildSuggestedSuccessors). Input MUST be pre-ordered
    /// evaluatedAt desc, createdAt desc — first-seen per user is kept; then star/high_potential only,
    /// exclude existing successor users, sort potentialScore desc then performanceScore desc (stable).</summary>
    public static IReadOnlyList<SuggestedSuccessor> BuildSuggestedSuccessors(
        IReadOnlyList<SuggestedEvaluationInput> evaluations,
        IReadOnlyList<string> existingUserIds)
    {
        var existing = new HashSet<string>(existingUserIds, StringComparer.Ordinal);

        // First-seen dedup PRESERVING input order (mirrors the JS Map insertion order the sort relies on).
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var latest = new List<SuggestedEvaluationInput>();
        foreach (var ev in evaluations)
        {
            if (seen.Add(ev.UserId))
            {
                latest.Add(ev);
            }
        }

        return latest
            .Where(ev => ev.Quadrant is "star" or "high_potential")
            .Where(ev => !existing.Contains(ev.UserId))
            .OrderByDescending(ev => ev.PotentialScore) // stable → full ties keep first-seen order
            .ThenByDescending(ev => ev.PerformanceScore)
            .Select(ev => new SuggestedSuccessor(
                ev.UserId,
                ev.User,
                ev.Quadrant,
                ev.PotentialScore,
                ev.PerformanceScore,
                ev.Quadrant == "star" ? "ready_now" : "ready_1_year"))
            .ToList();
    }

    /// <summary>The comp-gap detection loop (buildCompGapAlerts). Alert iff currentSalary &lt; midSalary*0.9;
    /// gapPercent = round((1 - currentSalary/midSalary) * 100) JS half-up. Skips roles with no matching band
    /// and successors with no/unentitled compensation. Returns the alerts + the EXPOSED comp ids to audit.</summary>
    public static CompGapResult BuildCompGapAlerts(
        IReadOnlyList<CompGapRoleInput> roles,
        IReadOnlyList<CompGapBandInput> bands,
        IReadOnlyList<CompGapCompInput> comps)
    {
        var bandByLevel = new Dictionary<string, CompGapBandInput>(StringComparer.Ordinal);
        foreach (var b in bands)
        {
            bandByLevel[b.Level] = b;
        }

        var compByUser = new Dictionary<string, CompGapCompInput>(StringComparer.Ordinal);
        foreach (var comp in comps)
        {
            compByUser[comp.UserId] = comp;
        }

        var alerts = new List<CompGapAlert>();
        var auditedCompIds = new List<string>();

        foreach (var role in roles)
        {
            CompGapBandInput? band = role.TargetBandLevel is not null
                && bandByLevel.TryGetValue(role.TargetBandLevel, out var found)
                    ? found
                    : null;
            if (band is null)
            {
                continue;
            }

            foreach (var successor in role.Successors)
            {
                if (!compByUser.TryGetValue(successor.UserId, out var comp)
                    || comp.CurrentSalary is not { } currentSalary
                    || comp.Currency is not { } currency)
                {
                    continue;
                }

                if (currentSalary < band.MidSalary * CompGapThreshold)
                {
                    alerts.Add(new CompGapAlert(
                        successor.Id,
                        role.Id,
                        role.Title,
                        successor.UserId,
                        successor.User,
                        currentSalary,
                        currency,
                        band.MidSalary,
                        band.Level,
                        (int)ReportingMath.JsRound((1 - currentSalary / band.MidSalary) * 100)));
                    auditedCompIds.Add(comp.Id);
                }
            }
        }

        return new CompGapResult(alerts, auditedCompIds);
    }
}
