using System.Globalization;

namespace Tims.Application.PlatformDashboard;

/// <summary>
/// The FX-free platform dashboard reads (Phase-5 slice 23 / issue #81, first PR). Thin over
/// <see cref="IPlatformDashboardReadRepository"/>; what genuinely lives here is the pure shaping logic —
/// plan bucketing, the month-series kernel, the Spanish month names and the recent-activity merge — all of
/// which unit-test against a golden fixture shared with the TS suite, without a database or a web host.
/// </summary>
public sealed class PlatformDashboardReadUseCase(IPlatformDashboardReadRepository repository)
{
    /// <summary>The <c>getUserGrowth</c> window: six month-buckets ending at the current month.</summary>
    public const int GrowthMonths = 6;

    /// <summary>The <c>getRecentActivity</c> per-source fetch (5 orgs, 5 users) and final slice (10).</summary>
    public const int RecentSourceTake = 5;
    public const int RecentActivityTake = 10;

    /// <summary>
    /// The four plan buckets <c>getPlanDistribution</c> seeds, IN THIS ORDER. A subscription whose plan is
    /// none of these is appended after them (JS object insertion order), so the output can exceed four rows
    /// — reproduced rather than clamped.
    /// </summary>
    private static readonly string[] SeedPlans = ["trial", "starter", "professional", "enterprise"];

    /// <summary>
    /// Spanish SHORT month names, index 0 = January, EXACTLY as Node's
    /// <c>toLocaleDateString('es', { month: 'short' })</c> emits them — including <c>"sept"</c> for
    /// September, which is four characters and is where a <c>CultureInfo("es")</c> lookup would diverge.
    /// Pinned byte-for-byte against <c>contracts/dashboard-fixtures/dashboard-kernels.json</c>.
    /// </summary>
    private static readonly string[] SpanishShortMonths =
        ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

    public static string SpanishShortMonth(int monthIndexZeroBased) => SpanishShortMonths[monthIndexZeroBased];

    /// <summary>
    /// JS <c>Math.round</c>, which rounds a <c>.5</c> toward +∞ — NOT .NET's <c>Math.Round</c> default,
    /// which is banker's rounding (to-even) and would make <c>Math.Round(2.5) == 2</c> where JS gives 3.
    /// Percentages here are non-negative, so <see cref="MidpointRounding.AwayFromZero"/> matches JS exactly
    /// (away-from-zero and toward-+∞ coincide for non-negative inputs). Spelled out because the silent
    /// banker's default is the natural mistake and a guaranteed divergence on any exact <c>.5</c>.
    /// </summary>
    public static int JsRound(double value) => (int)Math.Round(value, MidpointRounding.AwayFromZero);

    // ── getPlanDistribution ──────────────────────────────────────────────────────────────────────────
    public async Task<IReadOnlyList<PlanDistributionItem>> GetPlanDistributionAsync(CancellationToken cancellationToken)
    {
        var plans = await repository.GetSubscriptionPlansAsync(cancellationToken).ConfigureAwait(false);
        return BuildPlanDistribution(plans);
    }

    /// <summary>
    /// Buckets subscription plans into the seeded four (plus any unknown plan, appended in first-seen order)
    /// and computes each percentage. <c>total = subs.length || 1</c> — the <c>|| 1</c> avoids a divide-by-
    /// zero on an empty table AND changes the denominator only when there are zero rows, so every count is
    /// itself zero and every percentage is 0. Reproduced exactly.
    /// </summary>
    public static IReadOnlyList<PlanDistributionItem> BuildPlanDistribution(IReadOnlyList<string> plans)
    {
        // A Dictionary seeded in SeedPlans order; a List tracks insertion order so an unknown plan lands
        // AFTER the four seeds, matching JS object key order.
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var seed in SeedPlans)
        {
            counts[seed] = 0;
            order.Add(seed);
        }

        foreach (var plan in plans)
        {
            if (!counts.ContainsKey(plan))
            {
                counts[plan] = 0;
                order.Add(plan);
            }

            counts[plan]++;
        }

        var total = plans.Count == 0 ? 1 : plans.Count;
        return order.Select(plan => new PlanDistributionItem(plan, counts[plan], JsRound((double)counts[plan] / total * 100))).ToList();
    }

    // ── getUserGrowth ────────────────────────────────────────────────────────────────────────────────
    public async Task<IReadOnlyList<UserGrowthPoint>> GetUserGrowthAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        // `sixMonthsAgo = Date.UTC(now.year, now.month - 5, 1)` — the first day of the bucket five months
        // before the current one. JS Date arithmetic normalises a negative month across the year boundary;
        // DateTime AddMonths does the same.
        var from = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(-(GrowthMonths - 1));
        var rows = await repository.GetUserGrowthCountsAsync(from, cancellationToken).ConfigureAwait(false);
        return BuildUserGrowth(rows, nowUtc);
    }

    /// <summary>Fills the raw month rows into a fixed six-bucket series, then labels each bucket with its
    /// Spanish short month name (as <c>getUserGrowth</c>'s final <c>.map</c> does).</summary>
    public static IReadOnlyList<UserGrowthPoint> BuildUserGrowth(IReadOnlyList<MonthCountRow> rows, DateTime nowUtc)
    {
        return MonthSeries(rows, GrowthMonths, nowUtc)
            .Select(bucket =>
            {
                // bucket.Month is "YYYY-MM"; the TS builds a UTC Date from it and formats the month.
                var parts = bucket.Month.Split('-');
                var monthZeroBased = int.Parse(parts[1], CultureInfo.InvariantCulture) - 1;
                return new UserGrowthPoint(SpanishShortMonth(monthZeroBased), bucket.Count);
            })
            .ToList();
    }

    /// <summary>
    /// Port of <c>buildMonthSeries</c> (<c>routers/platform/time-series.ts</c>): exactly <paramref
    /// name="months"/> buckets, oldest-first, gaps filled with 0, ending at <paramref name="endNowUtc"/>'s
    /// calendar month. Golden-fixtured against the TS kernel via <c>dashboard-kernels.json</c>.
    /// </summary>
    public static IReadOnlyList<MonthCountRow> MonthSeries(IReadOnlyList<MonthCountRow> rows, int months, DateTime endNowUtc)
    {
        if (months <= 0)
        {
            return [];
        }

        var lookup = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var r in rows)
        {
            lookup[r.Month] = r.Count; // last-write-wins, matching JS `new Map(rows.map(...))`
        }

        var result = new List<MonthCountRow>(months);
        var endYear = endNowUtc.Year;
        var endMonthZeroBased = endNowUtc.Month - 1;

        for (var i = months - 1; i >= 0; i--)
        {
            var year = endYear;
            var month = endMonthZeroBased - i;
            while (month < 0)
            {
                month += 12;
                year -= 1;
            }

            var key = $"{year}-{(month + 1).ToString("D2", CultureInfo.InvariantCulture)}";
            result.Add(new MonthCountRow(key, lookup.TryGetValue(key, out var c) ? c : 0));
        }

        return result;
    }

    // ── getRecentActivity ────────────────────────────────────────────────────────────────────────────
    public async Task<IReadOnlyList<RecentActivityItem>> GetRecentActivityAsync(CancellationToken cancellationToken)
    {
        // TS fetches recentOrgs, recentUsers AND recentAudit in parallel, but the audit rows are NEVER used
        // in the output — a dead fetch. It is deliberately NOT reproduced here: it would require mapping
        // audit_logs for zero observable effect on the payload. Recorded as a divergence in the slice doc.
        var orgs = await repository.GetRecentOrganizationsAsync(RecentSourceTake, cancellationToken).ConfigureAwait(false);
        var users = await repository.GetRecentUsersAsync(RecentSourceTake, cancellationToken).ConfigureAwait(false);
        return BuildRecentActivity(orgs, users);
    }

    /// <summary>
    /// Merges orgs then users into one list, sorts by timestamp descending, and takes 10. The sort must be
    /// STABLE and the pre-sort order must be orgs-then-users: TS pushes all orgs, then all users, then calls
    /// <c>Array.prototype.sort</c> (stable since ES2019), so two items with the same timestamp keep
    /// orgs-before-users. <c>OrderByDescending</c> is a stable sort in .NET, so building the list in the same
    /// order and applying it reproduces the tiebreak.
    /// </summary>
    public static IReadOnlyList<RecentActivityItem> BuildRecentActivity(
        IReadOnlyList<RecentOrgRow> orgs,
        IReadOnlyList<RecentUserRow> users)
    {
        var activity = new List<RecentActivityItem>(orgs.Count + users.Count);

        foreach (var org in orgs)
        {
            activity.Add(new RecentActivityItem(org.Id, "org_created", $"Nueva organizacion: {org.Name}", org.CreatedAt, org.Plan));
        }

        foreach (var user in users)
        {
            activity.Add(new RecentActivityItem(
                user.Id,
                user.IsPlatformOwner ? "platform_owner" : "user_created",
                $"Nuevo usuario: {user.FirstName} {user.LastName}",
                user.CreatedAt,
                user.Email));
        }

        return activity
            .OrderByDescending(a => a.Timestamp) // stable in .NET — preserves orgs-before-users on a tie
            .Take(RecentActivityTake)
            .ToList();
    }
}
