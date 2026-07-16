namespace Tims.Domain.Hris;

/// <summary>
/// The canonical TARGET field names of <see cref="ExternalEmployee"/> that a <see cref="FieldMap"/>
/// keys on. <see cref="ExternalEmployee.ExternalId"/> is deliberately absent: it is carried by
/// <see cref="HrisSourceEmployee.ExternalId"/> directly (the record's identity), never mapped from a
/// bag field.
/// </summary>
public static class ExternalEmployeeFields
{
    public const string FirstName = "firstName";
    public const string LastName = "lastName";
    public const string WorkEmail = "workEmail";
    public const string JobTitle = "jobTitle";
    public const string Department = "department";
    public const string Division = "division";
    public const string HireDate = "hireDate";
    public const string EmploymentStatus = "employmentStatus";
    public const string SupervisorExternalId = "supervisorExternalId";
}

/// <summary>
/// A data-driven mapping of a canonical TARGET field (<see cref="ExternalEmployeeFields"/>) to the
/// SOURCE key it is read from in a <see cref="HrisSourceEmployee.Fields"/> bag. Immutable — the
/// per-connector <c>hris_connectors.field_map</c> jsonb override (Sprint-1.8) will build a
/// <see cref="FieldMap"/> instance the same way the wired <see cref="BambooHrFieldMap.Default"/>
/// constant does, so refining which source field feeds a target never touches
/// <see cref="BambooHrEmployeeMapper"/>.
/// </summary>
public sealed class FieldMap
{
    private readonly IReadOnlyDictionary<string, string> _targetToSource;

    public FieldMap(IReadOnlyDictionary<string, string> targetToSource)
    {
        ArgumentNullException.ThrowIfNull(targetToSource);
        // Defensive copy so a caller can't mutate the map out from under us after construction.
        _targetToSource = new Dictionary<string, string>(targetToSource, StringComparer.Ordinal);
    }

    /// <summary>The source bag key a target field reads from, or null when the target is unmapped.</summary>
    public string? SourceKeyFor(string targetField) =>
        _targetToSource.TryGetValue(targetField, out var sourceKey) ? sourceKey : null;
}

/// <summary>
/// The default BambooHR field mapping — TARGET (<see cref="ExternalEmployeeFields"/>) → BambooHR
/// directory/employee source key. This is the baseline a connector uses when a
/// <c>hris_connectors.field_map</c> override is absent.
/// </summary>
public static class BambooHrFieldMap
{
    public static FieldMap Default { get; } = new(new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [ExternalEmployeeFields.FirstName] = "firstName",
        [ExternalEmployeeFields.LastName] = "lastName",
        [ExternalEmployeeFields.WorkEmail] = "workEmail",
        [ExternalEmployeeFields.JobTitle] = "jobTitle",
        [ExternalEmployeeFields.Department] = "department",
        [ExternalEmployeeFields.Division] = "division",
        [ExternalEmployeeFields.HireDate] = "hireDate",
        [ExternalEmployeeFields.EmploymentStatus] = "status",
        [ExternalEmployeeFields.SupervisorExternalId] = "supervisorEId",
    });
}
