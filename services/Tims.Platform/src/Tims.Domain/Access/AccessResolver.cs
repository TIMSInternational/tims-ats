namespace Tims.Domain.Access;

/// <summary>
/// Ported 1:1 from packages/api/src/access/resolve.ts.
///
/// Deny-by-default. Stacking = union: the widest scope wins, and every contributing
/// role is carried. A grant whose scope string is not a valid access scope
/// (<c>IsAccessScope</c>) is dropped — the same "never trust DB strings" guard the TS
/// kernel applies after casting DB rows.
/// </summary>
public static class AccessResolver
{
    public static AccessDecision ResolveAccess(IEnumerable<Grant> grants, string module, string action)
    {
        var matching = grants
            .Where(g => AccessScopes.IsAccessScope(g.Scope) && g.Module == module && g.Action == action)
            .ToList();

        if (matching.Count == 0) return AccessDecision.Deny;

        var scopes = matching.Select(g =>
        {
            AccessScopes.TryParse(g.Scope, out var s); // guaranteed by IsAccessScope filter above
            return s;
        });

        // De-dup roles preserving first-seen order (matches [...new Set(...)] in TS).
        var roles = new List<string>();
        var seen = new HashSet<string>();
        foreach (var g in matching)
        {
            if (seen.Add(g.Role)) roles.Add(g.Role);
        }

        return AccessDecision.Allow(AccessScopes.WidestScope(scopes), roles);
    }
}
