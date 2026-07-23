namespace Tims.Infrastructure.Compensation;

/// <summary>
/// Minimal read-only EF entities for the FX-free compensation READ surface (Phase-5 Slice 9). Only the
/// columns the ported reads touch are mapped (never full HR rows). All are Prisma-OWNED (efcoreReadOnly); EF
/// SELECTs only (AsNoTracking, SaveChanges never called). No native enums here (salary_adjustments.type/.status
/// and benefit_plans.type are plain Prisma Strings), so the context needs no NpgsqlDataSource with
/// EnableUnmappedTypes. Prisma <c>timestamp(3)</c> columns are read as Unspecified-kind wall-clock UTC and
/// re-kinded to UTC in the repository.
///
/// The field-authed reads (listPendingAdjustments over salary_adjustments; getEmployeeComp/myCompensation over
/// employee_compensations + salary_bands) build their SELECT column list dynamically from selectFor via raw
/// parameterized SQL on this context's connection (never select-then-null), so they are NOT modeled as EF
/// entities here — only the plain aggregate/catalog reads are.
/// </summary>

/// <summary>salary_bands — the full row for getSalaryBands + the projection for getMarketComparison.</summary>
public sealed class SalaryBandCompReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Level { get; set; } = string.Empty;
    public string? Title { get; set; }
    public double MinSalary { get; set; }
    public double MidSalary { get; set; }
    public double MaxSalary { get; set; }
    public string Currency { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>employee_compensations — currentSalary + compaRatio for the compa-ratio distribution (read #4);
/// Slice 11c adds currency/variablePay/bandId for the FX aggregate reads (band-distribution / pay-equity /
/// total-comp / dashboard-KPI).</summary>
public sealed class EmployeeCompensationCompReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public double CurrentSalary { get; set; }
    public double? CompaRatio { get; set; }
    public string Currency { get; set; } = string.Empty;
    public double? VariablePay { get; set; }
    public Guid? BandId { get; set; }
}

/// <summary>companies — the org display currency (earliest createdAt) for the FX aggregate reads (Slice 11c).</summary>
public sealed class CompanyCompReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string? Currency { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>benefit_plans — id/name/type for the benefits utilization rollup (read #3).</summary>
public sealed class BenefitPlanCompReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
}

/// <summary>benefit_enrollments — the per-plan enrollment count for the utilization rollup (read #3).</summary>
public sealed class BenefitEnrollmentCompReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid BenefitPlanId { get; set; }
}

/// <summary>users — the active-headcount denominator for the utilization rollup (read #3).</summary>
public sealed class CompensationUserReadEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public bool IsActive { get; set; }
}
