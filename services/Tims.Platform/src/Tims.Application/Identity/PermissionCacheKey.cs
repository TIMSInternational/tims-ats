namespace Tims.Application.Identity;

/// <summary>
/// Builds the permission cache key, byte-for-byte identical to the TS kernel
/// (packages/api/src/access/build.ts):
/// <c>tims:access:{orgId}:{roles sorted ascending, comma-joined}:{module}:{action}</c>.
/// Both stacks MUST agree so a C# and a TS process share the same Redis entries (WP2.5
/// "same Redis keys"). The role sort mirrors JS <c>[...roles].sort()</c> — UTF-16 code-unit
/// order, which is <see cref="StringComparer.Ordinal"/> for the ASCII role slugs.
/// </summary>
public static class PermissionCacheKey
{
    public static string Build(string orgId, IReadOnlyList<string> roles, string module, string action)
    {
        var sortedRoles = string.Join(",", roles.OrderBy(r => r, StringComparer.Ordinal));
        return $"tims:access:{orgId}:{sortedRoles}:{module}:{action}";
    }
}
