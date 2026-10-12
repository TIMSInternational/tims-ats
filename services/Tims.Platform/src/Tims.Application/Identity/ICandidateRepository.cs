using Tims.Domain.Identity;

namespace Tims.Application.Identity;

/// <summary>
/// Read-only port over the Prisma-OWNED `candidates` table (see docs/architecture/table-ownership.md
/// → efcoreReadOnly). Implemented in Tims.Infrastructure by an EF Core context that NEVER writes
/// these rows. Resolves WHICH candidate a portal Supabase session is, by email within a known org —
/// the privileged pre-tenant lookup analog of <see cref="IIdentityRepository"/>, but for the portal
/// (non-staff) principal. The org is supplied by the caller (the portal slug context), never derived
/// from the JWT — mirroring the TS candidateProcedure flow.
/// </summary>
public interface ICandidateRepository
{
    /// <summary>
    /// Loads the <see cref="CandidateRow"/> for an ACTIVE, non-deleted candidate matching
    /// (<paramref name="organizationId"/>, <paramref name="email"/>), mirroring the TS candidate-portal
    /// lookup (candidate-portal.repository.ts <c>resolveActiveCandidateId</c>): the email match is on
    /// the canonical form (trim + lowercase, exact equality — #315) so legacy mixed-case rows resolve,
    /// and the active/not-deleted filters are applied in the database.
    /// Returns null when no candidate matches.
    /// </summary>
    Task<CandidateRow?> FindByEmailAsync(string email, string organizationId, CancellationToken ct);
}
