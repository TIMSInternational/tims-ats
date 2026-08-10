namespace Tims.Application.AlertMetrics;

/// <summary>
/// The read port for the alert-evaluation cron's two soon-to-flip metrics (§8 Q0b slice 2, issue #172).
///
/// Every method takes an EXPLICIT <paramref name="organizationId"/> because the caller is a platform-level
/// scheduled job with no tenant session — it iterates every org in one run. That explicit org is what the
/// implementation feeds to <c>TenantScope</c>, so each individual read is still RLS-scoped to exactly one
/// org; the caller's privilege is the right to NAME any org, NOT the right to bypass row-level security.
/// See <c>AlertMetricsReadRepository</c> for why that distinction is the whole design.
/// </summary>
public interface IAlertMetricsReadRepository
{
    /// <summary>COUNT(surveys WHERE organization_id = ? AND status = 'active').</summary>
    Task<int> CountActiveSurveysAsync(Guid organizationId, CancellationToken cancellationToken);

    /// <summary>COUNT(salary_adjustments WHERE organization_id = ? AND status = 'pending').</summary>
    Task<int> CountPendingSalaryAdjustmentsAsync(Guid organizationId, CancellationToken cancellationToken);
}
