namespace Tims.Domain.AlertMetrics;

/// <summary>
/// The subset of the TS <c>ALERT_METRIC_KEYS</c> registry (packages/shared/src/constants) that the
/// cross-org alert-metric read surface serves (§8 Q0b slice 2, issue #172). Deliberately NOT the whole
/// registry: only the two metrics whose tables are moving to C# ownership need a C# reader —
/// <c>surveys</c> (flip #64) and <c>salary_adjustments</c> (flip #66). Everything else
/// (<c>headcount</c>, <c>active_alerts</c>, <c>vacancies_open_60d</c>, <c>sla_active_breaches</c>) stays
/// on the TS Prisma path because none of those tables flip.
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
/// Parses / renders the wire form of <see cref="AlertMetric"/>, and owns the sensitivity classification.
/// Kept in Domain (not the endpoint) so the TS-key contract has exactly one definition, and so the
/// cross-stack golden (contracts/alert-metrics-fixtures/cases.json) can assert it directly.
/// </summary>
public static class AlertMetricKeys
{
    public const string ActiveSurveys = "active_surveys";
    public const string PendingSalaryAdjustments = "pending_salary_adjustments";

    /// <summary>
    /// The metrics that are SENSITIVE — computed over one of the four §21-restricted models. Mirrors the
    /// TS <c>SENSITIVE_ALERT_METRICS</c> set (packages/api/src/repositories/alert-evaluation.repository.ts).
    /// <c>active_surveys</c> counts survey DEFINITIONS, not responses, so it is not restricted;
    /// <c>pending_salary_adjustments</c> counts SalaryAdjustment rows, which is.
    ///
    /// A divergence between this and the TS set is a real disclosure bug in one direction, so the two are
    /// pinned to one shared golden rather than eyeballed.
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

    /// <summary>
    /// Every key this surface serves. Exposed so the golden-fixture test can assert the fixture covers the
    /// WHOLE served set — a metric added here without a fixture row must turn the suite red, otherwise the
    /// golden silently stops being a contract for the new key.
    /// </summary>
    public static IReadOnlyList<string> All { get; } = [ActiveSurveys, PendingSalaryAdjustments];
}

/// <summary>
/// The outcome of computing one metric for one org. Three states, deliberately distinguishable:
/// <list type="bullet">
///   <item><c>Value</c> — computed, safe to compare against a threshold;</item>
///   <item><c>Suppressed</c> — a §21 min-5 sub-floor count was floored. NOT an error. The count itself is
///     NEVER put on the wire, because an alert rule is an exact-count oracle: a rule
///     <c>metric eq 3</c> that fires recovers a sub-floor count over a restricted population without ever
///     calling a read endpoint;</item>
///   <item><c>Unavailable</c> — could not be computed at all. The caller MUST make this visible; a silent
///     coercion to 0 here reads as "no breach" forever, which is the exact silent-failure class this
///     surface exists to close.</item>
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
