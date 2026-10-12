using Microsoft.EntityFrameworkCore;
using Tims.Application.Identity;
using Tims.Domain.Identity;

namespace Tims.Infrastructure.Identity;

/// <summary>
/// EF Core implementation of <see cref="ICandidateRepository"/> over <see cref="IdentityDbContext"/>.
/// Strictly read-only: the query is <c>AsNoTracking</c> and never writes. Faithful to the TS
/// candidate-portal resolution (candidate-portal.repository.ts <c>resolveActiveCandidateId</c>) with
/// the active/not-deleted filters pushed into SQL. Keyed on BOTH email AND org: the same email may be
/// a candidate in multiple orgs.
///
/// #315 canonical email identity: the match is EXACT on the canonical form (trim + lowercase) — never
/// a LIKE, so `_`/`%` in an address are literal — so legacy mixed-case / whitespace-padded rows still
/// resolve. When several rows of one org canonically match (legacy case-variant duplicates, reported
/// by scripts/ops/candidate-email-collision-report.sql), the pick is deterministic and mirrors the TS
/// order: the row stored byte-identical to the session email, then the row stored canonically, then
/// the lowest id (this read-only mapping has no created_at; TS uses oldest-first).
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

    // Upper bound on case-variant rows of ONE email in one org that are loaded for the pick.
    private const int MaxVariants = 20;

    /// <summary>The canonical candidate email: trimmed and lowercased (invariant culture).</summary>
    public static string CanonicalEmail(string email) => email.Trim().ToLowerInvariant();

    public async Task<CandidateRow?> FindByEmailAsync(string email, string organizationId, CancellationToken ct)
    {
        if (!Guid.TryParse(organizationId, out var orgId))
        {
            return null;
        }

        var canonical = CanonicalEmail(email);
        if (canonical.Length == 0)
        {
            return null;
        }

        var matches = await _db.Candidates
            .AsNoTracking()
            .Where(c => c.OrganizationId == orgId
                // Translates to lower(btrim(email)) = @canonical — exact equality, never LIKE.
                && c.Email.Trim().ToLower() == canonical
                && c.IsActive
                && c.DeletedAt == null)
            // Owning-org lockout (defense in depth): resolve ONLY when the org is active and
            // not soft-deleted — one query, mirroring the API-key suspended-org lockout.
            .Where(c => _db.Organizations.Any(o =>
                o.Id == c.OrganizationId && o.IsActive && o.DeletedAt == null))
            .OrderBy(c => c.Id)
            .Select(c => new { c.Id, c.OrganizationId, c.Email })
            .Take(MaxVariants)
            .ToListAsync(ct);

        var candidate = matches.FirstOrDefault(c => string.Equals(c.Email, email, StringComparison.Ordinal))
            ?? matches.FirstOrDefault(c => string.Equals(c.Email, canonical, StringComparison.Ordinal))
            ?? matches.FirstOrDefault();

        return candidate is null
            ? null
            : new CandidateRow(candidate.Id.ToString(), candidate.OrganizationId.ToString(), candidate.Email);
    }
}
