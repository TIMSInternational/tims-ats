namespace Tims.Infrastructure.Engagement;

/// <summary>
/// Write-side EF entities for the Phase-5 Slice-16 engagement WRITE surface. Prisma-OWNED
/// (<c>efcoreStranglerWrite</c>): EF INSERTs a surveys row (createSurvey) + a survey_responses row
/// (submitSurveyResponse) + an action_plans row (createActionPlan), and UPDATEs surveys (activateSurvey) +
/// action_plans (updateActionPlan), all UNDER TenantScope/RLS — Prisma keeps the DDL. <c>type</c>/<c>status</c> are
/// plain Strings (NOT native enums), so the write context needs no NpgsqlDataSource. The jsonb columns
/// (<c>questions</c>/<c>target_groups</c>/<c>answers</c>/<c>actions</c>) are bound as string with the EF
/// <c>HasColumnType("jsonb")</c> hint (Npgsql sends the string param as jsonb). Prisma DateTime columns are
/// <c>timestamp(3) without time zone</c> (Npgsql Unspecified-kind wall-clock UTC). survey_responses carries the real
/// <c>UNIQUE (survey_id, user_id)</c> (the Prisma <c>@@unique([surveyId, userId])</c>) → the dedup 409. None of the
/// three tables has a <c>deleted_at</c> → NOT soft-deletable.
/// </summary>

/// <summary>surveys — the createSurvey INSERT row + the activateSurvey conditional-update target. Adds the
/// write-only columns the read entity omits: <c>TargetGroups</c> (opaque jsonb) + <c>CreatedById</c>.</summary>
public sealed class SurveyWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;

    /// <summary>Raw jsonb questions array text.</summary>
    public string Questions { get; set; } = "[]";

    /// <summary>Raw jsonb targetGroups object text (nullable — opaque, never validated in-org).</summary>
    public string? TargetGroups { get; set; }
    public DateTime? StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public int ResponseCount { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>survey_responses — the submitSurveyResponse INSERT row. userId = the resolved caller ALWAYS (identity
/// anchor; never an input). The <c>@@unique([surveyId, userId])</c> is enforced by the DB (23505 → CONFLICT).</summary>
public sealed class SurveyResponseWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SurveyId { get; set; }
    public Guid? UserId { get; set; }

    /// <summary>Raw jsonb answers object text.</summary>
    public string Answers { get; set; } = "{}";
    public DateTime SubmittedAt { get; set; }
}

/// <summary>action_plans — the createActionPlan INSERT row + the updateActionPlan partial-update target.</summary>
public sealed class ActionPlanWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid ResponsibleId { get; set; }
    public string? Area { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime? DueDate { get; set; }

    /// <summary>Raw jsonb actions text (nullable — never set by this surface; NULL on create).</summary>
    public string? Actions { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Only id + organizationId — read-only, the authoritative org-membership existence check for the H1
/// backstop on createActionPlan / updateActionPlan(reassign)'s <c>responsibleId</c>. Under TenantScope, RLS already
/// filters to the caller's org; the explicit filter is defense-in-depth.</summary>
public sealed class EngagementUserWriteEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
}
