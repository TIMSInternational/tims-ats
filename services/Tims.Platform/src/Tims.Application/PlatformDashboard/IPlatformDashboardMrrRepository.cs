namespace Tims.Application.PlatformDashboard;

/// <summary>
/// The reads behind <c>getMrrTrend</c> and <c>getMrrForecast</c> (Phase-5 slice 23, issue #81, PR 2 of 3).
/// </summary>
public interface IPlatformDashboardMrrRepository
{
    /// <summary>
    /// <c>SELECT month, plan, COUNT(*) FROM subscriptions WHERE status = 'active' GROUP BY 1, 2</c> over
    /// the FULL history — no date lower bound, because the trend reconstructs a cumulative MRR snapshot at
    /// each of twelve month boundaries and needs every subscription that predates the window.
    /// </summary>
    Task<IReadOnlyList<ActivePlanMonthCount>> GetActiveSubscriptionPlanMonthCountsAsync(CancellationToken cancellationToken);

    /// <summary><c>db.subscription.count({ where: { status: trialing } })</c> — the forecast's
    /// "pending upgrades" figure.</summary>
    Task<int> CountTrialingSubscriptionsAsync(CancellationToken cancellationToken);
}
