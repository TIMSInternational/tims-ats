using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Evaluation360;

/// <summary>
/// Write-side models for the Phase-5 Slice 13 evaluation360 WRITE surface — faithful ports of the inputs/outputs of
/// the 6 mutation bodies of the TS <c>evaluation360</c> router (createCycle/openCycle/closeCycle/publishCycle/
/// assignRaters + submitRatings). The relationship + competency values cross as their DB-label strings (the write
/// context maps them to the native Prisma enums).
/// </summary>

/// <summary>The valid <c>RaterRelationship</c> DB labels (packages/shared RATER_RELATIONSHIPS) — the endpoint bounds
/// each assignRaters <c>relationship</c> to this set, and the repo casts the label to the native enum.</summary>
public static class Eval360Relationships
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        "self", "manager", "peer", "direct_report",
    };

    public static bool IsValid(string? relationship) => relationship is not null && All.Contains(relationship);
}

/// <summary>One validated assignRaters assignment (subject × rater × relationship). <see cref="Relationship"/> is a
/// valid <see cref="Eval360Relationships"/> DB label.</summary>
public sealed record RaterAssignmentInput(Guid SubjectUserId, Guid RaterUserId, string Relationship);

/// <summary>One validated submitRatings response (Zod ratingInput): a distinct competency (∈ EVAL360_COMPETENCIES),
/// an integer rating 1..5, and an optional comment ≤5000.</summary>
public sealed record RatingSubmissionInput(string CompetencyKey, int Rating, string? Comment);

/// <summary>
/// The createCycle response — the TS <c>service.createCycle</c> returns the repo select
/// <c>{ id, name, status, createdAt }</c> verbatim. <see cref="Status"/> is the DB enum label ('draft'); the date
/// serializes as a Node-ISO string (<c>…fffZ</c>, matching Node's <c>Date.toISOString()</c>).
/// </summary>
public sealed record CreateCycleResult(
    string Id,
    string Name,
    string Status,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset CreatedAt);

/// <summary>A guarded status transition result: whether the conditional update matched (count &gt; 0) and the target
/// status ('open'|'closed'|'published'). <see cref="Transitioned"/> false ⇒ the endpoint maps to 409 (illegal
/// transition — absent, wrong org, or not in the expected current state).</summary>
public sealed record CycleTransitionResult(bool Transitioned, string Status);

/// <summary>The raw repository result of assignRaters (matches the TS repo return). <see cref="CycleNotOpen"/> ⇒ the
/// cycle is absent/wrong-org/not in ['draft','open']; <see cref="MissingUserIds"/> are cross-org/nonexistent ids;
/// <see cref="Created"/> is the skipDuplicates-adjusted inserted count.</summary>
public sealed record AssignRatersDbResult(bool CycleNotOpen, IReadOnlyList<string> MissingUserIds, int Created);

/// <summary>The use-case outcome of assignRaters.</summary>
public enum AssignRatersOutcome
{
    /// <summary>The cycle is not in ['draft','open'] (absent / wrong org / closed / published) → 409.</summary>
    CycleNotOpen,

    /// <summary>One or more subject/rater ids are cross-org or nonexistent → 400.</summary>
    MissingUsers,

    /// <summary>The assignments were created (skipDuplicates count) → 200 { created }.</summary>
    Created,
}

/// <summary>Result of an assignRaters attempt: the outcome + (when Created) the inserted count.</summary>
public sealed record AssignRatersResult(AssignRatersOutcome Outcome, int Created);

/// <summary>The use-case outcome of submitRatings.</summary>
public enum SubmitRatingsOutcome
{
    /// <summary>No assignment for this (id, org, raterUserId=caller) — the ownership pre-fetch was null → 404.</summary>
    NotFound,

    /// <summary>The atomic claim matched 0 rows (already submitted or the cycle is not open) → 409.</summary>
    Conflict,

    /// <summary>The claim + the 6 rater_responses committed → 200 { assignmentId, status:'submitted' }.</summary>
    Submitted,
}

/// <summary>Result of a submitRatings attempt.</summary>
public sealed record SubmitRatingsResult(SubmitRatingsOutcome Outcome);
