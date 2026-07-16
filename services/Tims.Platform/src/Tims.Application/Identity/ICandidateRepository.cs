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
    /// (<paramref name="organizationId"/>, <paramref name="email"/>). Faithful to the TS query
    /// <c>candidate.findFirst({ where: { organizationId, email, isActive: true, deletedAt: null } })</c>
    /// — the email match is case-sensitive (Postgres text equality, Prisma's default), and the
    /// active/not-deleted filters are applied in the database. Returns null when no candidate matches.
    /// </summary>
    Task<CandidateRow?> FindByEmailAsync(string email, string organizationId, CancellationToken ct);
}
