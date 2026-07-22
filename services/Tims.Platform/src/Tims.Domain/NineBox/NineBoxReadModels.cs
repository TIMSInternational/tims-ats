using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.NineBox;

/// <summary>
/// Wire shapes for the Phase-5 Slice 10 nine-box READ surface — faithful ports of what the live TS
/// <c>ninebox</c> router returns (packages/api/src/routers/ninebox.ts). INTERNAL staff reads = the RAW Prisma
/// model / include shape, NO <c>schemaVersion</c>. Every date serializes through the shared Node-ISO
/// converter (<c>…fffZ</c>, matching Node's <c>Date.toISOString()</c>), and <c>axisBreakdown</c> is a jsonb
/// passthrough (<see cref="JsonNode"/>). The pure kernels (<see cref="NineBoxKernels"/>) back reads
/// #1/#4/#5/#9/#10/#11; the models here back the raw-model reads (#1/#2/#3 evaluations, #6/#7/#8 calibration).
/// </summary>

// ── nine-box evaluation sub-shapes ─────────────────────────────────────────────

/// <summary>evaluation.user select for getGrid (id, firstName, lastName, avatar, jobTitle — no email).</summary>
public sealed record GridUser(string Id, string FirstName, string LastName, string? Avatar, string? JobTitle);

/// <summary>evaluation.user select for getEmployeeDetail (adds email).</summary>
public sealed record EmployeeDetailUser(
    string Id, string FirstName, string LastName, string? Avatar, string? JobTitle, string Email);

/// <summary>getGrid grid cell value: the FULL nine_box_evaluation scalars (incl. jsonb axisBreakdown) + user.</summary>
public sealed record GridEvaluation(
    string Id,
    string OrganizationId,
    string UserId,
    string Period,
    double PotentialScore,
    double PerformanceScore,
    string Quadrant,
    double Confidence,
    JsonNode? AxisBreakdown,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset EvaluatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    GridUser User);

/// <summary>getGrid response: period + grid (gridKey → evaluations, evaluatedAt-desc order preserved) + total.</summary>
public sealed record GridView(
    string Period,
    IReadOnlyDictionary<string, IReadOnlyList<GridEvaluation>> Grid,
    int TotalEvaluations);

/// <summary>getEmployeeDetail evaluation (FULL scalars + user-with-email); null when the employee has no
/// evaluation for the period (the TS findFirst may return null — NOT an error).</summary>
public sealed record EmployeeDetailEvaluation(
    string Id,
    string OrganizationId,
    string UserId,
    string Period,
    double PotentialScore,
    double PerformanceScore,
    string Quadrant,
    double Confidence,
    JsonNode? AxisBreakdown,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset EvaluatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    EmployeeDetailUser User);

/// <summary>getEmployeeDetail history row (all periods for the user, evaluatedAt asc).</summary>
public sealed record EmployeeHistoryRow(
    string Period,
    string Quadrant,
    double PotentialScore,
    double PerformanceScore,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset EvaluatedAt);

/// <summary>getEmployeeDetail response: the (nullable) evaluation + the cross-period history.</summary>
public sealed record EmployeeDetailView(
    EmployeeDetailEvaluation? Evaluation,
    IReadOnlyList<EmployeeHistoryRow> History);

/// <summary>getAxisBreakdown response (findFirstOrThrow → 404 when absent). axisBreakdown is jsonb passthrough.</summary>
public sealed record AxisBreakdownView(
    string UserId,
    string Period,
    double PotentialScore,
    double PerformanceScore,
    string Quadrant,
    double Confidence,
    JsonNode? AxisBreakdown);

/// <summary>getMovementHistory response: the per-user consecutive-change movements + their count.</summary>
public sealed record MovementHistoryView(IReadOnlyList<QuadrantMovement> Movements, int TotalMovements);

/// <summary>simulate (read #5) response — the simulated quadrant + bands + the <c>_stub</c> marker.</summary>
public sealed record SimulateView(
    string UserId,
    string SimulatedQuadrant,
    string PotentialBand,
    string PerformanceBand,
    [property: JsonPropertyName("_stub")] bool Stub);

/// <summary>getBenchStrength (read #10) response — period + the bench-strength kernel rollup.</summary>
public sealed record BenchStrengthView(
    string Period,
    int Total,
    IReadOnlyDictionary<string, int> Distribution,
    int HighPotentialRatio,
    int BenchStrength);

/// <summary>getDashboardKpis (read #11) response — counts + the quadrant distribution.</summary>
public sealed record DashboardKpisView(
    string Period,
    int TotalEvaluations,
    int CalibrationSessions,
    int ActiveCalibrations,
    IReadOnlyDictionary<string, int> Distribution);

// ── calibration ────────────────────────────────────────────────────────────────

/// <summary>listCalibrations <c>_count</c> aggregate ({"members":N}).</summary>
public sealed record CalibrationMemberCount(int Members);

/// <summary>listCalibrations row (bounded 100, createdAt desc): scalars + <c>_count.members</c>.</summary>
public sealed record CalibrationListRow(
    string Id,
    string Period,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? ScheduledAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonPropertyName("_count")] CalibrationMemberCount Count);

/// <summary>myCalibrations <c>_count</c> aggregate ({"members":N,"votes":M}).</summary>
public sealed record MyCalibrationCount(int Members, int Votes);

/// <summary>myCalibrations row (bounded 100, createdAt desc): scalars + <c>_count.{members,votes}</c>.</summary>
public sealed record MyCalibrationRow(
    string Id,
    string Period,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? ScheduledAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? CompletedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonPropertyName("_count")] MyCalibrationCount Count);

/// <summary>getCalibration creator select ({ id, firstName, lastName }).</summary>
public sealed record CalibrationCreator(string Id, string FirstName, string LastName);

/// <summary>getCalibration member.user select ({ id, firstName, lastName, avatar }).</summary>
public sealed record CalibrationMemberUser(string Id, string FirstName, string LastName, string? Avatar);

/// <summary>getCalibration member row (full CalibrationMember scalars + user).</summary>
public sealed record CalibrationMemberRow(
    string Id,
    string SessionId,
    string UserId,
    string Status,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    CalibrationMemberUser User);

/// <summary>getCalibration vote.evaluatedUser / vote.voter select ({ id, firstName, lastName }).</summary>
public sealed record CalibrationVoteUser(string Id, string FirstName, string LastName);

/// <summary>getCalibration vote row (full CalibrationVote scalars + evaluatedUser + voter).</summary>
public sealed record CalibrationVoteRow(
    string Id,
    string SessionId,
    string EvaluatedUserId,
    string VoterId,
    string Quadrant,
    string? Justification,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    CalibrationVoteUser EvaluatedUser,
    CalibrationVoteUser Voter);

/// <summary>getCalibration response: full CalibrationSession scalars + creator + members + votes.</summary>
public sealed record CalibrationDetailView(
    string Id,
    string OrganizationId,
    string Period,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? ScheduledAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? CompletedAt,
    string CreatedById,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    CalibrationCreator Creator,
    IReadOnlyList<CalibrationMemberRow> Members,
    IReadOnlyList<CalibrationVoteRow> Votes);
