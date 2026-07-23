namespace Tims.Infrastructure.Evaluation360;

/// <summary>
/// Write-side EF entities for the Phase-5 Slice 13 evaluation360 WRITE surface. Prisma-OWNED
/// (<c>efcoreStranglerWrite</c>): EF INSERTs a review_cycles row (createCycle) + rater_responses rows (submitRatings)
/// and issues guarded conditional UPDATEs on review_cycles (the transitions) + rater_assignments (the submit claim),
/// all UNDER TenantScope/RLS — Prisma keeps the DDL. <c>status</c>/<c>relationship</c> are the NATIVE Prisma enums
/// (mapped via <see cref="Evaluation360WriteDataSourceHolder"/> — the same CLR enums in
/// <see cref="Evaluation360Enums"/> the read surface uses). Prisma DateTime columns are <c>timestamp(3) without time
/// zone</c> (Npgsql Unspecified-kind wall-clock UTC).
/// </summary>

/// <summary>review_cycles — the createCycle INSERT row + the transition (open/close/publish) conditional-update target.</summary>
public sealed class ReviewCycleWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public ReviewCycleStatusPg Status { get; set; }
    public DateTime? OpensAt { get; set; }
    public DateTime? ClosesAt { get; set; }
    public DateTime? PublishedAt { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>rater_assignments — the submitRatings claim conditional-update target + the assignRaters unique key. The
/// insert path (assignRaters) uses a raw ON CONFLICT statement, so this entity is used only for the guarded claim.</summary>
public sealed class RaterAssignmentWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid CycleId { get; set; }
    public Guid SubjectUserId { get; set; }
    public Guid RaterUserId { get; set; }
    public RaterRelationshipPg Relationship { get; set; }
    public RaterAssignmentStatusPg Status { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>rater_responses — the submitRatings INSERT rows (one per competency).</summary>
public sealed class RaterResponseWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid AssignmentId { get; set; }
    public string CompetencyKey { get; set; } = string.Empty;
    public int Rating { get; set; }
    public string? Comment { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Only the columns the assignRaters org-membership validation needs (users.id in the org).</summary>
public sealed class UserWriteEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
}
