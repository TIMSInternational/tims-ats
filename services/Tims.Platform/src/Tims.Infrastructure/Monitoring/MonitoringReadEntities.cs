namespace Tims.Infrastructure.Monitoring;

/// <summary>
/// Minimal read-only EF entities for the monitoring READ surface (Phase-5 Q0b slice 1, issue #100).
/// Only the columns the six reads touch are mapped — never a full HR row. Every table here is
/// Prisma-OWNED (efcoreReadOnly / efcoreStranglerWrite in docs/architecture/table-ownership.md); this
/// context SELECTs only (AsNoTracking, SaveChanges never called).
///
/// All <c>DateTime</c>s are the Prisma <c>timestamp(3) without time zone</c> columns, read by Npgsql
/// as Unspecified-kind wall-clock UTC and reinterpreted at the repository boundary.
/// </summary>
public sealed class MonitoringAlertReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Module { get; set; } = string.Empty;
    public string Severity { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public sealed class MonitoringAlertRuleReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Module { get; set; } = string.Empty;

    /// <summary>Raw jsonb condition text (`{ metric, operator, threshold }`), passed through unchanged.</summary>
    public string Condition { get; set; } = "{}";
    public string Severity { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public bool IsActive { get; set; }
}

public sealed class MonitoringActionPlanReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid ResponsibleId { get; set; }
    public string? Area { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime? DueDate { get; set; }
}

/// <summary>Only the columns the responsible-user select and the headcount count need.</summary>
public sealed class MonitoringUserReadEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Avatar { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>Minimal vacancy row — only what the <c>activeVacancies</c> KPI count filters on.</summary>
public sealed class MonitoringVacancyReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime? DeletedAt { get; set; }
}

/// <summary>Minimal salary-adjustment row — only what the (k-anon floored) pending count filters on.</summary>
public sealed class MonitoringSalaryAdjustmentReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Status { get; set; } = string.Empty;
}

/// <summary>Minimal survey row — only what the <c>activeSurveys</c> KPI count filters on.</summary>
public sealed class MonitoringSurveyReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Status { get; set; } = string.Empty;
}

/// <summary>Minimal survey-response row — only what the engagement trend buckets on. NEVER the answers.</summary>
public sealed class MonitoringSurveyResponseReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public DateTime SubmittedAt { get; set; }
}
