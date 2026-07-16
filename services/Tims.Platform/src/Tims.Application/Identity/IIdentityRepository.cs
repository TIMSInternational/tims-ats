using Tims.Domain.Identity;

namespace Tims.Application.Identity;

/// <summary>
/// Read-only port over the Prisma-OWNED identity tables (`users`, `user_roles`, `roles`;
/// see docs/architecture/table-ownership.md → efcoreReadOnly). Implemented in
/// Tims.Infrastructure by an EF Core context that NEVER writes these rows. The privileged,
/// pre-tenant lookup that resolves WHICH org a Supabase user belongs to — it runs before any
/// tenant context exists, so it does not go through the RLS <c>TenantScope</c>.
/// </summary>
public interface IIdentityRepository
{
    /// <summary>
    /// Loads the staff <see cref="AppUserRow"/> for a validated JWT's Supabase user id
    /// (`users.supabase_user_id`, unique), with its raw <c>roles.slug</c> list (unfiltered —
    /// <see cref="StaffContextResolver"/> applies <see cref="RoleSlugs.FilterStaffRoleSlugs"/>).
    /// Returns null when no such user exists.
    /// </summary>
    Task<AppUserRow?> FindBySupabaseUserIdAsync(string supabaseUserId, CancellationToken ct);

    /// <summary>
    /// Loads the staff <see cref="AppUserRow"/> by TIMS `users.id`. Used by the impersonation
    /// slice to fetch the target; returns null when the id is not a known user.
    /// </summary>
    Task<AppUserRow?> FindByIdAsync(string userId, CancellationToken ct);
}
