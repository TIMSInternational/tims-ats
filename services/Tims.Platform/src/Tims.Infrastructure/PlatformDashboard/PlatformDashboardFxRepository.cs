using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.PlatformDashboard;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// EF Core implementation of the three FX-derived dashboard reads (Phase-5 slice 23, issue #81, PR 3 of 3).
///
/// <para><b>Every datetime bound is re-kinded through <see cref="PlatformDashboardTimestamps"/> before it
/// touches a query.</b> The mapped columns are declared <c>timestamp</c>, so Npgsql rejects a
/// <c>Kind=Utc</c> value outright (TRAP 11); the raw-SQL hole below has the OPPOSITE problem and needs an
/// explicit <c>NpgsqlDbType.Timestamp</c> parameter (TRAP 10). Both are silent until a real Postgres is
/// involved, which is why both are pinned by integration tests.</para>
///
/// <para><b>Sequential, where TS is parallel.</b> <c>getDashboardKpis</c> issues its nine queries inside a
/// <c>Promise.all</c>; a DbContext is not thread-safe, so these run one after another. That is a LATENCY
/// difference and not an output one — no query here reads a value another writes, and every bound is
/// captured once by the use case before the first round trip.</para>
///
/// <para><b>Money rows are never aggregated in SQL.</b> <c>sumMoney</c> rounds each row to two decimals
/// BEFORE summing and again at the end; a <c>SUM(amount)</c> would round once and disagree by cents on any
/// tenant with more than one invoice. Counts and user statistics ARE aggregated, exactly as
/// <c>PlatformDashboardAccountsRepository</c> does, because those reductions are exact.</para>
/// </summary>
public sealed class PlatformDashboardFxRepository(PlatformDashboardReadDbContext db)
    : IPlatformDashboardFxRepository
{
    public async Task<DashboardKpiInputs> GetKpiInputsAsync(
        DateTime nowUtc,
        DateTime monthStartUtc,
        DateTime prevMonthEndUtc,
        DateTime sevenDaysFromNowUtc,
        CancellationToken cancellationToken)
    {
        var now = PlatformDashboardTimestamps.ToNaive(nowUtc);
        var monthStart = PlatformDashboardTimestamps.ToNaive(monthStartUtc);
        var sevenDaysFromNow = PlatformDashboardTimestamps.ToNaive(sevenDaysFromNowUtc);

        // EVERY organization: `db.organization.count()` has no where clause at all — inactive and
        // soft-deleted tenants included.
        var totalOrgs = await db.Organizations.AsNoTracking()
            .CountAsync(cancellationToken).ConfigureAwait(false);

        var newOrgsThisMonth = await db.Organizations.AsNoTracking()
            .CountAsync(o => o.CreatedAt >= monthStart, cancellationToken).ConfigureAwait(false);

        // ACTIVE users platform-wide, org-less platform owners included — there is no organization
        // predicate on either user count.
        var totalUsers = await db.Users.AsNoTracking()
            .CountAsync(u => u.IsActive, cancellationToken).ConfigureAwait(false);

        var newUsersThisMonth = await db.Users.AsNoTracking()
            .CountAsync(u => u.IsActive && u.CreatedAt >= monthStart, cancellationToken).ConfigureAwait(false);

        var activePlans = await GetActivePlanCountsAsync(null, cancellationToken).ConfigureAwait(false);

        // Literal enum comparisons, so TRAP 8 does not arise — see the MRR repository's note.
        var activeTrials = await db.Subscriptions.AsNoTracking()
            .CountAsync(s => s.Status == "trialing", cancellationToken).ConfigureAwait(false);

        // `{ lte: sevenDaysFromNow, gte: now }` — BOTH bounds inclusive, matching Prisma's lte/gte. A
        // trial that ended a minute ago is excluded by the lower bound; it shows up in the overdue signals
        // of the other reads instead.
        var trialsExpiringSoon = await db.Subscriptions.AsNoTracking()
            .CountAsync(
                s => s.Status == "trialing" && s.TrialEndsAt <= sevenDaysFromNow && s.TrialEndsAt >= now,
                cancellationToken)
            .ConfigureAwait(false);

        var prevMonthPlans = await GetActivePlanCountsAsync(prevMonthEndUtc, cancellationToken).ConfigureAwait(false);

        var overdueInvoices = await db.Invoices.AsNoTracking()
            .Where(i => i.Status == "pending" && i.DueDate < now)
            .Select(i => new DashboardMoneyRow(i.Amount, i.Currency))
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return new DashboardKpiInputs(
            totalOrgs,
            newOrgsThisMonth,
            totalUsers,
            newUsersThisMonth,
            activePlans,
            activeTrials,
            trialsExpiringSoon,
            prevMonthPlans,
            overdueInvoices);
    }

    /// <summary>
    /// <c>SELECT plan, COUNT(*) FROM subscriptions WHERE status = 'active' [AND created_at &lt;= bound]</c>.
    ///
    /// <para>Raw SQL with a <c>"plan"::text</c> cast, the idiom this slice's MRR aggregate established: it
    /// keeps a native enum off the reader entirely, and — unlike a LINQ <c>GroupBy</c> over an UNMAPPED
    /// enum — it does not depend on how EFCore.PG chooses to materialise the grouping key. (DEI reaches for
    /// <c>MapEnum</c> onto real CLR enums for exactly this reason; casting in SQL is the cheaper answer
    /// when the key is only ever a dictionary lookup.)</para>
    ///
    /// <para><b>The optional bound is an explicit <see cref="NpgsqlParameter"/>, and that is TRAP 10.</b> A
    /// bare <see cref="DateTime"/> in a <c>SqlQuery</c> interpolation hole gets EF's DEFAULT mapping,
    /// <c>timestamp with time zone</c>, which against this naive column would make Postgres lift the column
    /// at the session timezone for the comparison. Passing a <see cref="DbParameter"/> through the hole
    /// keeps the statement fully parameterised while pinning the store type.</para>
    ///
    /// <para>Grouping only the four priced plans would give the same MRR — <c>PLAN_PRICES[plan] || 0</c>
    /// makes an unknown plan contribute nothing — but the aggregate is left total anyway, so a new plan
    /// added to the enum shows up in the count rather than silently vanishing.</para>
    /// </summary>
    private async Task<IReadOnlyList<PlanCount>> GetActivePlanCountsAsync(
        DateTime? createdAtMaxUtc,
        CancellationToken cancellationToken)
    {
        List<PlanCountRow> rows;

        if (createdAtMaxUtc is { } maxUtc)
        {
            var bound = new NpgsqlParameter("createdAtMax", NpgsqlDbType.Timestamp)
            {
                Value = PlatformDashboardTimestamps.ToNaive(maxUtc),
            };

            rows = await db.Database
                .SqlQuery<PlanCountRow>($"""
                    SELECT "plan"::text AS "Plan", COUNT(*)::bigint AS "Count"
                      FROM "subscriptions"
                     WHERE "status" = 'active' AND "created_at" <= {bound}
                     GROUP BY 1
                    """)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }
        else
        {
            rows = await db.Database
                .SqlQuery<PlanCountRow>($"""
                    SELECT "plan"::text AS "Plan", COUNT(*)::bigint AS "Count"
                      FROM "subscriptions"
                     WHERE "status" = 'active'
                     GROUP BY 1
                    """)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        return rows.Select(r => new PlanCount(r.Plan, checked((int)r.Count))).ToList();
    }

    public async Task<IReadOnlyList<RevenueOrgRow>> GetRevenueRowsAsync(
        DateTime thirtyDaysAgoUtc,
        CancellationToken cancellationToken)
    {
        var thirtyDaysAgo = PlatformDashboardTimestamps.ToNaive(thirtyDaysAgoUtc);

        var organizations = await db.Organizations.AsNoTracking()
            .Select(o => new { o.Id, o.Name })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var subscriptions = await db.Subscriptions.AsNoTracking()
            .Select(s => new { s.OrganizationId, s.Plan, s.Status })
            .ToDictionaryAsync(s => s.OrganizationId, cancellationToken)
            .ConfigureAwait(false);

        // TS selects EVERY invoice of every organization and filters twice in JavaScript. Narrowed here to
        // the rows that can land in EITHER bucket: a `void` invoice, and a `paid` one outside the window,
        // contribute to neither, so excluding them in SQL changes no output and keeps a platform-wide read
        // from materialising the entire invoice table. `status == "paid"` is a literal (TRAP 8 clear), and
        // the NULL-safe `paid_at >= bound` reproduces the TS truthiness guard — see PaidAt's docblock.
        var invoices = await db.Invoices.AsNoTracking()
            .Where(i => (i.Status == "paid" && i.PaidAt >= thirtyDaysAgo)
                || i.Status == "pending"
                || i.Status == "draft")
            .Select(i => new { i.OrganizationId, i.Amount, i.Currency, i.Status })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var invoicesByOrg = invoices
            .GroupBy(i => i.OrganizationId)
            .ToDictionary(g => g.Key, g => g.ToList());

        // ACTIVE users only (`where: { isActive: true }`), which is both the count and the source of the
        // lastActiveAt reduction. Max over a nullable column yields null for a group whose users have never
        // logged in — the same value the TS reduce's null seed produces.
        var userStats = await db.Users.AsNoTracking()
            .Where(u => u.IsActive && u.OrganizationId != null)
            .GroupBy(u => u.OrganizationId!.Value)
            .Select(g => new { OrgId = g.Key, Count = g.Count(), LastLoginAt = g.Max(u => u.LastLoginAt) })
            .ToDictionaryAsync(x => x.OrgId, cancellationToken)
            .ConfigureAwait(false);

        return organizations.Select(o =>
        {
            subscriptions.TryGetValue(o.Id, out var subscription);
            userStats.TryGetValue(o.Id, out var stats);
            invoicesByOrg.TryGetValue(o.Id, out var orgInvoices);

            var paid = orgInvoices?
                .Where(i => string.Equals(i.Status, "paid", StringComparison.Ordinal))
                .Select(i => new DashboardMoneyRow(i.Amount, i.Currency))
                .ToList() ?? [];

            var outstanding = orgInvoices?
                .Where(i => string.Equals(i.Status, "pending", StringComparison.Ordinal)
                    || string.Equals(i.Status, "draft", StringComparison.Ordinal))
                .Select(i => new DashboardMoneyRow(i.Amount, i.Currency))
                .ToList() ?? [];

            return new RevenueOrgRow(
                o.Id.ToString(),
                o.Name,
                subscription?.Plan,
                subscription?.Status,
                paid,
                outstanding,
                stats?.Count ?? 0,
                stats?.LastLoginAt);
        }).ToList();
    }

    public async Task<IReadOnlyList<ChurnOrgRow>> GetChurnRowsAsync(
        DateTime nowUtc,
        DateTime sevenDaysAgoUtc,
        CancellationToken cancellationToken)
    {
        var now = PlatformDashboardTimestamps.ToNaive(nowUtc);
        var sevenDaysAgo = PlatformDashboardTimestamps.ToNaive(sevenDaysAgoUtc);

        // `created_at` is the tenure signal, so unlike the customer-health query this one projects it.
        var organizations = await db.Organizations.AsNoTracking()
            .Select(o => new { o.Id, o.Name, o.CreatedAt })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var subscriptions = await db.Subscriptions.AsNoTracking()
            .Select(s => new { s.OrganizationId, s.Plan, s.Status, s.TrialEndsAt })
            .ToDictionaryAsync(s => s.OrganizationId, cancellationToken)
            .ConfigureAwait(false);

        // ROWS, not a count: the count feeds the invoice-health band and the same rows feed sumMoney.
        var overdueInvoices = await db.Invoices.AsNoTracking()
            .Where(i => i.Status == "pending" && i.DueDate < now)
            .Select(i => new { i.OrganizationId, i.Amount, i.Currency })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var overdueByOrg = overdueInvoices
            .GroupBy(i => i.OrganizationId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<DashboardMoneyRow>)g.Select(i => new DashboardMoneyRow(i.Amount, i.Currency)).ToList());

        var userStats = await db.Users.AsNoTracking()
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

        // `_count.featureFlags` — EVERY flag row for the organization, enabled or not.
        var featureCounts = await db.FeatureFlags.AsNoTracking()
            .GroupBy(f => f.OrganizationId)
            .Select(g => new { OrgId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.OrgId, x => x.Count, cancellationToken)
            .ConfigureAwait(false);

        return organizations.Select(o =>
        {
            subscriptions.TryGetValue(o.Id, out var subscription);
            userStats.TryGetValue(o.Id, out var stats);
            featureCounts.TryGetValue(o.Id, out var features);

            return new ChurnOrgRow(
                o.Id.ToString(),
                o.Name,
                o.CreatedAt,
                subscription?.Plan,
                subscription?.Status,
                subscription?.TrialEndsAt,
                overdueByOrg.TryGetValue(o.Id, out var rows) ? rows : [],
                stats?.Active ?? 0,
                stats?.Recent ?? 0,
                stats?.LastLoginAt,
                features);
        }).ToList();
    }
}
