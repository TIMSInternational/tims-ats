namespace Tims.Application.PlatformDashboard;

/// <summary>
/// The two per-organization roll-ups behind <c>getCustomerHealth</c> and <c>getUpsellOpportunities</c>
/// (Phase-5 slice 23, issue #81, PR 2 of 3).
/// </summary>
public interface IPlatformDashboardAccountsRepository
{
    /// <summary>
    /// One row per organization — <b>every</b> organization, with no <c>where</c> at all: the TS
    /// <c>findMany</c> filters neither <c>is_active</c> nor <c>deleted_at</c>, so suspended and
    /// soft-deleted tenants appear in the health list. Reproduced.
    ///
    /// <para>No ORDER BY, matching TS. The kernel then sorts by health band with a stable sort, so rows
    /// sharing a band come out in whatever order the database returned them — unspecified in both stacks
    /// and recorded as a parity caveat.</para>
    /// </summary>
    Task<IReadOnlyList<CustomerHealthOrgRow>> GetCustomerHealthRowsAsync(
        DateTime nowUtc,
        DateTime sevenDaysAgoUtc,
        CancellationToken cancellationToken);

    /// <summary>One row per ACTIVE organization (<c>where: { isActive: true }</c>), with the three
    /// unfiltered <c>_count</c> totals and the one filtered active-user count. No ORDER BY, matching TS.
    /// </summary>
    Task<IReadOnlyList<UpsellOrgRow>> GetUpsellRowsAsync(DateTime sevenDaysAgoUtc, CancellationToken cancellationToken);
}
