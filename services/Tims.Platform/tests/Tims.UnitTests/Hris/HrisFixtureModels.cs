namespace Tims.UnitTests.Hris;

// DTOs mirroring the HRIS mapper golden fixtures (contracts/hris-fixtures/*.json). Deserialized
// case-insensitively (see Fixtures.Fx.Options).

internal sealed record HrisMapperRoot(string Description, List<HrisMapperCase> Cases);

internal sealed record HrisMapperCase(
    string Name,
    HrisSourceEmployeeDto Source,
    // null → the case uses BambooHrFieldMap.Default; otherwise a target-field → source-key override.
    Dictionary<string, string>? FieldMap,
    ExternalEmployeeDto Expected);

internal sealed record HrisSourceEmployeeDto(
    string ExternalId,
    Dictionary<string, string?> Fields);

internal sealed record ExternalEmployeeDto(
    string ExternalId,
    string FirstName,
    string LastName,
    string? WorkEmail,
    string? JobTitle,
    string? Department,
    string? Division,
    // Wire form "yyyy-MM-dd" or null (compared against the mapped DateOnly?).
    string? HireDate,
    string? EmploymentStatus,
    string? SupervisorExternalId);
