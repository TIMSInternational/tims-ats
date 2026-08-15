using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.PlatformDashboard;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// EF Core implementation of the FX-free dashboard READ surface (Phase-5 slice 23, issue #81, PR 1 of 3).
/// Cross-org by construction and never tenant-scoped — see <see cref="PlatformDashboardReadDbContext"/>
/// for why that is the requirement rather than a gap.
/// </summary>
public sealed class PlatformDashboardReadRepository(PlatformDashboardReadDbContext db)
    : IPlatformDashboardReadRepository
{
    /// <summary><c>getPlanDistribution</c>'s <c>findMany({ select: { plan: true } })</c> — every
    /// subscription row's plan, no filter, no order (the use case's seeded buckets impose the output
    /// order, so row order is irrelevant in both stacks).</summary>
    public async Task<IReadOnlyList<string>> GetSubscriptionPlansAsync(CancellationToken cancellationToken) =>
        await db.Subscriptions
            .AsNoTracking()
            .Select(s => s.Plan)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

    /// <summary>
    /// <c>getUserGrowth</c>'s <c>$queryRaw</c> month group-by — the first raw SQL in any C# read slice, so
    /// the two deliberate differences from the TS text are spelled out here:
    ///
    /// <para><b>1. <c>date_trunc('month', "created_at")</c>, not the TS
    /// <c>date_trunc('month', "created_at" AT TIME ZONE 'UTC')</c> — same result under prod conditions,
    /// immune to the session timezone.</b> <c>created_at</c> is <c>timestamp without time zone</c> holding
    /// naive-UTC instants (Prisma always writes UTC). The TS expression lifts it to <c>timestamptz</c>
    /// (interpreting it as UTC), and then BOTH <c>date_trunc</c> and <c>to_char</c> on a
    /// <c>timestamptz</c> render in the SESSION's <c>TimeZone</c> — so the TS bucket labels are only
    /// "UTC months" because the Prisma connection's session runs at the server default, UTC. Applying
    /// <c>date_trunc</c>/<c>to_char</c> directly to the naive column computes that same UTC month with no
    /// session-timezone dependence at all, so an Npgsql session whose <c>TimeZone</c> is not UTC (a dev
    /// machine, a container with TZ set) cannot shift a row created at <c>2026-08-01T02:00Z</c> into the
    /// July bucket. Reproducing the TS text verbatim would have IMPORTED that dependence, making the C#
    /// output diverge from TS exactly when the session TZ differs — the integration test seeds a
    /// row 30 minutes after a month boundary to pin this.</para>
    ///
    /// <para><b>2. Aliases <c>"Month"</c>/<c>"Count"</c>, not <c>month</c>/<c>count</c>.</b> EF's
    /// <c>SqlQuery&lt;T&gt;</c> materialises an unmapped type by matching column names to property names
    /// exactly; an alias changes no grouping and no value.</para>
    ///
    /// <para><b>The bound is an EXPLICIT <see cref="NpgsqlParameter"/> typed
    /// <see cref="NpgsqlDbType.Timestamp"/>.</b> A bare <see cref="DateTime"/> in the hole gets EF's
    /// default mapping, <c>timestamp with time zone</c> — under which a UTC-kind value would make Postgres
    /// lift the naive COLUMN at the session TZ for the comparison (the same hazard as (1), on the WHERE
    /// bound instead of the labels), and a re-kinded Unspecified value is rejected outright by Npgsql
    /// (<c>Cannot write DateTime with Kind=Unspecified to ... 'timestamp with time zone'</c> — the first
    /// attempt here did exactly that and 500d). Typing the parameter <c>timestamp</c> gives the direct
    /// naive comparison the TS query effectively performs.</para>
    ///
    /// <para>The interpolated hole is still a real parameter — <c>SqlQuery</c> takes a
    /// <c>FormattableString</c> and parameterises every hole (a <c>DbParameter</c> instance passes
    /// through as-is), the same guarantee as Prisma's tagged template. Nothing here is
    /// string-concatenated.</para>
    /// </summary>
    public async Task<IReadOnlyList<MonthCountRow>> GetUserGrowthCountsAsync(
        DateTime fromInclusiveUtc,
        CancellationToken cancellationToken)
    {
        var from = new NpgsqlParameter("from", NpgsqlDbType.Timestamp)
        {
            Value = DateTime.SpecifyKind(fromInclusiveUtc, DateTimeKind.Unspecified),
        };

        var rows = await db.Database
            .SqlQuery<UserGrowthCountRow>($"""
                SELECT to_char(date_trunc('month', "created_at"), 'YYYY-MM') AS "Month",
                       COUNT(*)::bigint AS "Count"
                  FROM "users"
                 WHERE "created_at" >= {from}
                 GROUP BY 1
                """)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        // TS converts each bigint with Number(r.count); `checked` so a count beyond int.MaxValue fails
        // loudly instead of wrapping (unreachable today, but a silent wrap would be a wrong chart).
        return rows.Select(r => new MonthCountRow(r.Month, checked((int)r.Count))).ToList();
    }

    /// <summary><c>getRecentActivity</c>'s <c>recentOrgs</c> — newest five, reproduced with NO tiebreaker
    /// because TS has none (ties on <c>created_at</c> have an unspecified order in both stacks). Guid→string
    /// happens after materialisation, matching the invitations repository's convention.</summary>
    public async Task<IReadOnlyList<RecentOrgRow>> GetRecentOrganizationsAsync(
        int take,
        CancellationToken cancellationToken)
    {
        var rows = await db.Organizations
            .AsNoTracking()
            .OrderByDescending(o => o.CreatedAt)
            .Take(take)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows.Select(o => new RecentOrgRow(o.Id.ToString(), o.Name, o.Plan, o.CreatedAt)).ToList();
    }

    /// <summary><c>getRecentActivity</c>'s <c>recentUsers</c> — newest five, no <c>where</c> (inactive and
    /// soft-deleted users included, exactly as TS). Runs AFTER the orgs query on the same DbContext where
    /// TS uses <c>Promise.all</c>; the reads are independent, so only simultaneity is lost — the same
    /// sequential-for-the-same-DbContext-reason note as the invitations KPIs.</summary>
    public async Task<IReadOnlyList<RecentUserRow>> GetRecentUsersAsync(
        int take,
        CancellationToken cancellationToken)
    {
        var rows = await db.Users
            .AsNoTracking()
            .OrderByDescending(u => u.CreatedAt)
            .Take(take)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(u => new RecentUserRow(u.Id.ToString(), u.FirstName, u.LastName, u.Email, u.CreatedAt, u.IsPlatformOwner))
            .ToList();
    }
}
