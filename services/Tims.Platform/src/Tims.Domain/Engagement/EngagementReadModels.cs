using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Engagement;

// Wire-shaped read models for the engagement READ surface (Phase-5 Slice 11) — faithful to the tRPC output of
// the live engagement router. INTERNAL reads = raw model / kernel shape, NO schemaVersion. Records serialize
// camelCase to match the wire; Prisma timestamp(3) columns are carried as UTC DateTimeOffset and emitted via the
// shared Node-ISO converter (Date.toISOString() `…fffZ`). jsonb columns (survey questions, alert metadata,
// action-plan actions) are passed through as raw JsonNode.

// ── listSurveys (read #1) ───────────────────────────────────────────────────────

/// <summary>One list-UI survey row. The raw <c>responseCount</c> scalar is min-5 FLOORED (null when 1..4) with a
/// <see cref="ResponseCountSuppressed"/> flag — never the raw sub-floor head-count.</summary>
public sealed record SurveyListItem(
    string Id,
    string Title,
    string Type,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? StartsAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? EndsAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    int? ResponseCount,
    bool ResponseCountSuppressed);

/// <summary>listSurveys paged envelope: <c>{ items, total, page, limit }</c>.</summary>
public sealed record SurveyListView(IReadOnlyList<SurveyListItem> Items, int Total, int Page, int Limit);

// ── getSurveyResults (read #2) ──────────────────────────────────────────────────

/// <summary>getSurveyResults wire: the surveyId/title wrapper around the shared summarizeSurveyResults kernel.</summary>
public sealed record SurveyResultsView(
    string SurveyId,
    string Title,
    int? TotalResponses,
    bool Suppressed,
    IReadOnlyList<QuestionSummary> QuestionSummaries);

// ── myPendingSurveys (read #3) ──────────────────────────────────────────────────

/// <summary>One pending survey (OWN self-service): renderable list fields only.</summary>
public sealed record PendingSurveyRow(
    string Id,
    string Title,
    string Type,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? StartsAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? EndsAt);

// ── getSurveyForResponse (read #4) ──────────────────────────────────────────────

/// <summary>getSurveyForResponse wire (OWN self-service): the renderable definition (questions = jsonb passthrough).</summary>
public sealed record SurveyForResponseView(string Id, string Title, string Type, JsonNode? Questions);

// ── getClimateHeatmap (read #6) ─────────────────────────────────────────────────

/// <summary>getClimateHeatmap wire: the surveyId/title wrapper around the shared buildClimateHeatmap kernel
/// (surveyId null + empty data when the org has no climate survey).</summary>
public sealed record ClimateHeatmapView(
    string? SurveyId,
    string Title,
    bool Suppressed,
    IReadOnlyList<HeatCell> Data);

// ── getResultsByArea (read #7) ──────────────────────────────────────────────────

/// <summary>getResultsByArea wire: the surveyId/groupBy wrapper around the shared buildResultsByArea kernel.</summary>
public sealed record ResultsByAreaView(
    string SurveyId,
    string GroupBy,
    IReadOnlyList<AreaResult> Results,
    bool Suppressed);

// ── getWordCloud / getSentiment (reads #8/#9 — stubs) ───────────────────────────

/// <summary>getWordCloud stub wire: <c>{ words: [] }</c>.</summary>
public sealed record WordCloudView(IReadOnlyList<WordWeight> Words);

public sealed record WordWeight(string Text, double Weight);

/// <summary>getSentiment stub wire: <c>{ positive, neutral, negative, highlights: [] }</c>.</summary>
public sealed record SentimentView(int Positive, int Neutral, int Negative, IReadOnlyList<string> Highlights);

// ── getLowClimateAlerts (read #10) ──────────────────────────────────────────────

/// <summary>One monitoring Alert row (module='engagement', status='active'), the raw model shape.</summary>
public sealed record AlertRow(
    string Id,
    string OrganizationId,
    string? RuleId,
    string Module,
    string Severity,
    string Title,
    string Message,
    JsonNode? Metadata,
    string Status,
    string? DismissedById,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? DismissedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt);

// ── listActionPlans (read #11) ──────────────────────────────────────────────────

public sealed record ActionPlanResponsible(string Id, string FirstName, string LastName, string? Avatar);

/// <summary>One action plan (all scalars + the responsible user), the raw model shape.</summary>
public sealed record ActionPlanRow(
    string Id,
    string OrganizationId,
    string Title,
    string ResponsibleId,
    string? Area,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? DueDate,
    JsonNode? Actions,
    string? Notes,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    ActionPlanResponsible Responsible);

// ── listLeaderCommitments (read #12) ────────────────────────────────────────────

public sealed record LeaderCommitmentLeader(string Id, string FirstName, string LastName, string? Avatar);

/// <summary>One leader commitment (all scalars + the leader user), the raw model shape.</summary>
public sealed record LeaderCommitmentRow(
    string Id,
    string OrganizationId,
    string LeaderId,
    string Description,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? DueDate,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? CompletedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    LeaderCommitmentLeader Leader);

// ── getRotationRisk (read #14 — mostly stub) ────────────────────────────────────

public sealed record RotationRiskSummary(int High, int Medium, int Low, int Total);

/// <summary>getRotationRisk stub wire: <c>{ summary: {high,medium,low,total}, topRisk: [] }</c>.</summary>
public sealed record RotationRiskView(RotationRiskSummary Summary, IReadOnlyList<JsonNode> TopRisk);
