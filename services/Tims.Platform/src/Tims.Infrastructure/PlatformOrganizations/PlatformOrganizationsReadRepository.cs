using System.Text.Json.Nodes;
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

    /// <summary>
    /// DECLARATION ORDER of the native Postgres <c>"OrgPlan"</c> enum
    /// (<c>baseline/prod-public-schema.sql:169-173</c>: trial, starter, professional, enterprise).
    ///
    /// <para><b>Why this exists (#211 follow-up, 2026-08-11).</b> <c>organizations.plan</c> IS that native
    /// enum, and Postgres sorts enum values by DECLARATION order — so the TS
    /// <c>orderBy: { plan: 'asc' }</c> yields trial, starter, professional, enterprise. This context maps
    /// the column to a C# <c>string</c>, and the in-memory sort below was a bare
    /// <c>OrderBy(o =&gt; o.Plan)</c>, i.e. <c>Comparer&lt;string&gt;.Default</c>. MEASURED on net10.0:
    /// that yields enterprise, professional, starter, trial — the EXACT REVERSE on this four-element set,
    /// a completely different page for the same request. It is reachable from the production UI
    /// (<c>org-table.tsx</c> has a sortable Plan header and <c>page.tsx</c> forwards
    /// <c>sortBy</c>/<c>sortDir</c>) the moment the read flag flips, and the parity harness cannot catch
    /// it because the <c>list</c> surface is registered with <c>input: {}</c> and never sends
    /// <c>sortBy</c>.</para>
    ///
    /// <para>An unknown value sorts LAST (index <c>Length</c>) rather than throwing: the Zod
    /// <c>sortBy</c> enum does not constrain the stored column, and a plan value added to the DB type but
    /// not to this array must not 500 a listing.</para>
    /// </summary>
    private static readonly string[] OrgPlanDeclarationOrder = ["trial", "starter", "professional", "enterprise"];

    public async Task<PlatformOrganizationKpis> GetKpisAsync(DateTime now, CancellationToken cancellationToken)
    {
        // Five separate scalars, mirroring the TS Promise.all + one follow-up (organizations.ts:25-40).
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
        // (organizations.ts:109). Count before any ordering/paging so it is unaffected by both.
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

        // ORDERED BY ID, matching the `orderBy: { id: 'asc' }` added to the TS `invoices` include
        // (organizations.ts:101-106). NEITHER stack ordered this array before #211, so any org with two or
        // more pending invoices could diff purely on row order. Fixed on both sides rather than papered
        // over with `sortArraysBy: 'id'`, which normalize.ts applies at EVERY array depth and would
        // therefore also sort the top-level `organizations[]` — silently retiring the createdAt-desc
        // ordering and pagination comparison this surface exists to check.
        var pendingByOrg = pendingInvoices
            .GroupBy(i => i.OrganizationId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<PlatformOrganizationPendingInvoice>)g
                    .Select(i => new PlatformOrganizationPendingInvoice(i.Id.ToString(), i.DueDate))
                    // Ordered on the CANONICAL STRING with an ORDINAL comparer, matching Postgres's
                    // bytewise `ORDER BY uuid`: lexicographic ordinal order over the lowercase
                    // hyphenated hex IS bytewise order.
                    //
                    // CORRECTED 2026-08-11: an earlier version of this comment claimed Guid.CompareTo
                    // and Postgres's bytewise order "disagree". THAT IS FALSE, and it was measured, not
                    // argued: 1,000,000 random pairs on net10.0, ZERO disagreements between
                    // Guid.CompareTo, ordinal-string order, and bytewise big-endian order. Guid.CompareTo
                    // compares _a as UNSIGNED, then _b/_c as ushort, then _d.._k in order — which is
                    // exactly canonical big-endian byte order. So the choice below is correct, but NOT
                    // for the reason previously given; what it actually buys is that the comparer is
                    // explicit rather than inherited from a culture-sensitive default. Do not restore the
                    // "they disagree" claim.
                    .OrderBy(i => i.Id, StringComparer.Ordinal)
                    .ToList());

        var items = rows
            .Select(o => new PlatformOrganizationListItem(
                o.Id.ToString(),
                o.Name,
                o.Slug,
                o.Domain,
                o.Logo,
                o.Plan,
                ParseJson(o.Settings),
                o.BillingEmail,
                o.IsActive,
                o.CreatedAt,
                o.UpdatedAt,
                o.DeletedAt,
                new PlatformOrganizationCounts(
                    userCounts.GetValueOrDefault(o.Id),
                    vacancyCounts.GetValueOrDefault(o.Id),
                    invoiceCounts.GetValueOrDefault(o.Id)),
                subscriptions.TryGetValue(o.Id, out var sub)
                    ? new PlatformOrganizationListSubscription(sub.Plan, sub.Status, sub.TrialEndsAt)
                    : null,
                // `users` is an ARRAY of 0 or 1 (organizations.ts:88-93, `take: 1`), never a scalar and
                // never null — TS emits `[]` for an org with no logged-in user, and `dropNullish` would
                // drop a null but keeps an empty array, so a null here would be its own FAIL (#211).
                lastLogins.TryGetValue(o.Id, out var lastLogin) && lastLogin is not null
                    ? [new PlatformOrganizationListUserLogin(lastLogin)]
                    : [],
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

        // TS orders users by createdAt desc (organizations.ts:119-131).
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

        // Only pending+sent invitations are counted (organizations.ts:135-142).
        var invitationCount = await db.Invitations
            .AsNoTracking()
            .CountAsync(i => i.OrganizationId == id && OpenInvitationStatuses.Contains(i.Status), cancellationToken);

        var teamsByUnit = teams
            .GroupBy(t => t.BusinessUnitId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<PlatformOrganizationTeam>)g
                    .Select(t => new PlatformOrganizationTeam(
                        t.Id.ToString(),
                        t.OrganizationId.ToString(),
                        t.BusinessUnitId.ToString(),
                        t.Name,
                        t.LeaderId?.ToString(),
                        ParseJson(t.Settings),
                        t.IsActive,
                        t.CreatedAt,
                        t.UpdatedAt))
                    .ToList());

        var unitsByCompany = businessUnits
            .GroupBy(b => b.CompanyId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<PlatformOrganizationBusinessUnit>)g
                    .Select(b => new PlatformOrganizationBusinessUnit(
                        b.Id.ToString(),
                        b.OrganizationId.ToString(),
                        b.CompanyId.ToString(),
                        b.Name,
                        b.Code,
                        b.ParentId?.ToString(),
                        ParseJson(b.Settings),
                        b.IsActive,
                        b.CreatedAt,
                        b.UpdatedAt,
                        teamsByUnit.GetValueOrDefault(b.Id, [])))
                    .ToList());

        return new PlatformOrganizationDetail(
            org.Id.ToString(),
            org.Name,
            org.Slug,
            org.Domain,
            org.Logo,
            org.Plan,
            ParseJson(org.Settings),
            org.BillingEmail,
            org.IsActive,
            org.CreatedAt,
            org.UpdatedAt,
            org.DeletedAt,
            companies
                .Select(c => new PlatformOrganizationCompany(
                    c.Id.ToString(),
                    c.OrganizationId.ToString(),
                    c.Name,
                    c.Country,
                    c.Currency,
                    c.Timezone,
                    c.Language,
                    c.LegalName,
                    c.TaxId,
                    ParseJson(c.Settings),
                    c.IsActive,
                    c.CreatedAt,
                    c.UpdatedAt,
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
                    subscription.OrganizationId.ToString(),
                    subscription.StripeCustomerId,
                    subscription.StripeSubscriptionId,
                    subscription.Plan,
                    subscription.Status,
                    subscription.CurrentPeriodStart,
                    subscription.CurrentPeriodEnd,
                    subscription.TrialEndsAt,
                    subscription.CancelledAt,
                    subscription.LastStripeEventAt,
                    subscription.CreatedAt,
                    subscription.UpdatedAt),
            featureFlags
                .Select(f => new PlatformOrganizationFeatureFlag(
                    f.Id.ToString(),
                    f.OrganizationId.ToString(),
                    f.Key,
                    f.Enabled,
                    ParseJson(f.Payload),
                    f.CreatedAt,
                    f.UpdatedAt))
                .ToList(),
            billingProfile is null
                ? null
                : new PlatformOrganizationBillingProfile(
                    billingProfile.Id.ToString(),
                    billingProfile.OrganizationId.ToString(),
                    billingProfile.CompanyName,
                    billingProfile.TaxId,
                    billingProfile.Address,
                    billingProfile.City,
                    billingProfile.State,
                    billingProfile.Country,
                    billingProfile.ZipCode,
                    billingProfile.BillingEmail,
                    billingProfile.BillingPhone,
                    billingProfile.CreatedAt,
                    billingProfile.UpdatedAt),
            new PlatformOrganizationDetailCounts(users.Count, vacancyCount, invoiceCount, invitationCount));
    }

    /// <summary>
    /// Re-parses a raw jsonb column's text into the <c>JsonNode</c> the read model exposes, so the wire
    /// carries a JSON OBJECT (what Prisma's <c>Json</c> field yields on the TS side) rather than a JSON
    /// string containing JSON. Same pattern as
    /// <c>PlatformOrganizationsWriteRepository.cs:166</c>; the <c>settings</c> columns are NOT NULL, so
    /// the null branch only ever fires for the nullable <c>feature_flags.payload</c>.
    /// </summary>
    private static JsonNode? ParseJson(string? raw) => raw is null ? null : JsonNode.Parse(raw);

    /// <summary>
    /// The TS `where` builder (organizations.ts:61-69). `search` matches name OR slug, case-insensitively;
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
    /// The TS `sortMap` (organizations.ts:71-77). Defaults: unspecified sortBy ⇒ createdAt desc; a
    /// specified sortBy with no sortDir ⇒ asc for name/plan, desc for createdAt/users.
    ///
    /// <para><b>`plan` sorts on the ENUM'S DECLARATION INDEX, not on the string</b> — see
    /// <see cref="OrgPlanDeclarationOrder"/> for the measurement. This was a real, user-visible divergence
    /// that #211 did not list and that no parity case could reach.</para>
    ///
    /// <para><b>KNOWN RESIDUAL, deliberately NOT "fixed" here: `name`.</b> Postgres orders <c>text</c> by
    /// the database's collation; this <c>OrderBy</c> uses <c>Comparer&lt;string&gt;.Default</c>, i.e. the
    /// process's current culture. Those two agree on plain ASCII-alphanumeric names and can disagree on
    /// case, accents, punctuation and digits. Unlike <c>plan</c>, there is no correct constant to write:
    /// the target collation is a property of the production database, which the repo does not record
    /// (<c>packages/db/baseline/prod-public-schema.sql</c> carries no <c>LC_COLLATE</c>), and picking
    /// <c>StringComparer.Ordinal</c> here would silently assume the <c>C</c> collation. Guessing would
    /// swap a KNOWN unknown for an UNKNOWN wrong answer, so it is written down and filed instead.</para>
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
            "plan" => Order(organizations, o => PlanRank(o.Plan), descending),
            "users" => Order(organizations, o => userCounts.GetValueOrDefault(o.Id), descending),
            _ => Order(organizations, o => o.CreatedAt, descending),
        };
    }

    /// <summary>
    /// Position of <paramref name="plan"/> in the native <c>"OrgPlan"</c> enum's declaration order, which
    /// is what Postgres sorts by. An unrecognised value ranks last rather than throwing.
    /// </summary>
    private static int PlanRank(string plan)
    {
        var index = Array.IndexOf(OrgPlanDeclarationOrder, plan);
        return index < 0 ? OrgPlanDeclarationOrder.Length : index;
    }

    private static List<PlatformOrganizationEntity> Order<TKey>(
        List<PlatformOrganizationEntity> source,
        Func<PlatformOrganizationEntity, TKey> selector,
        bool descending) =>
        (descending ? source.OrderByDescending(selector) : source.OrderBy(selector)).ToList();
}
