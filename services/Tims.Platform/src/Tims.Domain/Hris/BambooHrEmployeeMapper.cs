using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Tims.Domain.Hris;

/// <summary>
/// PURE, static translation of a provider-neutral <see cref="HrisSourceEmployee"/> field-bag into the
/// canonical <see cref="ExternalEmployee"/>, driven entirely by a <see cref="FieldMap"/>. No I/O, no
/// persistence, no framework — fully unit-testable and pinned by the C#-only golden fixtures
/// (<c>contracts/hris-fixtures</c>). Because the mapper reads through the map, Sprint-1.8 refines
/// which source key feeds which target field without editing a line here.
/// </summary>
public static class BambooHrEmployeeMapper
{
    /// <summary>
    /// Maps one source record to an <see cref="ExternalEmployee"/> under <paramref name="fieldMap"/>.
    /// Unmapped or absent source keys become null (or empty string for the two required name fields).
    /// </summary>
    public static ExternalEmployee Map(HrisSourceEmployee source, FieldMap fieldMap)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(fieldMap);

        string? Read(string targetField) =>
            fieldMap.SourceKeyFor(targetField) is { } sourceKey
            && source.Fields.TryGetValue(sourceKey, out var value)
            && !string.IsNullOrWhiteSpace(value)
                ? value
                : null;

        return new ExternalEmployee(
            ExternalId: source.ExternalId,
            // FirstName/LastName are non-nullable on ExternalEmployee; a source missing them
            // degrades to empty rather than throwing (a name-less directory row is still upsertable).
            FirstName: Read(ExternalEmployeeFields.FirstName) ?? string.Empty,
            LastName: Read(ExternalEmployeeFields.LastName) ?? string.Empty,
            WorkEmail: Read(ExternalEmployeeFields.WorkEmail),
            JobTitle: Read(ExternalEmployeeFields.JobTitle),
            Department: Read(ExternalEmployeeFields.Department),
            Division: Read(ExternalEmployeeFields.Division),
            HireDate: ParseHireDate(Read(ExternalEmployeeFields.HireDate)),
            EmploymentStatus: Read(ExternalEmployeeFields.EmploymentStatus),
            SupervisorExternalId: Read(ExternalEmployeeFields.SupervisorExternalId));
    }

    /// <summary>
    /// A DETERMINISTIC content hash of the source record, used to skip re-writing an unchanged
    /// record (idempotent no-op) in a later sync slice. NOT <see cref="object.GetHashCode"/> (which is
    /// randomized per-process): a stable SHA-256 hex over the ExternalId + the source fields sorted by
    /// key, so the same input always hashes identically and any changed/added/removed field changes it.
    /// A null value is encoded distinctly from an empty string so the two never collide.
    /// </summary>
    public static string ComputeSourceHash(HrisSourceEmployee source)
    {
        ArgumentNullException.ThrowIfNull(source);

        var builder = new StringBuilder();
        builder.Append("id=").Append(source.ExternalId).Append('\n');

        foreach (var pair in source.Fields.OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            builder.Append(pair.Key)
                .Append('=')
                // \x00null\x00 is a sentinel that a real value cannot contain, so a present-but-null
                // field is unambiguously distinct from the empty string or an absent key.
                .Append(pair.Value ?? "\x00null\x00")
                .Append('\n');
        }

        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString()));
        return Convert.ToHexStringLower(digest);
    }

    /// <summary>
    /// Parses a BambooHR date string (<c>yyyy-MM-dd</c>). Empty/whitespace and BambooHR's unset
    /// sentinel <c>0000-00-00</c> map to null; an unparseable value maps to null (never throws).
    /// </summary>
    private static DateOnly? ParseHireDate(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || raw == "0000-00-00")
        {
            return null;
        }

        return DateOnly.TryParseExact(raw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : null;
    }
}
