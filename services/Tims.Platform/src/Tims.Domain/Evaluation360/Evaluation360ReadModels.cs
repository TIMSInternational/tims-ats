using System.Text.Json.Serialization;
using Tims.Domain.Access;
using Tims.Domain.Json;

namespace Tims.Domain.Evaluation360;

/// <summary>
/// Wire shapes for the Phase-5 Slice 7 evaluation360 READ surface — faithful ports of what the live TS
/// <c>evaluation360</c> router returns (packages/api/src/services/evaluation360.service.ts). INTERNAL staff /
/// self-service reads = the RAW model / service-projection shape, NO <c>schemaVersion</c>. Every date field is
/// serialized through the shared Node-ISO converter (<c>…fffZ</c>, matching Node's <c>Date.toISOString()</c>),
/// exactly as the billing invoice reads (Slice 3) do — the same "raw model → HTTP wire" contract.
/// </summary>
public static class Eval360Competencies
{
    /// <summary>The FRESH 360 competency set (packages/shared EVAL360_COMPETENCIES) — the SAME fixed, ordered
    /// list <c>myRaterTasks</c> attaches to every task in the TS service.</summary>
    public static readonly IReadOnlyList<string> All = new[]
    {
        "leadership", "communication", "collaboration", "execution", "adaptability", "integrity",
    };
}

/// <summary>
/// A <c>listCycles</c> item — the raw <c>ReviewCycle</c> repo select
/// (<c>id, name, status, opensAt, closesAt, publishedAt, createdAt</c>). <c>status</c> crosses as its DB enum
/// label; the four dates serialize as Node-ISO strings (nullable → JSON <c>null</c>).
/// </summary>
public sealed record CycleSummaryV1(
    string Id,
    string Name,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? OpensAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? ClosesAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? PublishedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset CreatedAt);

/// <summary>The <c>getCycleProgress</c> response: <c>{ cycleId, progress: [{ relationship, total, submitted }] }</c>
/// — one entry per relationship in the fixed PROGRESS order (self, manager, peer, direct_report), always present
/// (a relationship with no assignments reports <c>total: 0, submitted: 0</c>).</summary>
public sealed record CycleProgressView(string CycleId, IReadOnlyList<CycleProgressRow> Progress);

/// <summary>One per-relationship progress row.</summary>
public sealed record CycleProgressRow(string Relationship, int Total, int Submitted);

/// <summary>A <c>myRaterTasks</c> item — a pending assignment for the caller (as rater) in an open cycle, with the
/// subject's name and the fixed competency set. Never carries the subject's user id.</summary>
public sealed record RaterTaskV1(
    string AssignmentId,
    string CycleId,
    string CycleName,
    string Relationship,
    RaterTaskSubject Subject,
    IReadOnlyList<string> Competencies);

/// <summary>The subject's display name on a rater task (User.firstName/lastName are non-null in the schema).</summary>
public sealed record RaterTaskSubject(string FirstName, string LastName);

/// <summary>
/// The <c>myReport</c> response: <c>{ cycleId, cycleName, buckets }</c>, where <c>buckets</c> is the output of the
/// SHARED pure kernel <see cref="Eval360Aggregate.Aggregate360Report"/> (min-3 suppress-by-omission anonymity) —
/// reused verbatim, never re-ported. A bucket only exists for a relationship that cleared its threshold.
/// </summary>
public sealed record MyReportView(
    string CycleId,
    string CycleName,
    IReadOnlyList<Eval360Aggregate.ReportBucket> Buckets);

/// <summary>A <c>myReportCycles</c> item — a published cycle the caller is a subject of.</summary>
public sealed record ReportCycleV1(
    string CycleId,
    string CycleName,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? PublishedAt);
