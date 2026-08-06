using Tims.Domain.AlertMetrics;

namespace Tims.Application.AlertMetrics;

/// <summary>
/// The PRIVILEGED, cross-org read port for the alert-evaluation cron. Every method takes an EXPLICIT
/// <paramref name="organizationId"/> — there is no ambient tenant here by construction, because the caller
/// is a platform-level scheduled job with no tenant session (see AlertMetricsDbContext for why this
/// intentionally runs outside TenantScope/RLS).
/// </summary>
public interface IAlertMetricsReadRepository
{
    /// <summary>COUNT(surveys WHERE organization_id = ? AND status = 'active').</summary>
    Task<int> CountActiveSurveysAsync(Guid organizationId, CancellationToken cancellationToken);

    /// <summary>COUNT(salary_adjustments WHERE organization_id = ? AND status = 'pending').</summary>
    Task<int> CountPendingSalaryAdjustmentsAsync(Guid organizationId, CancellationToken cancellationToken);
}

/// <summary>
/// Computes ONE metric for ONE org, applying the same §21 min-5 floor the TS repository applies
/// (<c>SENSITIVE_ALERT_METRICS</c> → <c>suppressBelowMin5</c>). The floor is applied HERE, server-side, so
/// the C# surface can never be used to route around the TS oracle guard: a 1..4 sensitive count leaves as
/// <c>Suppressed</c> with no number attached.
/// </summary>
public sealed class AlertMetricsReadUseCase(IAlertMetricsReadRepository repository)
{
    private readonly IAlertMetricsReadRepository _repository = repository;

    public async Task<AlertMetricOutcome> ComputeAsync(
        Guid organizationId, AlertMetric metric, CancellationToken cancellationToken)
    {
        var raw = metric switch
        {
            AlertMetric.ActiveSurveys =>
                await _repository.CountActiveSurveysAsync(organizationId, cancellationToken).ConfigureAwait(false),
            AlertMetric.PendingSalaryAdjustments =>
                await _repository.CountPendingSalaryAdjustmentsAsync(organizationId, cancellationToken).ConfigureAwait(false),
            // Unreachable while AlertMetricKeys.TryParse is the only producer of an AlertMetric, but a
            // NEW enum member added without a handler must surface as Unavailable — never as a silent 0,
            // which the cron would read as "no breach" forever.
            _ => (int?)null,
        };

        if (raw is null)
        {
            return new AlertMetricOutcome.Unavailable("no_handler");
        }

        if (!AlertMetricKeys.IsSensitive(metric))
        {
            return new AlertMetricOutcome.Value(raw.Value);
        }

        var floored = Domain.Access.KAnonymity.SuppressBelowMin5(raw.Value);
        return floored.Count is null
            ? new AlertMetricOutcome.Suppressed()
            : new AlertMetricOutcome.Value(floored.Count.Value);
    }
}
