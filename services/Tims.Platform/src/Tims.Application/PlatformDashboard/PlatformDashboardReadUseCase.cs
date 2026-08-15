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
    /// The <c>getMrrTrend</c> / <c>getMrrForecast</c> label —
    /// <c>toLocaleDateString('es', { month: 'short', year: '2-digit' })</c>. A DIFFERENT format from
    /// <see cref="SpanishShortMonth"/> and a separate ICU trap: Node composes it as the short month, one
    /// ASCII space, then the year modulo 100 ZERO-PADDED to two digits (<c>"ene 00"</c> for the year 2000,
    /// not <c>"ene 0"</c>). Pinned case-by-case against real Node output via
    /// <c>spanishShortMonthYear2Cases</c> in <c>contracts/dashboard-fixtures/dashboard-kernels.json</c>.
    ///
    /// <para>The <c>((y % 100) + 100) % 100</c> dance is for years before AD 1 only; it costs nothing and
    /// keeps the expression total rather than silently emitting <c>"-5"</c>.</para>
    /// </summary>
    public static string SpanishShortMonthYear2(int year, int monthIndexZeroBased) =>
        SpanishShortMonth(monthIndexZeroBased)
        + " "
        + (((year % 100) + 100) % 100).ToString("D2", CultureInfo.InvariantCulture);

    /// <summary>
    /// JS <c>Math.round</c>: round half toward <b>+∞</b>. NOT .NET's <c>Math.Round</c> default, which is
    /// banker's rounding (to-even) and would make <c>Math.Round(2.5) == 2</c> where JS gives 3.
    ///
    /// <para><b>Implemented as <c>floor(value + 0.5)</c> rather than
    /// <see cref="MidpointRounding.AwayFromZero"/>.</b> The two rules agree on every non-negative input and
    /// disagree on negative midpoints: JS <c>Math.round(-125.5)</c> is <c>-125</c>, away-from-zero gives
    /// <c>-126</c>.</para>
    ///
    /// <para><b>No caller can currently reach a negative, and the honest reason to change it anyway is
    /// that the argument for why not is subtle.</b> <c>getMrrForecast</c> looked like the counter-example
    /// — its growth rate is capped at <c>-0.2</c> and feeds <c>Math.round(avgGrowthRate * 100 * 10)</c> —
    /// but its historical series is a cumulative count over a filter that only widens month by month, so
    /// it is monotone NON-DECREASING, every month-over-month rate is ≥ 0, and both the lower cap and the
    /// negative rounding are dead code in the TS procedure too. That reachability argument depends on a
    /// property of a query somewhere else; encoding JS's actual rule costs nothing and does not.</para>
    /// </summary>
    public static int JsRound(double value) => (int)Math.Floor(value + 0.5);

    /// <summary><see cref="JsRound"/> for money totals, which <c>getMrrForecast</c> compounds twelve
    /// months forward before rounding. A JS number carries every integer below 2^53 exactly; narrowing to
    /// <see cref="int"/> would wrap silently at a value this expression can in principle reach, and a
    /// wrapped MRR forecast is worse than a large one.</summary>
    public static long JsRoundToInt64(double value) => (long)Math.Floor(value + 0.5);

    /// <summary>
    /// <c>Number.prototype.toLocaleString()</c> called with NO locale argument, as
    /// <c>dashboard.helpers.ts</c> does when it formats an overdue invoice amount INTO a description
    /// string. ICU resolves the default locale to <c>en-US</c> in the Node runtime this platform ships
    /// (verified, and asserted out loud by <c>tests/parity/dashboard-fixtures.test.ts</c>), giving
    /// comma group separators, a dot decimal separator, no minimum fraction digits and a maximum of three.
    /// <c>"#,##0.###"</c> under <see cref="CultureInfo.InvariantCulture"/> is that exact rule.
    ///
    /// <para><b>This is an ENVIRONMENT dependency, not just a format.</b> Under an <c>es</c> default the
    /// same number renders <c>1234,5</c> and every overdue-invoice description would differ between the
    /// stacks. It cannot be defended against from this side — the TS call takes no locale — so the golden
    /// pins it instead, and the parity surface header records it as an operational caveat.</para>
    /// </summary>
    public static string JsToLocaleString(double value) =>
        value.ToString("#,##0.###", CultureInfo.InvariantCulture);

    /// <summary>Milliseconds in a day — the literal <c>1000 * 60 * 60 * 24</c> the TS day math divides by.
    /// </summary>
    public const double MillisecondsPerDay = 86_400_000d;

    /// <summary>
    /// JS <c>new Date()</c>: the current instant at INTEGER-MILLISECOND precision.
    /// <see cref="DateTime.UtcNow"/> carries 100-nanosecond ticks, and the sub-millisecond remainder would
    /// leak into every <c>Math.floor(msDiff / 86400000)</c> day count and into every timestamp comparison
    /// bound. Truncating reproduces the JS clock's resolution exactly; it is fidelity, not rounding.
    /// </summary>
    public static DateTime JsNow() => TruncateToMilliseconds(DateTime.UtcNow);

    /// <summary>Drops the sub-millisecond tick remainder, preserving <see cref="DateTime.Kind"/>. The same
    /// expression the write repositories use before binding a <c>timestamp(3)</c> column.</summary>
    public static DateTime TruncateToMilliseconds(DateTime value) =>
        value.AddTicks(-(value.Ticks % TimeSpan.TicksPerMillisecond));

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
                var (_, monthZeroBased) = ParseMonthBucketKey(bucket.Month);
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

        return MonthBucketKeys(months, endNowUtc)
            .Select(key => new MonthCountRow(key, lookup.TryGetValue(key, out var c) ? c : 0))
            .ToList();
    }

    /// <summary>
    /// The <c>YYYY-MM</c> bucket keys for a window of <paramref name="months"/> ending at
    /// <paramref name="endNowUtc"/>'s calendar month, OLDEST FIRST.
    ///
    /// <para>Three procedures build this same list from three different pieces of JS —
    /// <c>getUserGrowth</c> via <c>buildMonthSeries</c>, <c>getMrrTrend</c> with an inline
    /// <c>while (mon &lt; 0) { mon += 12; year -= 1 }</c> loop, and <c>getMrrForecast</c> with
    /// <c>start.setMonth(start.getMonth() - i, 1)</c>. All three are the same arithmetic; keeping one
    /// implementation here means a boundary bug cannot be fixed in one procedure and left in another.</para>
    ///
    /// <para><b>UTC months.</b> <c>getUserGrowth</c> and <c>getMrrTrend</c> say so explicitly
    /// (<c>getUTCFullYear</c>/<c>getUTCMonth</c>); <c>getMrrForecast</c> uses LOCAL month arithmetic and
    /// therefore agrees only because the production Node process runs at UTC — the same standing
    /// assumption slice 23's raw SQL recorded, restated in the slice doc rather than silently relied on.
    /// </para>
    /// </summary>
    public static IReadOnlyList<string> MonthBucketKeys(int months, DateTime endNowUtc)
    {
        if (months <= 0)
        {
            return [];
        }

        var result = new List<string>(months);
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

            result.Add($"{year}-{(month + 1).ToString("D2", CultureInfo.InvariantCulture)}");
        }

        return result;
    }

    /// <summary>Splits a <c>YYYY-MM</c> bucket key back into its year and ZERO-BASED month index — the
    /// form <see cref="SpanishShortMonth"/> and <see cref="SpanishShortMonthYear2"/> take.</summary>
    public static (int Year, int MonthIndexZeroBased) ParseMonthBucketKey(string key)
    {
        var parts = key.Split('-');
        return (
            int.Parse(parts[0], CultureInfo.InvariantCulture),
            int.Parse(parts[1], CultureInfo.InvariantCulture) - 1);
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
