namespace Tims.Domain.Hris;

/// <summary>
/// The provider-agnostic mapped shape of one employee record pulled from an HRIS source (the output
/// of the per-provider mapper built in Slice 2). Pure value type — no persistence concerns; the
/// Infrastructure <c>HrisExternalEmployeeEntity</c> is the row it upserts into
/// <c>hris_external_employees</c>.
///
/// PII discipline: <see cref="FirstName"/>/<see cref="LastName"/>/<see cref="WorkEmail"/> are personal
/// data — later slices audit reads of the persisted rows (this slice only defines the schema).
/// </summary>
public sealed record ExternalEmployee(
    string ExternalId,
    string FirstName,
    string LastName,
    string? WorkEmail,
    string? JobTitle,
    string? Department,
    string? Division,
    DateOnly? HireDate,
    string? EmploymentStatus,
    string? SupervisorExternalId);
