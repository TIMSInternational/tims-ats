namespace Tims.Domain.AlertMetrics;

/// <summary>
/// The subset of the TS <c>ALERT_METRIC_KEYS</c> registry (packages/shared/src/constants/index.ts:108)
/// that this cross-org read surface serves. Deliberately NOT the whole registry: only the two metrics
/// whose tables are moving to C# ownership (`surveys` → flip #64, `salary_adjustments` → flip #66) need
/// a C# reader. Everything else stays on the TS Prisma path.
///
/// The wire values are the EXACT TS keys, so a rule's persisted <c>condition.metric</c> is usable as the
/// query parameter with no translation table to drift.
/// </summary>
public enum AlertMetric
{
    /// <summary>`active_surveys` — COUNT(surveys WHERE organization_id = ? AND status = 'active').</summary>
    ActiveSurveys,

    /// <summary>
    /// `pending_salary_adjustments` — COUNT(salary_adjustments WHERE organization_id = ? AND status = 'pending').
    /// SENSITIVE: computed over a §21-restricted model, so the raw count is passed through the min-5 floor
    /// before it leaves the service (see <see cref="AlertMetricOutcome"/>).
    /// </summary>
    PendingSalaryAdjustments,
}

/// <summary>
/// Parses / renders the wire form of <see cref="AlertMetric"/>. Kept in Domain (not the endpoint) so the
/// TS-key contract has exactly one definition.
/// </summary>
public static class AlertMetricKeys
{
    public const string ActiveSurveys = "active_surveys";
    public const string PendingSalaryAdjustments = "pending_salary_adjustments";

    /// <summary>
    /// The METRICS THAT ARE SENSITIVE — computed over one of the four §21-restricted models. Mirrors the TS
    /// <c>SENSITIVE_ALERT_METRICS</c> set (alert-evaluation.repository.ts). `active_surveys` counts survey
    /// DEFINITIONS, not responses, so it is not restricted; `pending_salary_adjustments` counts
    /// SalaryAdjustment rows, which is.
    /// </summary>
    public static bool IsSensitive(AlertMetric metric) => metric == AlertMetric.PendingSalaryAdjustments;

    /// <summary>Fail-closed parse: an unrecognized key yields false, never a silent default metric.</summary>
    public static bool TryParse(string? key, out AlertMetric metric)
    {
        switch (key)
        {
            case ActiveSurveys:
                metric = AlertMetric.ActiveSurveys;
                return true;
            case PendingSalaryAdjustments:
                metric = AlertMetric.PendingSalaryAdjustments;
                return true;
            default:
                metric = default;
                return false;
        }
    }

    public static string ToKey(AlertMetric metric) => metric switch
    {
        AlertMetric.ActiveSurveys => ActiveSurveys,
        AlertMetric.PendingSalaryAdjustments => PendingSalaryAdjustments,
        _ => throw new ArgumentOutOfRangeException(nameof(metric), metric, "unmapped alert metric"),
    };
}

/// <summary>
/// The C# analog of the TS <c>AlertMetricOutcome</c> union (packages/api/src/repositories/
/// alert-evaluation.repository.ts). Three states, deliberately distinguishable:
/// <list type="bullet">
///   <item><c>Value</c> — computed, safe to compare against a threshold;</item>
///   <item><c>Suppressed</c> — a §21 min-5 sub-floor count was floored. NOT an error. The count itself is
///     NEVER put on the wire, because an alert rule is an exact-count oracle;</item>
///   <item><c>Unavailable</c> — could not be computed at all. The caller MUST make this visible; a silent
///     skip here is exactly the failure this whole surface exists to prevent.</item>
/// </list>
/// </summary>
public abstract record AlertMetricOutcome
{
    private AlertMetricOutcome()
    {
    }

    public sealed record Value(int Count) : AlertMetricOutcome;

    public sealed record Suppressed : AlertMetricOutcome;

    public sealed record Unavailable(string Reason) : AlertMetricOutcome;
}
