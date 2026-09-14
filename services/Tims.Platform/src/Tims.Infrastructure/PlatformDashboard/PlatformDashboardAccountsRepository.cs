using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformDashboard;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// EF Core implementation of <c>getCustomerHealth</c> and <c>getUpsellOpportunities</c> (Phase-5 slice 23,
/// issue #81, PR 2 of 3).
///
/// <para><b>Flat aggregates joined in memory, NOT correlated subqueries in a projection.</b> The TS
/// procedures ask Prisma for nested relations and reduce them in JavaScript, which materialises every
/// active user of every tenant into the Node process. Neither shape is copied: each roll-up here is a
/// separate <c>GROUP BY organization_id</c> that returns at most one row per organization, and the
/// dictionaries are merged afterwards. That keeps a cross-tenant read bounded by the number of
/// ORGANIZATIONS rather than the number of users, and — unlike a subquery-per-column projection — every
/// statement is a shape EF translates predictably.</para>
///
/// <para>The COUNTS are identical to the JavaScript reductions they replace: <c>COUNT(*)</c> over
/// <c>is_active</c> is the same set as <c>users.length</c> after Prisma's <c>where</c>, and
/// <c>MAX(last_login_at)</c> is the same instant as the <c>reduce</c> that keeps the latest. This is a
/// query-shape change, not a semantic one.</para>
/// </summary>
public sealed class PlatformDashboardAccountsRepository(PlatformDashboardReadDbContext db)
    : IPlatformDashboardAccountsRepository
{
    public async Task<IReadOnlyList<CustomerHealthOrgRow>> GetCustomerHealthRowsAsync(
        DateTime nowUtc,
        DateTime sevenDaysAgoUtc,
        CancellationToken cancellationToken)
    {
        var now = PlatformDashboardTimestamps.ToNaive(nowUtc);
        var sevenDaysAgo = PlatformDashboardTimestamps.ToNaive(sevenDaysAgoUtc);

        // EVERY organization — no is_active filter, no deleted_at filter. The TS findMany has neither.
        var organizations = await db.Organizations
            .AsNoTracking()
            .Select(o => new { o.Id, o.Name })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var subscriptions = await db.Subscriptions
            .AsNoTracking()
            .Select(s => new { s.OrganizationId, s.Plan, s.Status, s.TrialEndsAt })
            .ToDictionaryAsync(s => s.OrganizationId, cancellationToken)
            .ConfigureAwait(false);

        var overdueByOrg = await db.Invoices
            .AsNoTracking()
            .Where(i => i.Status == "pending" && i.DueDate < now)
            .GroupBy(i => i.OrganizationId)
            .Select(g => new { OrgId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.OrgId, x => x.Count, cancellationToken)
            .ConfigureAwait(false);

        // One pass over ACTIVE users gives all three signals. `Count(predicate)` becomes a filtered
        // aggregate; `Max` over a nullable column yields null for a group with no logins at all, which is
        // exactly what the TS reduce's `null` seed produces.
        var userStats = await db.Users
            .AsNoTracking()
            .Where(u => u.IsActive && u.OrganizationId != null)
            .GroupBy(u => u.OrganizationId!.Value)
            .Select(g => new
            {
                OrgId = g.Key,
                Active = g.Count(),
                Recent = g.Count(u => u.LastLoginAt >= sevenDaysAgo),
                LastLoginAt = g.Max(u => u.LastLoginAt),
            })
            .ToDictionaryAsync(x => x.OrgId, cancellationToken)
            .ConfigureAwait(false);

        return organizations.Select(o =>
        {
            subscriptions.TryGetValue(o.Id, out var subscription);
            userStats.TryGetValue(o.Id, out var stats);
            overdueByOrg.TryGetValue(o.Id, out var overdue);

            return new CustomerHealthOrgRow(
                o.Id.ToString(),
                o.Name,
                subscription?.Plan,
                subscription?.Status,
                subscription?.TrialEndsAt,
                overdue,
                stats?.Active ?? 0,
                stats?.Recent ?? 0,
                stats?.LastLoginAt);
        }).ToList();
    }

    public async Task<IReadOnlyList<UpsellOrgRow>> GetUpsellRowsAsync(
        DateTime sevenDaysAgoUtc,
        CancellationToken cancellationToken)
    {
        var sevenDaysAgo = PlatformDashboardTimestamps.ToNaive(sevenDaysAgoUtc);

        var organizations = await db.Organizations
            .AsNoTracking()
            .Where(o => o.IsActive)
            .Select(o => new { o.Id, o.Name, o.Plan })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var subscriptions = await db.Subscriptions
            .AsNoTracking()
            .Select(s => new { s.OrganizationId, s.Plan, s.Status })
            .ToDictionaryAsync(s => s.OrganizationId, cancellationToken)
            .ConfigureAwait(false);

        // `_count.users` — EVERY user row, including inactive and soft-deleted ones. Deliberately
        // unfiltered; see UpsellOrgRow for why the two user numbers disagree by design.
        var totalUsers = await CountByOrganizationAsync(
            db.Users.AsNoTracking().Where(u => u.OrganizationId != null).Select(u => u.OrganizationId!.Value),
            cancellationToken).ConfigureAwait(false);

        var activeRecentUsers = await CountByOrganizationAsync(
            db.Users.AsNoTracking()
                .Where(u => u.IsActive && u.LastLoginAt >= sevenDaysAgo && u.OrganizationId != null)
                .Select(u => u.OrganizationId!.Value),
            cancellationToken).ConfigureAwait(false);

        var features = await CountByOrganizationAsync(
            db.FeatureFlags.AsNoTracking().Select(f => f.OrganizationId),
            cancellationToken).ConfigureAwait(false);

        var vacancies = await CountByOrganizationAsync(
            db.Vacancies.AsNoTracking().Select(v => v.OrganizationId),
            cancellationToken).ConfigureAwait(false);

        return organizations.Select(o =>
        {
            subscriptions.TryGetValue(o.Id, out var subscription);

            return new UpsellOrgRow(
                o.Id.ToString(),
                o.Name,
                o.Plan,
                subscription?.Plan,
                subscription?.Status,
                totalUsers.GetValueOrDefault(o.Id),
                activeRecentUsers.GetValueOrDefault(o.Id),
                features.GetValueOrDefault(o.Id),
                vacancies.GetValueOrDefault(o.Id));
        }).ToList();
    }

    /// <summary><c>SELECT organization_id, COUNT(*) … GROUP BY 1</c> over an already-filtered projection
    /// of organization ids. An organization with no rows is absent from the result and reads as 0, which
    /// is what Prisma's <c>_count</c> returns for an empty relation.</summary>
    private static async Task<Dictionary<Guid, int>> CountByOrganizationAsync(
        IQueryable<Guid> organizationIds,
        CancellationToken cancellationToken) =>
        await organizationIds
            .GroupBy(id => id)
            .Select(g => new { OrgId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.OrgId, x => x.Count, cancellationToken)
            .ConfigureAwait(false);
}
