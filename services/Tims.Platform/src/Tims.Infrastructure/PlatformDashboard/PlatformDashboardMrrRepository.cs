using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformDashboard;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// EF Core implementation of the MRR reads (Phase-5 slice 23, issue #81, PR 2 of 3).
/// </summary>
public sealed class PlatformDashboardMrrRepository(PlatformDashboardReadDbContext db)
    : IPlatformDashboardMrrRepository
{
    /// <summary>
    /// The <c>getMrrTrend</c> aggregate, which <c>getMrrForecast</c> reuses.
    ///
    /// <para><b>Raw SQL, and the same two deliberate departures from the TS text as slice 23's user-growth
    /// query:</b></para>
    ///
    /// <para><b>1. <c>date_trunc('month', "created_at")</c>, not the TS
    /// <c>date_trunc('month', "created_at" AT TIME ZONE 'UTC')</c>.</b> The column is
    /// <c>timestamp without time zone</c> holding naive-UTC instants. The TS form lifts it to
    /// <c>timestamptz</c> and then renders in the SESSION's timezone, so its labels are UTC months only
    /// because Prisma's session runs UTC. Applying <c>date_trunc</c>/<c>to_char</c> directly to the naive
    /// column computes the same UTC month with no session dependence; copying the TS text would IMPORT a
    /// dependence C# does not otherwise have.</para>
    ///
    /// <para><b>2. Aliases <c>"Month"</c>/<c>"Plan"</c>/<c>"Count"</c>.</b> <c>SqlQuery&lt;T&gt;</c>
    /// matches column names to property names EXACTLY; an alias changes no grouping and no value.</para>
    ///
    /// <para><b>And one departure of its own: <c>"plan"::text</c>.</b> The TS query returns the raw enum
    /// and lets the Prisma driver stringify it. Casting in SQL means no native enum value ever reaches the
    /// reader on this path, so the aggregate does not depend on <c>EnableUnmappedTypes</c> — belt and
    /// braces next to a data source that supplies it anyway. Grouping on the cast text is the same
    /// partition as grouping on the enum.</para>
    ///
    /// <para><b>The status filter is a bare literal.</b> TS writes
    /// <c>"status" = ${SubscriptionStatus.active}::"SubscriptionStatus"</c> — a parameter with an explicit
    /// cast, needed because Prisma binds it as text. Nothing here is caller-supplied, so a literal is both
    /// simpler and equivalent: Postgres coerces an unknown-typed literal to the column's enum type. There
    /// is no interpolation of any kind in this statement.</para>
    /// </summary>
    public async Task<IReadOnlyList<ActivePlanMonthCount>> GetActiveSubscriptionPlanMonthCountsAsync(
        CancellationToken cancellationToken)
    {
        var rows = await db.Database
            .SqlQuery<ActivePlanMonthCountRow>($"""
                SELECT to_char(date_trunc('month', "created_at"), 'YYYY-MM') AS "Month",
                       "plan"::text AS "Plan",
                       COUNT(*)::bigint AS "Count"
                  FROM "subscriptions"
                 WHERE "status" = 'active'
                 GROUP BY 1, 2
                 ORDER BY 1
                """)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        // TS converts each bigint with Number(r.count); `checked` so a count beyond int.MaxValue fails
        // loudly instead of wrapping into a negative subscriber count.
        return rows.Select(r => new ActivePlanMonthCount(r.Month, r.Plan, checked((int)r.Count))).ToList();
    }

    /// <summary>A literal enum comparison again — see the aggregate's note.</summary>
    public async Task<int> CountTrialingSubscriptionsAsync(CancellationToken cancellationToken) =>
        await db.Subscriptions
            .AsNoTracking()
            .CountAsync(s => s.Status == "trialing", cancellationToken)
            .ConfigureAwait(false);
}
