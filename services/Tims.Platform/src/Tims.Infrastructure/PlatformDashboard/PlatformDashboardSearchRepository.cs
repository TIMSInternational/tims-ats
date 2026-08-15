using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformDashboard;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// EF Core implementation of the global <c>search</c> lookups (Phase-5 slice 23, issue #81, PR 2 of 3).
///
/// <para><b>The term is NOT wildcard-escaped, on purpose</b> — the same decision, for the same reason, as
/// the invitations search. Prisma's <c>contains</c> with <c>mode: 'insensitive'</c> compiles to
/// <c>ILIKE '%' || term || '%'</c> and escapes neither <c>%</c> nor <c>_</c>, so a search for <c>%</c>
/// matches every row in BOTH stacks. Escaping here would be a silent behaviour change and a parity FAIL
/// on any query containing a wildcard. It is not an injection risk in either stack: the term is a bound
/// parameter, never concatenated into SQL.</para>
///
/// <para><b>Ordering is delegated to the database collation.</b> <c>orderBy: { name: 'asc' }</c> becomes a
/// bare <c>ORDER BY name</c> with no <c>COLLATE</c> clause on both sides, so the two stacks agree because
/// they are talking to the same database — not because either one specified a collation.</para>
/// </summary>
public sealed class PlatformDashboardSearchRepository(PlatformDashboardReadDbContext db)
    : IPlatformDashboardSearchRepository
{
    public async Task<IReadOnlyList<SearchOrganizationItem>> SearchOrganizationsAsync(
        string term,
        int take,
        CancellationToken cancellationToken)
    {
        var pattern = "%" + term + "%";

        // `domain` is nullable; ILIKE against NULL is NULL, so a domain-less organization fails that leg
        // and can still match on name or slug — identical to Prisma's OR over an optional column.
        var rows = await db.Organizations
            .AsNoTracking()
            .Where(o => EF.Functions.ILike(o.Name, pattern)
                || EF.Functions.ILike(o.Slug, pattern)
                || EF.Functions.ILike(o.Domain!, pattern))
            .OrderBy(o => o.Name)
            .Take(take)
            .Select(o => new { o.Id, o.Name, o.Slug, o.Plan, o.IsActive })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(o => new SearchOrganizationItem(o.Id.ToString(), o.Name, o.Slug, o.Plan, o.IsActive))
            .ToList();
    }

    public async Task<IReadOnlyList<SearchUserItem>> SearchUsersAsync(
        string term,
        int take,
        CancellationToken cancellationToken)
    {
        var pattern = "%" + term + "%";

        // LEFT join: organization_id is nullable (a platform owner has none), and TS selects
        // `organization: { select: { name: true } }` on an optional relation, which yields null.
        var rows = await (from user in db.Users.AsNoTracking()
                          where EF.Functions.ILike(user.FirstName, pattern)
                              || EF.Functions.ILike(user.LastName, pattern)
                              || EF.Functions.ILike(user.Email, pattern)
                          orderby user.FirstName
                          join organization in db.Organizations.AsNoTracking()
                              on user.OrganizationId equals organization.Id into organizations
                          from organization in organizations.DefaultIfEmpty()
                          select new
                          {
                              user.Id,
                              user.FirstName,
                              user.LastName,
                              user.Email,
                              user.IsPlatformOwner,
                              user.IsActive,
                              user.Avatar,
                              OrgName = (string?)organization.Name,
                          })
            .Take(take)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(u => new SearchUserItem(
                u.Id.ToString(),
                u.FirstName,
                u.LastName,
                u.Email,
                u.IsPlatformOwner,
                u.IsActive,
                u.Avatar,
                u.OrgName is null ? null : new SearchUserOrganization(u.OrgName)))
            .ToList();
    }
}
