namespace Tims.Domain.Access;

/// <summary>
/// The scope lattice, ported 1:1 from packages/api/src/access/types.ts +
/// resolve.ts. Ladder order (narrowest → widest) is
/// own &lt; team &lt; unit &lt; company &lt; organization. The enum's integer values
/// ARE the ladder indices, so "widest wins" is a plain Max over the enum.
///
/// Scopes cross the DB-string boundary as snake_case strings ('own', 'team', …);
/// <see cref="TryParse"/> / <see cref="IsAccessScope"/> mirror the TS
/// <c>isAccessScope</c> type guard so an unknown/legacy string is rejected rather
/// than trusted ("never trust DB strings", build.ts).
/// </summary>
public enum AccessScope
{
    Own = 0,
    Team = 1,
    Unit = 2,
    Company = 3,
    Organization = 4,
}

public static class AccessScopes
{
    /// <summary>Ladder order, matching SCOPE_LADDER in types.ts exactly.</summary>
    public static readonly IReadOnlyList<AccessScope> Ladder = new[]
    {
        AccessScope.Own,
        AccessScope.Team,
        AccessScope.Unit,
        AccessScope.Company,
        AccessScope.Organization,
    };

    /// <summary>The wire/DB string form (snake_case), matching the TS union values.</summary>
    public static string ToWire(this AccessScope scope) => scope switch
    {
        AccessScope.Own => "own",
        AccessScope.Team => "team",
        AccessScope.Unit => "unit",
        AccessScope.Company => "company",
        AccessScope.Organization => "organization",
        _ => throw new ArgumentOutOfRangeException(nameof(scope), scope, "Unknown AccessScope"),
    };

    /// <summary>
    /// Mirrors <c>isAccessScope</c> (types.ts): true only for the five known ladder
    /// values. Anything else (including the legacy 'all') is NOT an access scope.
    /// </summary>
    public static bool IsAccessScope(string? value) => value switch
    {
        "own" or "team" or "unit" or "company" or "organization" => true,
        _ => false,
    };

    public static bool TryParse(string? value, out AccessScope scope)
    {
        switch (value)
        {
            case "own": scope = AccessScope.Own; return true;
            case "team": scope = AccessScope.Team; return true;
            case "unit": scope = AccessScope.Unit; return true;
            case "company": scope = AccessScope.Company; return true;
            case "organization": scope = AccessScope.Organization; return true;
            default: scope = AccessScope.Own; return false;
        }
    }

    /// <summary>
    /// Ladder max. Empty input floors to the narrowest scope ('own') — matches
    /// <c>widestScope</c> (resolve.ts), whose loop starts at index 0.
    /// </summary>
    public static AccessScope WidestScope(IEnumerable<AccessScope> scopes)
    {
        var widest = AccessScope.Own;
        foreach (var s in scopes)
        {
            if (s > widest) widest = s;
        }
        return widest;
    }
}
