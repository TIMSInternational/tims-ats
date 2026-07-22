namespace Tims.Infrastructure.Succession;

/// <summary>
/// Minimal read-only EF entities for the succession READ surface. Only the columns the nine reads touch are
/// mapped (never full HR rows). All are Prisma-OWNED (efcoreReadOnly); EF SELECTs only (AsNoTracking,
/// SaveChanges never called). No native enums here (readiness/criticality/type/quadrant are plain Strings),
/// so the context needs no NpgsqlDataSource with EnableUnmappedTypes. Prisma <c>timestamp(3)</c> columns are
/// read as Unspecified-kind wall-clock UTC and re-kinded to UTC in the repository.
/// </summary>
public sealed class CriticalRoleReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? PositionId { get; set; }
    public Guid? CurrentHolderId { get; set; }
    public Guid? CompanyId { get; set; }
    public Guid? UnitId { get; set; }
    public string Criticality { get; set; } = string.Empty;
    public double? FlightRisk { get; set; }
    public string? TargetBandLevel { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class SuccessorReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid CriticalRoleId { get; set; }
    public Guid UserId { get; set; }
    public string Readiness { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string? DevelopmentPlan { get; set; }
    public Guid? AddedById { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>users columns the holder / successor-user / addedByUser selects need.</summary>
public sealed class SuccessionUserReadEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Avatar { get; set; }
    public string? JobTitle { get; set; }
    public string Email { get; set; } = string.Empty;
}

/// <summary>salary_bands — only level + midSalary for the comp-gap soft level match.</summary>
public sealed class SalaryBandReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Level { get; set; } = string.Empty;
    public double MidSalary { get; set; }
}

/// <summary>employee_compensations — the restricted salary fields are read ONLY when selectFor entitles them
/// (the repo omits the column from the SELECT otherwise; see SuccessionReadRepository).</summary>
public sealed class EmployeeCompensationReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public double CurrentSalary { get; set; }
    public string Currency { get; set; } = string.Empty;
}

/// <summary>nine_box_evaluations — the suggested-successors ranking input (+ evaluatedAt/createdAt order).</summary>
public sealed class NineBoxEvaluationReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public string Quadrant { get; set; } = string.Empty;
    public double PotentialScore { get; set; }
    public double PerformanceScore { get; set; }
    public DateTime EvaluatedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}
