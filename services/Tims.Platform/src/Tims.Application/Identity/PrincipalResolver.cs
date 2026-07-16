using Tims.Domain.Identity;

namespace Tims.Application.Identity;

/// <summary>
/// Orchestrates staff resolution: fetch the TIMS <see cref="AppUserRow"/> for a Supabase user id
/// (IO, via <see cref="IIdentityRepository"/>), then hand it to the pure
/// <see cref="StaffContextResolver"/> to decide the <see cref="TenantContext"/>. This is the
/// use-case port of resolveStaffContext (apps/web/lib/auth/staff-context.ts) minus the write-side
/// first-login owner auto-create and the fire-and-forget lastLogin — a missing/inactive/
/// unprovisioned user simply yields <see cref="StaffResolution.NeedsFallback"/>.
///
/// Impersonation is a later slice: the target is passed as null for now, so no impersonated
/// context is ever produced here.
/// </summary>
public sealed class PrincipalResolver(IIdentityRepository identities)
{
    private readonly IIdentityRepository _identities = identities;

    /// <summary>
    /// Resolves the staff/owner <see cref="TenantContext"/> for a validated Supabase user id,
    /// or <see cref="StaffResolution.NeedsFallback"/> when the caller is not staff.
    /// </summary>
    public async Task<StaffResolution> ResolveStaffAsync(string supabaseUserId, CancellationToken ct)
    {
        var appUser = await _identities.FindBySupabaseUserIdAsync(supabaseUserId, ct);
        return StaffContextResolver.ResolveStaffContext(appUser, impersonationTarget: null);
    }
}
