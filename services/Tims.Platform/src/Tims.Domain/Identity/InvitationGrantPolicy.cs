namespace Tims.Domain.Identity;

/// <summary>
/// Which staff roles a tenant caller may grant by invitation. A caller can never grant a role more
/// privileged than one they hold:
///   • <c>super_admin</c> may grant every assignable staff role (including another super_admin);
///   • <c>hr_admin</c> may grant every assignable staff role EXCEPT <c>super_admin</c>;
///   • any other caller (only reachable if a custom grant gives them <c>user:create</c>) may grant only
///     the non-admin staff roles they themselves hold, plus the default <c>employee</c> role.
/// The result is always a subset of <see cref="RoleSlugs.AssignableStaffRoles"/> in catalogue order, so
/// non-staff principals (<c>external</c>, <c>candidate</c>) and unknown slugs can never be granted.
/// </summary>
public static class InvitationGrantPolicy
{
    public const string SuperAdmin = "super_admin";
    public const string HrAdmin = "hr_admin";

    public static IReadOnlyList<string> GrantableRoles(IEnumerable<string> callerRoles)
    {
        var held = new HashSet<string>(RoleSlugs.FilterStaffRoleSlugs(callerRoles), StringComparer.Ordinal);
        if (held.Contains(SuperAdmin)) return RoleSlugs.AssignableStaffRoles;
        if (held.Contains(HrAdmin))
            return RoleSlugs.AssignableStaffRoles.Where(role => role != SuperAdmin).ToList();
        held.Add(RoleSlugs.DefaultStaffRole);
        return RoleSlugs.AssignableStaffRoles.Where(held.Contains).ToList();
    }

    public static bool CanGrant(IEnumerable<string> callerRoles, string role) =>
        GrantableRoles(callerRoles).Contains(role, StringComparer.Ordinal);
}
