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
///
/// Candidate fallback (the 4th principal type): the combined <see cref="ResolveAsync"/> runs staff
/// resolution FIRST and, ONLY when it yields <see cref="StaffResolution.NeedsFallback"/> AND an org
/// context is available, delegates to <see cref="CandidateResolver"/> to resolve a portal candidate
/// by email. The optional <see cref="CandidateResolver"/> is injected by DI; when absent the combined
/// method simply never falls back (staff-only). The staff/candidate boundary is HARD — see §11.
/// </summary>
public sealed class PrincipalResolver(IIdentityRepository identities, CandidateResolver? candidates = null)
{
    private readonly IIdentityRepository _identities = identities;
    private readonly CandidateResolver? _candidates = candidates;

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

    /// <summary>
    /// Combined principal resolution across the staff/candidate boundary. Resolves STAFF first
    /// (keyed on <paramref name="supabaseUserId"/> — the linked `users.supabase_user_id`, honoring
    /// impersonation); if that yields <see cref="StaffResolution.NeedsFallback"/> AND an
    /// <paramref name="organizationId"/> is available AND a <see cref="CandidateResolver"/> is wired,
    /// falls back to resolving a portal <see cref="PrincipalType.Candidate"/> by
    /// <paramref name="email"/> within that org. Returns null (anonymous) when neither matches.
    ///
    /// Security boundary (docs/SECURITY-staff-candidate-auth-linking.md): staff are recognized ONLY
    /// by their linked Supabase id, NEVER by an email-join. A candidate (or cross-tenant row) that
    /// shares a staff user's email is therefore never promoted to staff — its unlinked Supabase id
    /// misses the staff lookup, and the candidate fallback (email+org keyed) yields empty roles,
    /// never staff roles / never <see cref="PrincipalType.PlatformOwner"/>. Conversely a staff session
    /// (linked Supabase id) resolves as staff and the candidate fallback is never reached.
    /// </summary>
    public async Task<TenantContext?> ResolveAsync(
        string supabaseUserId,
        string email,
        string? organizationId,
        string? cookieHeader,
        string? impersonationSecret,
        DateTime now,
        CancellationToken ct)
    {
        var staff = await ResolveStaffAsync(supabaseUserId, cookieHeader, impersonationSecret, now, ct);
        if (staff is { Resolved: true, Context: { } context })
        {
            return context;
        }

        if (_candidates is not null && !string.IsNullOrEmpty(organizationId))
        {
            return await _candidates.ResolveAsync(email, organizationId, ct);
        }

        return null;
    }
}
