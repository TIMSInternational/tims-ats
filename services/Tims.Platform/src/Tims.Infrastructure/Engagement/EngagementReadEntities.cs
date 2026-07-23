namespace Tims.Infrastructure.Engagement;

/// <summary>
/// Minimal read-only EF entities for the engagement READ surface (Phase-5 Slice 11). Only the columns the 14
/// reads touch are mapped (never full rows beyond the raw-model reads). All are Prisma-OWNED (efcoreReadOnly); EF
/// SELECTs only (AsNoTracking, SaveChanges never called). Timestamps are the Prisma <c>timestamp(3) without time
/// zone</c> columns (Npgsql Unspecified-kind wall-clock UTC), re-kinded to UTC client-side. The jsonb columns
/// (survey questions, response answers, action-plan actions, alert metadata) are read as raw text and parsed by
/// the repository.
/// </summary>
public sealed class SurveyReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;

    /// <summary>Raw jsonb questions array text.</summary>
    public string Questions { get; set; } = "[]";
    public DateTime? StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public int ResponseCount { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class SurveyResponseReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SurveyId { get; set; }
    public Guid? UserId { get; set; }

    /// <summary>Raw jsonb answers object text.</summary>
    public string Answers { get; set; } = "{}";
    public DateTime SubmittedAt { get; set; }
}

public sealed class ActionPlanReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid ResponsibleId { get; set; }
    public string? Area { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime? DueDate { get; set; }

    /// <summary>Raw jsonb actions text (nullable).</summary>
    public string? Actions { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class LeaderCommitmentReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid LeaderId { get; set; }
    public string Description { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime? DueDate { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class AlertReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? RuleId { get; set; }
    public string Module { get; set; } = string.Empty;
    public string Severity { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;

    /// <summary>Raw jsonb metadata text (nullable).</summary>
    public string? Metadata { get; set; }
    public string Status { get; set; } = string.Empty;
    public Guid? DismissedById { get; set; }
    public DateTime? DismissedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>Minimal user row — id/org/name/avatar for the responsible/leader joins; company/business-unit for
/// the getResultsByArea anchors; is_active for the getRotationRisk count.</summary>
public sealed class EngagementUserReadEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Avatar { get; set; }
    public Guid? CompanyId { get; set; }
    public Guid? BusinessUnitId { get; set; }
    public bool IsActive { get; set; }
}
