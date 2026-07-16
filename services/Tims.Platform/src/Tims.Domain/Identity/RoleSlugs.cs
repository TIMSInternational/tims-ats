namespace Tims.Domain.Identity;

/// <summary>
/// Ported from packages/shared/src/types/roles.ts. The roles a human STAFF user may hold —
/// excludes the non-User principals `external` (API-key integrations) and `candidate` (portal
/// magic-link, no staff row). <see cref="FilterStaffRoleSlugs"/> drops those at session
/// construction (defense-in-depth: a drifted UserRole row for a non-User principal can never
/// grant staff access), preserving order.
/// </summary>
public static class RoleSlugs
{
    public static readonly IReadOnlyList<string> AssignableStaffRoles = new[]
    {
        "super_admin", "hr_admin", "hrbp", "recruiter", "leader", "committee", "employee",
    };

    private static readonly HashSet<string> AssignableStaffRoleSet =
        new(AssignableStaffRoles, StringComparer.Ordinal);

    public static IReadOnlyList<string> FilterStaffRoleSlugs(IEnumerable<string> slugs) =>
        slugs.Where(AssignableStaffRoleSet.Contains).ToList();
}
