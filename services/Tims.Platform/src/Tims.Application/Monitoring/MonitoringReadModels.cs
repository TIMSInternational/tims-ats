using System.Text.Json.Nodes;
using Tims.Domain.Monitoring;

namespace Tims.Application.Monitoring;

/// <summary>
/// Wire shapes for the monitoring READ surface (Phase-5 Q0b slice 1, issue #100). Field-for-field
/// identical to the tRPC <c>monitoring.*</c> outputs they replace — INTERNAL staff reads, so the RAW
/// procedure shape with NO <c>schemaVersion</c> envelope (the #141 lesson), camelCase on the wire via
/// the default minimal-API serializer.
/// </summary>
/// <param name="TotalEmployees">Active user count (NOT k-anon floored — <c>users</c> is not a §21-restricted population).</param>
/// <param name="PendingAdjustments">
/// NULL exactly when <paramref name="PendingAdjustmentsSuppressed"/> is true. This is a raw COUNT over
/// <c>salary_adjustments</c>, a §21-restricted population, so a 1..4 result is a sub-floor disclosure
/// and is nulled by <c>KAnonymity.SuppressBelowMin5</c>. 0 passes through (it reveals nobody).
/// </param>
public sealed record ExecutiveKpiView(
    int TotalEmployees,
    int ActiveVacancies,
    int? PendingAdjustments,
    bool PendingAdjustmentsSuppressed,
    int ActiveSurveys,
    int OpenAlerts,
    double TurnoverRate,
    int TerminationsLast12m);

/// <summary>The raw counts <see cref="ExecutiveKpiView"/> is built from (pre-suppression).</summary>
public sealed record ExecutiveKpiCounts(
    int TotalUsers,
    int ActiveVacancies,
    int PendingAdjustments,
    int ActiveSurveys,
    int OpenAlerts);

/// <summary>One row of <c>getActiveAlerts</c> — the TS <c>select</c> exactly (no metadata, no dismissal fields).</summary>
public sealed record ActiveAlertView(
    string Id,
    string Severity,
    string Module,
    string Title,
    string Message,
    DateTimeOffset CreatedAt);

/// <summary>The <c>getActiveAlerts</c> page envelope (<c>{ items, total, page, limit }</c>).</summary>
public sealed record ActiveAlertsPage(IReadOnlyList<ActiveAlertView> Items, int Total, int Page, int Limit);

/// <summary>The action-plan responsible's user select (<c>{ id, firstName, lastName, avatar }</c>).</summary>
public sealed record ActionPlanAlertResponsible(string Id, string FirstName, string LastName, string? Avatar);

/// <summary>One row of <c>getActionPlanAlerts</c>.</summary>
public sealed record ActionPlanAlertView(
    string Id,
    string Title,
    string? Area,
    string Status,
    DateTimeOffset? DueDate,
    ActionPlanAlertResponsible Responsible);

/// <summary>The <c>getActionPlanAlerts</c> envelope (<c>{ items, total }</c>; total = items.length, NOT a DB count).</summary>
public sealed record ActionPlanAlertsView(IReadOnlyList<ActionPlanAlertView> Items, int Total);

/// <summary>The <c>getCrossModuleTrend</c> envelope.</summary>
public sealed record CrossModuleTrendView(string Metric, string Period, IReadOnlyList<TrendPoint> Data);

/// <summary>One row of <c>getAlertRules</c>. <c>Condition</c> is the raw jsonb rule condition.</summary>
public sealed record AlertRuleView(
    string Id,
    string Module,
    JsonNode? Condition,
    string Severity,
    string Message,
    bool IsActive);
