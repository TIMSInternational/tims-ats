namespace Tims.Infrastructure.ExternalVendor;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED <c>assessment_results</c> table (efcoreReadOnly in
/// docs/architecture/table-ownership.md). Maps ONLY the external classification ceiling — the six scored
/// fields (all visible to <c>external</c>) + the anchors + <c>scored_at</c> — and NEVER a non-ceiling
/// sensitive column. Opaque psychometric JSON (<c>breakdown</c>, <c>interpretation</c>) is read as the
/// raw jsonb text (parsed to a JsonNode client-side). Never written: every query is <c>AsNoTracking()</c>
/// and <c>SaveChanges</c> is never called. Run UNDER <c>TenantScope</c> (app_tenant + org GUC) so RLS
/// isolates the org.
/// </summary>
public sealed class ExternalAssessmentResultReadEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid AssignmentId { get; set; }

    public double? RawScore { get; set; }

    public double? NormalizedScore { get; set; }

    public double? Percentile { get; set; }

    public string? Breakdown { get; set; }

    public string? Interpretation { get; set; }

    public string? ModelVersion { get; set; }

    public DateTime ScoredAt { get; set; }

    public ExternalAssessmentAssignmentReadEntity Assignment { get; set; } = null!;
}

/// <summary>
/// READ-ONLY mapping of <c>assessment_assignments</c> (lifecycle + identity context the v1 shape needs).
/// Assignment rows are not classification-sensitive; these are plain anchors. The required to-one
/// <c>assessment_type</c> supplies the type name.
/// </summary>
public sealed class ExternalAssessmentAssignmentReadEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid CandidateId { get; set; }

    public Guid VacancyId { get; set; }

    public Guid AssessmentTypeId { get; set; }

    public string Status { get; set; } = string.Empty;

    public DateTime AssignedAt { get; set; }

    public DateTime? StartedAt { get; set; }

    public DateTime? CompletedAt { get; set; }

    public DateTime? ExpiresAt { get; set; }

    public ExternalAssessmentTypeReadEntity AssessmentType { get; set; } = null!;
}

/// <summary>READ-ONLY mapping of <c>assessment_types</c> (only id, org, name for the v1 label).</summary>
public sealed class ExternalAssessmentTypeReadEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Name { get; set; } = string.Empty;
}
