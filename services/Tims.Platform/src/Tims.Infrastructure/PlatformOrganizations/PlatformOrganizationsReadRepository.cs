using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformOrganizations;

namespace Tims.Infrastructure.PlatformOrganizations;

/// <summary>
/// Cross-org reads for Phase-5 slice 19 (issue #76). Every query is <c>AsNoTracking()</c> and NONE is
/// wrapped in <c>TenantScope</c> — see <see cref="PlatformOrganizationsReadDbContext"/> for why.
/// </summary>
public sealed class PlatformOrganizationsReadRepository(PlatformOrganizationsReadDbContext db)
    : IPlatformOrganizationsReadRepository
{
    private const string TrialingStatus = "trialing";
    private const string PendingInvoiceStatus = "pending";
    private static readonly string[] OpenInvitationStatuses = ["pending", "sent"];

    public async Task<PlatformOrganizationKpis> GetKpisAsync(DateTime now, CancellationToken cancellationToken)
    {
        // Five separate scalars, mirroring the TS Promise.all + one follow-up (organizations.ts:11-26).
        var total = await db.Organizations.AsNoTracking().CountAsync(cancellationToken);
        var active = await db.Organizations.AsNoTracking().CountAsync(o => o.IsActive, cancellationToken);
        var suspended = await db.Organizations.AsNoTracking().CountAsync(o => !o.IsActive, cancellationToken);
        var trialing = await db.Subscriptions.AsNoTracking().CountAsync(s => s.Status == TrialingStatus, cancellationToken);

        // `gte: new Date(), lte: new Date(Date.now() + 7d)` — inclusive both ends, as Prisma renders it.
        var weekFromNow = now.AddDays(7);
        var expiringThisWeek = await db.Subscriptions
            .AsNoTracking()
            .CountAsync(
                s => s.Status == TrialingStatus && s.TrialEndsAt != null && s.TrialEndsAt >= now && s.TrialEndsAt <= weekFromNow,
                cancellationToken);

        return new PlatformOrganizationKpis(total, active, suspended, trialing, expiringThisWeek);
    }

    public async Task<PlatformOrganizationListResult> ListAsync(
        PlatformOrganizationListQuery query,
        CancellationToken cancellationToken)
    {
        var filtered = ApplyFilters(db.Organizations.AsNoTracking(), query);

        // The TS returns `total` for the SAME filter, computed independently of the page
        // (organizations.ts:81). Count before any ordering/paging so it is unaffected by both.
        var total = await filtered.CountAsync(cancellationToken);

        // Sorting by `users` is a relation count in Prisma (`orderBy: { users: { _count } }`). EF cannot
        // express that against a context with no navigation properties, so the user counts are resolved
        // first and the ordering is applied in memory. Bounded by design: this is the platform console
        // listing ORGANIZATIONS (15 in production today), not a tenant-scale table.
        var userCounts = await db.Users
            .AsNoTracking()
            .Where(u => u.OrganizationId != null)
            .GroupBy(u => u.OrganizationId!.Value)
            .Select(g => new { OrganizationId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.OrganizationId, x => x.Count, cancellationToken);

        var sorted = SortOrganizations(await filtered.ToListAsync(cancellationToken), query, userCounts);

        // Prisma: `skip: cursor ? 1 : page * limit` with `cursor: { id }` — the cursor SEEKS to that row
        // in the current ordering and then skips it. Reproduced by locating the id in the sorted list.
        // An unknown cursor id yields an empty page, which is what Prisma does.
        // The FE never sends a cursor (page.tsx:33-40 passes page/limit only); it is honoured because
        // the Zod schema accepts it and dropping it would be a silent contract narrowing.
        IEnumerable<PlatformOrganizationEntity> page = sorted;
        if (query.Cursor is { } cursor)
        {
            var index = sorted.FindIndex(o => o.Id == cursor);
            page = index < 0 ? [] : sorted.Skip(index + 1);
        }
        else
        {
            page = sorted.Skip(query.Page * query.Limit);
        }

        var rows = page.Take(query.Limit).ToList();
        if (rows.Count == 0)
        {
            return new PlatformOrganizationListResult([], total);
        }

        var orgIds = rows.Select(o => o.Id).ToList();

        var subscriptions = await db.Subscriptions
            .AsNoTracking()
            .Where(s => orgIds.Contains(s.OrganizationId))
            .ToDictionaryAsync(s => s.OrganizationId, cancellationToken);

        var vacancyCounts = await db.Vacancies
            .AsNoTracking()
            .Where(v => orgIds.Contains(v.OrganizationId))
            .GroupBy(v => v.OrganizationId)
            .Select(g => new { OrganizationId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.OrganizationId, x => x.Count, cancellationToken);

        var invoiceCounts = await db.Invoices
            .AsNoTracking()
            .Where(i => orgIds.Contains(i.OrganizationId))
            .GroupBy(i => i.OrganizationId)
            .Select(g => new { OrganizationId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.OrganizationId, x => x.Count, cancellationToken);

        // TS: `users: { select: { lastLoginAt }, where: { lastLoginAt: { not: null } }, orderBy: desc, take: 1 }`
        // — the single most recent non-null login per org.
        var lastLogins = await db.Users
            .AsNoTracking()
            .Where(u => u.OrganizationId != null && orgIds.Contains(u.OrganizationId!.Value) && u.LastLoginAt != null)
            .GroupBy(u => u.OrganizationId!.Value)
            .Select(g => new { OrganizationId = g.Key, LastLoginAt = g.Max(u => u.LastLoginAt) })
            .ToDictionaryAsync(x => x.OrganizationId, x => x.LastLoginAt, cancellationToken);

        var pendingInvoices = await db.Invoices
            .AsNoTracking()
            .Where(i => orgIds.Contains(i.OrganizationId) && i.Status == PendingInvoiceStatus)
            .Select(i => new { i.OrganizationId, i.Id, i.DueDate })
            .ToListAsync(cancellationToken);

        var pendingByOrg = pendingInvoices
            .GroupBy(i => i.OrganizationId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<PlatformOrganizationPendingInvoice>)g
                    .Select(i => new PlatformOrganizationPendingInvoice(i.Id.ToString(), i.DueDate))
                    .ToList());

        var items = rows
            .Select(o => new PlatformOrganizationListItem(
                o.Id.ToString(),
                o.Name,
                o.Slug,
                o.Domain,
                o.Logo,
                o.Plan,
                o.BillingEmail,
                o.IsActive,
                o.CreatedAt,
                o.UpdatedAt,
                new PlatformOrganizationCounts(
                    userCounts.GetValueOrDefault(o.Id),
                    vacancyCounts.GetValueOrDefault(o.Id),
                    invoiceCounts.GetValueOrDefault(o.Id)),
                subscriptions.TryGetValue(o.Id, out var sub)
                    ? new PlatformOrganizationListSubscription(sub.Plan, sub.Status, sub.TrialEndsAt)
                    : null,
                lastLogins.GetValueOrDefault(o.Id),
                pendingByOrg.GetValueOrDefault(o.Id, [])))
            .ToList();

        return new PlatformOrganizationListResult(items, total);
    }

    public async Task<PlatformOrganizationDetail?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        var org = await db.Organizations.AsNoTracking().FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
        if (org is null)
        {
            return null;
        }

        var companies = await db.Companies.AsNoTracking().Where(c => c.OrganizationId == id).ToListAsync(cancellationToken);
        var companyIds = companies.Select(c => c.Id).ToList();

        var businessUnits = await db.BusinessUnits
            .AsNoTracking()
            .Where(b => companyIds.Contains(b.CompanyId))
            .ToListAsync(cancellationToken);
        var unitIds = businessUnits.Select(b => b.Id).ToList();

        var teams = await db.Teams
            .AsNoTracking()
            .Where(t => unitIds.Contains(t.BusinessUnitId))
            .ToListAsync(cancellationToken);

        // TS orders users by createdAt desc (organizations.ts:93).
        var users = await db.Users
            .AsNoTracking()
            .Where(u => u.OrganizationId == id)
            .OrderByDescending(u => u.CreatedAt)
            .ToListAsync(cancellationToken);

        var subscription = await db.Subscriptions.AsNoTracking().FirstOrDefaultAsync(s => s.OrganizationId == id, cancellationToken);
        var featureFlags = await db.FeatureFlags.AsNoTracking().Where(f => f.OrganizationId == id).ToListAsync(cancellationToken);
        var billingProfile = await db.BillingProfiles.AsNoTracking().FirstOrDefaultAsync(b => b.OrganizationId == id, cancellationToken);

        var vacancyCount = await db.Vacancies.AsNoTracking().CountAsync(v => v.OrganizationId == id, cancellationToken);
        var invoiceCount = await db.Invoices.AsNoTracking().CountAsync(i => i.OrganizationId == id, cancellationToken);

        // Only pending+sent invitations are counted (organizations.ts:97).
        var invitationCount = await db.Invitations
            .AsNoTracking()
            .CountAsync(i => i.OrganizationId == id && OpenInvitationStatuses.Contains(i.Status), cancellationToken);

        var teamsByUnit = teams
            .GroupBy(t => t.BusinessUnitId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<PlatformOrganizationTeam>)g
                    .Select(t => new PlatformOrganizationTeam(t.Id.ToString(), t.Name))
                    .ToList());

        var unitsByCompany = businessUnits
            .GroupBy(b => b.CompanyId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<PlatformOrganizationBusinessUnit>)g
                    .Select(b => new PlatformOrganizationBusinessUnit(
                        b.Id.ToString(),
                        b.Name,
                        teamsByUnit.GetValueOrDefault(b.Id, [])))
                    .ToList());

        return new PlatformOrganizationDetail(
            org.Id.ToString(),
            org.Name,
            org.Slug,
            org.Domain,
            org.Logo,
            org.Plan,
            org.BillingEmail,
            org.IsActive,
            org.CreatedAt,
            org.UpdatedAt,
            companies
                .Select(c => new PlatformOrganizationCompany(
                    c.Id.ToString(),
                    c.Name,
                    c.Country,
                    unitsByCompany.GetValueOrDefault(c.Id, [])))
                .ToList(),
            users
                .Select(u => new PlatformOrganizationUser(
                    u.Id.ToString(),
                    u.FirstName,
                    u.LastName,
                    u.Email,
                    u.JobTitle,
                    u.IsActive,
                    u.LastLoginAt,
                    u.IsPlatformOwner))
                .ToList(),
            subscription is null
                ? null
                : new PlatformOrganizationSubscription(
                    subscription.Id.ToString(),
                    subscription.Plan,
                    subscription.Status,
                    subscription.TrialEndsAt,
                    subscription.CurrentPeriodEnd,
                    subscription.CreatedAt,
                    subscription.UpdatedAt),
            featureFlags
                .Select(f => new PlatformOrganizationFeatureFlag(f.Id.ToString(), f.Key, f.Enabled))
                .ToList(),
            billingProfile is null
                ? null
                : new PlatformOrganizationBillingProfile(
                    billingProfile.Id.ToString(),
                    billingProfile.CompanyName,
                    billingProfile.TaxId,
                    billingProfile.Address,
                    billingProfile.City,
                    billingProfile.State,
                    billingProfile.Country,
                    billingProfile.ZipCode,
                    billingProfile.BillingEmail,
                    billingProfile.BillingPhone),
            new PlatformOrganizationDetailCounts(users.Count, vacancyCount, invoiceCount, invitationCount));
    }

    /// <summary>
    /// The TS `where` builder (organizations.ts:45-49). `search` matches name OR slug, case-insensitively;
    /// `status` is a tri-state where only the literals "active"/"suspended" filter at all — any other
    /// value is IGNORED, which is a real TS behaviour worth reproducing rather than tightening.
    /// </summary>
    private static IQueryable<PlatformOrganizationEntity> ApplyFilters(
        IQueryable<PlatformOrganizationEntity> source,
        PlatformOrganizationListQuery query)
    {
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var pattern = $"%{query.Search}%";
            source = source.Where(o => EF.Functions.ILike(o.Name, pattern) || EF.Functions.ILike(o.Slug, pattern));
        }

        if (!string.IsNullOrWhiteSpace(query.Plan))
        {
            source = source.Where(o => o.Plan == query.Plan);
        }

        return query.Status switch
        {
            "active" => source.Where(o => o.IsActive),
            "suspended" => source.Where(o => !o.IsActive),
            _ => source,
        };
    }

    /// <summary>
    /// The TS `sortMap` (organizations.ts:51-57). Defaults: unspecified sortBy ⇒ createdAt desc; a
    /// specified sortBy with no sortDir ⇒ asc for name/plan, desc for createdAt/users.
    /// </summary>
    private static List<PlatformOrganizationEntity> SortOrganizations(
        List<PlatformOrganizationEntity> organizations,
        PlatformOrganizationListQuery query,
        IReadOnlyDictionary<Guid, int> userCounts)
    {
        var descending = query.SortDir is null
            ? query.SortBy is "createdAt" or "users" or null
            : query.SortDir == "desc";

        return query.SortBy switch
        {
            "name" => Order(organizations, o => o.Name, descending),
            "plan" => Order(organizations, o => o.Plan, descending),
            "users" => Order(organizations, o => userCounts.GetValueOrDefault(o.Id), descending),
            _ => Order(organizations, o => o.CreatedAt, descending),
        };
    }

    private static List<PlatformOrganizationEntity> Order<TKey>(
        List<PlatformOrganizationEntity> source,
        Func<PlatformOrganizationEntity, TKey> selector,
        bool descending) =>
        (descending ? source.OrderByDescending(selector) : source.OrderBy(selector)).ToList();
}
