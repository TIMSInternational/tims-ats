using System.Text.Json.Nodes;
using Tims.Domain.Engagement;

namespace Tims.Application.Engagement;

// Intermediate repository DTOs for the engagement READ surface (Phase-5 Slice 11) — the data the reads pull
// BEFORE the pure @tims/shared / Tims.Domain.Engagement kernels shape them. Kept infra-free (Application layer).

/// <summary>One raw survey row for listSurveys (the raw <c>responseCount</c> is floored by the use case).</summary>
public sealed record SurveyListRow(
    string Id,
    string Title,
    string Type,
    string Status,
    DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int ResponseCount);

/// <summary>listSurveys page: the raw rows + the org-wide total (for the same where).</summary>
public sealed record SurveyListPage(IReadOnlyList<SurveyListRow> Rows, int Total);

/// <summary>getSurveyResults input: the survey scalars + each response's answers (minimal answers-only select).</summary>
public sealed record SurveyResultsData(
    string Id,
    string Title,
    IReadOnlyList<JsonObject> Questions,
    IReadOnlyList<JsonObject> ResponseAnswers);

/// <summary>getClimateHeatmap input: the (most-recent climate) survey scalars + response answers.</summary>
public sealed record ClimateSurveyData(
    string Id,
    string Title,
    IReadOnlyList<JsonObject> Questions,
    IReadOnlyList<JsonObject> ResponseAnswers);

/// <summary>getResultsByArea input: one response's answers + its user's company/business-unit (null when the
/// user has none, or was deleted → SetNull).</summary>
public sealed record AreaResponseRow(JsonObject Answers, string? CompanyId, string? BusinessUnitId);

/// <summary>getResultsByArea input: the survey id + its responses' answers/area anchors.</summary>
public sealed record AreaSurveyData(string Id, IReadOnlyList<AreaResponseRow> Responses);

/// <summary>getDashboardKpis input: the counts + per-survey response counts (for the differencing guard).</summary>
public sealed record EngagementKpiData(
    int ActiveSurveys,
    int TotalResponses,
    IReadOnlyList<int> PerSurveyCounts,
    int ActionPlansOpen);
