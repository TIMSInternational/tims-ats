using Tims.Domain.Identity;

namespace Tims.Application.Identity;

/// <summary>
/// Resolves the FOURTH principal type (architecture §3): a portal Supabase session with NO staff
/// <see cref="AppUserRow"/> that maps to a <see cref="PrincipalType.Candidate"/> by email within a
/// known org. Use-case port of the TS candidateProcedure flow (trpc.ts <c>isCandidate</c> +
/// services/candidate-portal.service.ts): the org is resolved by the caller (portal slug), then the
/// candidate is looked up by the SESSION email — never a client-supplied identifier.
///
/// §11 invariant — the candidate/staff boundary is HARD: the resulting <see cref="TenantContext"/>
/// always carries EMPTY roles and is NEVER a platform owner. A candidate can therefore never reach
/// the staff permission path. Staff resolution runs FIRST (see <see cref="PrincipalResolver"/>);
/// this resolver is the FALLBACK, invoked only when staff resolution yields
/// <see cref="StaffResolution.NeedsFallback"/> AND an org context is available.
/// </summary>
public sealed class CandidateResolver(ICandidateRepository candidates)
{
    private readonly ICandidateRepository _candidates = candidates;

    /// <summary>
    /// Resolves the candidate <see cref="TenantContext"/> for a session email within
    /// <paramref name="organizationId"/> (REQUIRED — supplied by the request/portal slug, not the
    /// JWT), or null (anonymous) when no ACTIVE, non-deleted candidate matches. Roles are ALWAYS
    /// empty; the principal type is ALWAYS <see cref="PrincipalType.Candidate"/> — never staff, never
    /// <see cref="PrincipalType.PlatformOwner"/>.
    /// </summary>
    public async Task<TenantContext?> ResolveAsync(string email, string organizationId, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(organizationId))
        {
            return null;
        }

        var candidate = await _candidates.FindByEmailAsync(email, organizationId, ct);
        if (candidate is null)
        {
            return null;
        }

        return new TenantContext(
            PrincipalType: PrincipalType.Candidate,
            OrganizationId: candidate.OrganizationId,
            UserId: candidate.Id,
            Roles: Array.Empty<string>());
    }
}
