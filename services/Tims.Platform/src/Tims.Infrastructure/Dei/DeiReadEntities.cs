namespace Tims.Infrastructure.Dei;

/// <summary>
/// Minimal read-only EF entities for the DEI read surface (Phase-5 Slice 11b). Only the columns the 10 reads touch
/// are mapped (never full rows — self-ID demographics never leave the DB per record). All are Prisma-OWNED
/// (efcoreReadOnly); EF SELECTs only. The gender/ethnicity/disability_status columns are the NATIVE Prisma enums,
/// mapped to the CLR enums in <see cref="DeiEnums"/>; <c>nationality</c> is a plain String; <c>date_of_birth</c> is
/// a <c>date</c> (read as DateOnly, bucketed server-side, never returned raw).
/// </summary>
public sealed class DeiDemographicsReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public GenderPg Gender { get; set; }
    public EthnicityPg Ethnicity { get; set; }
    public DisabilityStatusPg DisabilityStatus { get; set; }
    public string? Nationality { get; set; }
    public DateOnly? DateOfBirth { get; set; }
}

/// <summary>users — the active head-count (getDashboardKpis) + the demographics ⋈ user_roles ⋈ roles anchor.</summary>
public sealed class DeiUserReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public bool IsActive { get; set; }
}

/// <summary>user_roles — the leadership join (no organization_id column; RLS via EXISTS roles in prod).</summary>
public sealed class DeiUserRoleReadEntity
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid RoleId { get; set; }
}

/// <summary>roles — the LEADERSHIP_SLUGS membership test (org-scoped, RLS org policy in prod).</summary>
public sealed class DeiRoleReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Slug { get; set; } = string.Empty;
}

/// <summary>candidates — getHiringFunnel count (createdAt window).</summary>
public sealed class DeiCandidateReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>salary_adjustments — getPromotionEquity count (type='promotion', effectiveDate window). type is a
/// plain String (NOT a native enum).</summary>
public sealed class DeiSalaryAdjustmentReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Type { get; set; } = string.Empty;
    public DateTime? EffectiveDate { get; set; }
}

/// <summary>surveys — getInclusionIndex (type='climate'); questions is jsonb read as raw JSON text.</summary>
public sealed class DeiSurveyReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Type { get; set; } = string.Empty;
    public string? Questions { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>survey_responses — getInclusionIndex answers-only (never userId or other response columns).</summary>
public sealed class DeiSurveyResponseReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SurveyId { get; set; }
    public string? Answers { get; set; }
}
