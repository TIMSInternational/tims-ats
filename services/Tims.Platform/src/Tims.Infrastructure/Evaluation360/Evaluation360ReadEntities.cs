namespace Tims.Infrastructure.Evaluation360;

/// <summary>
/// Minimal read-only EF entities for the evaluation360 read surface. Only the columns the five reads touch are
/// mapped (never full rows). All are Prisma-OWNED (efcoreReadOnly); EF SELECTs only. The status/relationship
/// columns are the NATIVE Prisma enums, mapped to the CLR enums in <see cref="Evaluation360Enums"/>.
///
/// SECURITY: <see cref="RaterResponseReadEntity"/> deliberately does NOT map a rater's user id, and neither does
/// <see cref="RaterAssignmentReadEntity"/> expose it on any report path — a rater's identity must never flow into
/// the aggregator (peer/direct_report anonymity). <c>RaterUserId</c> IS mapped only so the self-service
/// <c>myRaterTasks</c> query can HARD-FILTER on the CALLER's own id.
/// </summary>
public sealed class ReviewCycleReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public ReviewCycleStatusPg Status { get; set; }
    public DateTime? OpensAt { get; set; }
    public DateTime? ClosesAt { get; set; }
    public DateTime? PublishedAt { get; set; }
    public DateTime CreatedAt { get; set; }

    public ICollection<RaterAssignmentReadEntity> Assignments { get; set; } = new List<RaterAssignmentReadEntity>();
}

public sealed class RaterAssignmentReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid CycleId { get; set; }
    public Guid SubjectUserId { get; set; }
    public Guid RaterUserId { get; set; }
    public RaterRelationshipPg Relationship { get; set; }
    public RaterAssignmentStatusPg Status { get; set; }

    public ReviewCycleReadEntity Cycle { get; set; } = null!;
    public UserReadEntity Subject { get; set; } = null!;
    public ICollection<RaterResponseReadEntity> Responses { get; set; } = new List<RaterResponseReadEntity>();
}

public sealed class RaterResponseReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid AssignmentId { get; set; }
    public string CompetencyKey { get; set; } = string.Empty;
    public int Rating { get; set; }
    public string? Comment { get; set; }

    public RaterAssignmentReadEntity Assignment { get; set; } = null!;
}

/// <summary>Only the subject-name columns myRaterTasks needs (User.firstName/lastName are non-null in the schema).</summary>
public sealed class UserReadEntity
{
    public Guid Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
}
