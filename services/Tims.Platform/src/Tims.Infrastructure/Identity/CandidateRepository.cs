using Microsoft.EntityFrameworkCore;
using Tims.Application.Identity;
using Tims.Domain.Identity;

namespace Tims.Infrastructure.Identity;

/// <summary>
/// EF Core implementation of <see cref="ICandidateRepository"/> over <see cref="IdentityDbContext"/>.
/// Strictly read-only: the query is <c>AsNoTracking</c> and never writes. Faithful to the TS
/// candidate-portal resolution — <c>candidate.findFirst({ where: { organizationId, email,
/// isActive: true, deletedAt: null } })</c> — including the case-sensitive email equality (Postgres
/// text `=`, Prisma's default) and the active/not-deleted filters pushed into SQL. Keyed on BOTH
/// email AND org: the same email may be a candidate in multiple orgs.
///
/// Suspended/soft-deleted-org lockout: additionally gates on the OWNING organization being active
/// AND not soft-deleted (a JOIN to <c>organizations</c>) — the same fail-closed lockout the API-key
/// path enforces in <see cref="ApiKeyRepository"/>. A candidate in a locked-out org resolves to NULL
/// (anonymous), never <c>PrincipalType.Candidate</c>. This is deliberately STRICTER than the TS
/// candidate-portal lookup, which gates on <c>org.isActive</c> upstream but misses <c>deletedAt</c>;
/// the TS org lookup in <c>services/candidate-portal.service.ts</c> should add the same
/// <c>deletedAt</c> guard (a TS follow-up for Federico — NOT changed here).
/// </summary>
public sealed class CandidateRepository(IdentityDbContext db) : ICandidateRepository
{
    private readonly IdentityDbContext _db = db;

    public async Task<CandidateRow?> FindByEmailAsync(string email, string organizationId, CancellationToken ct)
    {
        if (!Guid.TryParse(organizationId, out var orgId))
        {
            return null;
        }

        var candidate = await _db.Candidates
            .AsNoTracking()
            .Where(c => c.OrganizationId == orgId
                && c.Email == email
                && c.IsActive
                && c.DeletedAt == null)
            // Owning-org lockout (defense in depth): resolve ONLY when the org is active and
            // not soft-deleted — one query, mirroring the API-key suspended-org lockout.
            .Where(c => _db.Organizations.Any(o =>
                o.Id == c.OrganizationId && o.IsActive && o.DeletedAt == null))
            .Select(c => new { c.Id, c.OrganizationId, c.Email })
            .FirstOrDefaultAsync(ct);

        return candidate is null
            ? null
            : new CandidateRow(candidate.Id.ToString(), candidate.OrganizationId.ToString(), candidate.Email);
    }
}
