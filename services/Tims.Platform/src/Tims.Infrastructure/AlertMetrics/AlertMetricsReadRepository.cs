using Microsoft.EntityFrameworkCore;
using Tims.Application.AlertMetrics;

namespace Tims.Infrastructure.AlertMetrics;

/// <summary>
/// The two COUNT queries behind the cross-org alert-metric surface, ported 1:1 from
/// packages/api/src/repositories/alert-evaluation.repository.ts (`db.survey.count` and
/// `db.salaryAdjustment.count` — the SAME status literals, the SAME org filter). Scalar counts only:
/// nothing this repository can return identifies a row.
/// </summary>
public sealed class AlertMetricsReadRepository(AlertMetricsDbContext db) : IAlertMetricsReadRepository
{
    private const string ActiveStatus = "active";
    private const string PendingStatus = "pending";

    private readonly AlertMetricsDbContext _db = db;

    public Task<int> CountActiveSurveysAsync(Guid organizationId, CancellationToken cancellationToken) =>
        _db.Surveys.AsNoTracking()
            .Where(s => s.OrganizationId == organizationId && s.Status == ActiveStatus)
            .CountAsync(cancellationToken);

    public Task<int> CountPendingSalaryAdjustmentsAsync(Guid organizationId, CancellationToken cancellationToken) =>
        _db.SalaryAdjustments.AsNoTracking()
            .Where(a => a.OrganizationId == organizationId && a.Status == PendingStatus)
            .CountAsync(cancellationToken);
}
