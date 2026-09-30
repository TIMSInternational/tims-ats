namespace Tims.Domain.OrgStructure;

/// <summary>
/// Pure normalization of org-structure text inputs, shared by every write so the bounds are stated once.
/// Names are trimmed and must be 1..<see cref="OrgStructureLimits.MaxNameLength"/> characters; codes are
/// trimmed, blank means "no code", and must be at most <see cref="OrgStructureLimits.MaxCodeLength"/>.
/// Control characters are rejected in both — they have no place in a label and break CSV/log output.
/// </summary>
public static class OrgStructureInput
{
    public static bool TryNormalizeName(string? raw, out string name)
    {
        name = string.Empty;
        if (raw is null)
        {
            return false;
        }

        var trimmed = raw.Trim();
        if (trimmed.Length is 0 or > OrgStructureLimits.MaxNameLength || trimmed.Any(char.IsControl))
        {
            return false;
        }

        name = trimmed;
        return true;
    }

    public static bool TryNormalizeCode(string? raw, out string? code)
    {
        code = null;
        if (raw is null)
        {
            return true;
        }

        var trimmed = raw.Trim();
        if (trimmed.Length > OrgStructureLimits.MaxCodeLength || trimmed.Any(char.IsControl))
        {
            return false;
        }

        code = trimmed.Length == 0 ? null : trimmed;
        return true;
    }

    /// <summary>"First Last" with the stray whitespace of a missing half removed.</summary>
    public static string FullName(string firstName, string lastName) => $"{firstName} {lastName}".Trim();
}
