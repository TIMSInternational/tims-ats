namespace Tims.Infrastructure.Hris;

/// <summary>
/// EF-OWNED row for <c>hris_external_employees</c> (docs/architecture/table-ownership.md <c>efcore</c>):
/// the persisted, mapped shape of one source employee, upserted on the unique key
/// (organization_id, connector_id, external_id). Org-scoped → RLS-protected.
///
/// PII: <see cref="FirstName"/>/<see cref="LastName"/>/<see cref="WorkEmail"/> are personal data. Rows
/// absent from the source are soft-marked via <see cref="IsDeletedInSource"/> (never hard-deleted);
/// <see cref="SourceHash"/> lets an unchanged record be skipped (idempotent no-op).
/// </summary>
public sealed class HrisExternalEmployeeEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid ConnectorId { get; set; }

    public string ExternalId { get; set; } = string.Empty;

    public string FirstName { get; set; } = string.Empty;

    public string LastName { get; set; } = string.Empty;

    public string? WorkEmail { get; set; }

    public string? JobTitle { get; set; }

    public string? Department { get; set; }

    public string? Division { get; set; }

    public DateOnly? HireDate { get; set; }

    public string? EmploymentStatus { get; set; }

    public string? SupervisorExternalId { get; set; }

    /// <summary>Raw jsonb snapshot of the source record — re-map without re-pulling.</summary>
    public string RawPayload { get; set; } = "{}";

    public string SourceHash { get; set; } = string.Empty;

    public bool IsDeletedInSource { get; set; }

    public DateTime FirstSeenAt { get; set; }

    public DateTime LastSyncedAt { get; set; }

    public Guid? LastSyncRunId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
