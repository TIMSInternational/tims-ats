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
/// Impersonation (WP2.4): a platform owner presenting a VALID HMAC cookie resolves to the TARGET
/// (fetched via <see cref="IIdentityRepository.FindByIdAsync"/>). The owner-only + valid-target
/// gating lives inside <see cref="StaffContextResolver"/>; this resolver only supplies the target.
/// </summary>
public sealed class PrincipalResolver(IIdentityRepository identities)
{
    private readonly IIdentityRepository _identities = identities;

    /// <summary>
    /// Resolves the staff/owner <see cref="TenantContext"/> for a validated Supabase user id,
    /// or <see cref="StaffResolution.NeedsFallback"/> when the caller is not staff. No impersonation.
    /// </summary>
    public Task<StaffResolution> ResolveStaffAsync(string supabaseUserId, CancellationToken ct) =>
        ResolveStaffAsync(supabaseUserId, cookieHeader: null, impersonationSecret: null, now: default, ct);

    /// <summary>
    /// Resolves the staff/owner <see cref="TenantContext"/>, honoring a platform-owner impersonation
    /// cookie. Impersonation is attempted ONLY when the real user is a platform owner AND a secret is
    /// configured AND the cookie carries a valid, unexpired HMAC token; the fetched target is then
    /// handed to <see cref="StaffContextResolver"/>, which enforces the owner-only + valid-target
    /// rule (active, org-scoped, non-owner). Anything else falls through to the owner's own context.
    /// </summary>
    public async Task<StaffResolution> ResolveStaffAsync(
        string supabaseUserId,
        string? cookieHeader,
        string? impersonationSecret,
        DateTime now,
        CancellationToken ct)
    {
        var appUser = await _identities.FindBySupabaseUserIdAsync(supabaseUserId, ct);

        AppUserRow? target = null;
        if (appUser is { IsPlatformOwner: true } && !string.IsNullOrEmpty(impersonationSecret))
        {
            var token = ImpersonationCookie.ReadImpersonationCookie(cookieHeader);
            var nowUnixMs = new DateTimeOffset(now.ToUniversalTime()).ToUnixTimeMilliseconds();
            var payload = ImpersonationCookie.VerifyImpersonationToken(token, impersonationSecret, nowUnixMs);
            if (payload is not null)
            {
                target = await _identities.FindByIdAsync(payload.TargetUserId, ct);
            }
        }

        return StaffContextResolver.ResolveStaffContext(appUser, target);
    }
}
