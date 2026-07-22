namespace Tims.Application.Evaluation360;

/// <summary>
/// Repository-return rows for the evaluation360 reads — the raw DB projections the use case shapes into the
/// <c>Tims.Domain.Evaluation360</c> wire DTOs. Enum columns are already flattened to their DB label strings by
/// the repository; timestamps are UTC instants. Keeping these small rows here avoids leaking EF entities out of
/// the infrastructure layer.
/// </summary>
public sealed record CycleRow(
    string Id,
    string Name,
    string Status,
    DateTimeOffset? OpensAt,
    DateTimeOffset? ClosesAt,
    DateTimeOffset? PublishedAt,
    DateTimeOffset CreatedAt);

/// <summary>Existence + status probe for the getCycleProgress NOT_FOUND gate (org-scoped).</summary>
public sealed record CycleStatusRow(string Id, string Status);

/// <summary>A per-(relationship, status) assignment count for a cycle — the use case rolls these into the
/// fixed four-relationship progress shape.</summary>
public sealed record ProgressCountRow(string Relationship, string Status, int Count);

/// <summary>A pending rater task row (the subject's user id is NEVER selected — only their display name).</summary>
public sealed record RaterTaskRow(
    string AssignmentId,
    string CycleId,
    string CycleName,
    string Relationship,
    string SubjectFirstName,
    string SubjectLastName);

/// <summary>Existence + name of a published cycle (the myReport gate).</summary>
public sealed record PublishedCycleRow(string Id, string Name);

/// <summary>A published cycle the caller is a subject of (myReportCycles).</summary>
public sealed record ReportCycleRow(string Id, string Name, DateTimeOffset? PublishedAt);
