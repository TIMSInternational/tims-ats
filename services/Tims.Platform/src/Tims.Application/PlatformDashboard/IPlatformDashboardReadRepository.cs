namespace Tims.Application.PlatformDashboard;

/// <summary>
/// Data access for the FX-free dashboard reads (Phase-5 slice 23 / issue #81, first PR). Cross-org by
/// construction and never tenant-scoped — the surface is platform-owner-only, exactly like the invitations
/// and organizations read repositories.
/// </summary>
public interface IPlatformDashboardReadRepository
{
    /// <summary><c>getPlanDistribution</c>: the <c>plan</c> of every subscription, unfiltered.</summary>
    Task<IReadOnlyList<string>> GetSubscriptionPlansAsync(CancellationToken cancellationToken);

    /// <summary>
    /// <c>getUserGrowth</c>: the per-month user-creation counts for the window <c>[from, ∞)</c>, grouped by
    /// <c>to_char(date_trunc('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM')</c>. The gap-filling to a
    /// fixed 6-bucket series is the use case's job, not the repository's.
    /// </summary>
    Task<IReadOnlyList<MonthCountRow>> GetUserGrowthCountsAsync(DateTime fromInclusiveUtc, CancellationToken cancellationToken);

    /// <summary><c>getRecentActivity</c>: the five most-recently-created organizations.</summary>
    Task<IReadOnlyList<RecentOrgRow>> GetRecentOrganizationsAsync(int take, CancellationToken cancellationToken);

    /// <summary><c>getRecentActivity</c>: the five most-recently-created users.</summary>
    Task<IReadOnlyList<RecentUserRow>> GetRecentUsersAsync(int take, CancellationToken cancellationToken);
}
