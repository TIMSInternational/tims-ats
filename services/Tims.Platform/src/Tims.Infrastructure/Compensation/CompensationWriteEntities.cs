namespace Tims.Infrastructure.Compensation;

/// <summary>
/// Write-side EF entities for the Phase-5 Slice-12 compensation WRITE surface. Prisma-OWNED
/// (<c>efcoreStranglerWrite</c>): EF INSERTs the salary_adjustment row (createAdjustment) and UPDATEs both tables
/// (approveAdjustment) UNDER TenantScope/RLS — Prisma keeps the DDL. salary_adjustments.type/.status are plain
/// Strings (NOT native enums), so the write context needs no NpgsqlDataSource. Prisma DateTime columns are
/// <c>timestamp(3) without time zone</c> (Npgsql Unspecified-kind wall-clock UTC).
/// </summary>

/// <summary>salary_adjustments — the FULL insert row (createAdjustment) + the conditional-transition target (approve).</summary>
public sealed class SalaryAdjustmentWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public string Type { get; set; } = string.Empty;
    public double PreviousSalary { get; set; }
    public double NewSalary { get; set; }
    public string Currency { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string Status { get; set; } = string.Empty;
    public Guid? ApprovedById { get; set; }
    public DateTime? EffectiveDate { get; set; }
    public Guid RequestedById { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>employee_compensations — the propagation target of an APPROVED adjustment (currentSalary/currency UPDATE).</summary>
public sealed class EmployeeCompensationWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public double CurrentSalary { get; set; }
    public string Currency { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// users — the minimal projection (id + organization_id) for the createAdjustment H1 org-membership backstop:
/// assertSubjectInScope no-ops for organization/company scope, so the target userId must be verified to belong
/// to the caller's org before the INSERT (else a cross-tenant salary_adjustments.userId FK slips past RLS).
/// </summary>
public sealed class CompensationUserWriteEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
}
