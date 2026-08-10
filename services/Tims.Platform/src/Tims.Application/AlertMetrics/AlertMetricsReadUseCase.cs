using System.Text.Json.Nodes;
using Tims.Application.Audit;
using Tims.Domain.Access;
using Tims.Domain.AlertMetrics;

namespace Tims.Application.AlertMetrics;

/// <summary>
/// Computes ONE metric for ONE org, applies the §21 min-5 floor, and audits the cross-org read
/// (§8 Q0b slice 2, issue #172).
///
/// <para><b>The floor is applied HERE, server-side</b> — the same <c>SENSITIVE_ALERT_METRICS</c> →
/// <c>suppressBelowMin5</c> composition the TS repository applies. Applying it in the caller only would
/// mean the C# surface could be used to route around the TS oracle guard: a 1..4 sensitive count leaves
/// this process as <c>Suppressed</c> with no number attached, so there is nothing on the wire to recover.
/// The TS caller floors again on receipt; the operation is idempotent (0 and >=5 pass through unchanged,
/// and a null never re-enters the floor), so belt-and-braces costs nothing.</para>
///
/// <para><b>Every read is audited.</b> A privileged cross-org read that leaves no trace is the gap the
/// platform-owner read precedent (<c>logSecurityEvent</c> / <see cref="ISecurityEventWriter"/>) exists to
/// close, and its absence was a finding against the previous attempt at this slice (PR #141). The row is
/// attributed to the org being read with a NULL actor — the caller is a machine with no user identity,
/// and inventing a sentinel user id would make a cron read indistinguishable from a human one in
/// incident review. The write is fail-SOFT by the writer's own contract: a lost audit row must not stop
/// the alert engine from evaluating a breach.</para>
/// </summary>
public sealed class AlertMetricsReadUseCase(
    IAlertMetricsReadRepository repository,
    ISecurityEventWriter securityEventWriter)
{
    /// <summary>
    /// The <c>audit_logs.action</c> literal for a cron-driven cross-org metric read. Distinct from the
    /// platform-owner read actions so the two callers are separable in an incident review.
    /// </summary>
    public const string AuditAction = "alert_metric_cron_read";

    /// <summary>The <c>audit_logs.entity</c> literal — the surface, not the underlying table.</summary>
    public const string AuditEntity = "alert_metric";

    private readonly IAlertMetricsReadRepository _repository = repository;
    private readonly ISecurityEventWriter _securityEventWriter = securityEventWriter;

    public async Task<AlertMetricOutcome> ComputeAsync(
        Guid organizationId, AlertMetric metric, CancellationToken cancellationToken)
    {
        var outcome = await ComputeOutcomeAsync(organizationId, metric, cancellationToken).ConfigureAwait(false);

        // Audit AFTER the read resolves so the row records what actually happened (including a
        // suppression), but BEFORE returning, so an unaudited cross-org read cannot be observed.
        await _securityEventWriter.WriteAsync(
            new SecurityEvent(
                OrganizationId: organizationId,
                ActorId: null,
                Action: AuditAction,
                Entity: AuditEntity,
                EntityId: AlertMetricKeys.ToKey(metric),
                Metadata: BuildMetadata(metric, outcome)),
            cancellationToken).ConfigureAwait(false);

        return outcome;
    }

    private async Task<AlertMetricOutcome> ComputeOutcomeAsync(
        Guid organizationId, AlertMetric metric, CancellationToken cancellationToken)
    {
        var raw = metric switch
        {
            AlertMetric.ActiveSurveys =>
                await _repository.CountActiveSurveysAsync(organizationId, cancellationToken).ConfigureAwait(false),
            AlertMetric.PendingSalaryAdjustments =>
                await _repository.CountPendingSalaryAdjustmentsAsync(organizationId, cancellationToken).ConfigureAwait(false),
            // Unreachable while AlertMetricKeys.TryParse is the only producer of an AlertMetric, but a NEW
            // enum member added without a handler must surface as Unavailable — never as a silent 0, which
            // the cron would read as "no breach" forever.
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

        var floored = KAnonymity.SuppressBelowMin5(raw.Value);
        return floored.Count is null
            ? new AlertMetricOutcome.Suppressed()
            : new AlertMetricOutcome.Value(floored.Count.Value);
    }

    /// <summary>
    /// The audit row's metadata. Records the OUTCOME KIND and whether the metric is sensitive — never the
    /// count itself. Putting the value here would recreate the exact sub-floor disclosure the min-5 floor
    /// just prevented, in a table built to be read by auditors.
    /// </summary>
    private static JsonObject BuildMetadata(AlertMetric metric, AlertMetricOutcome outcome) => new()
    {
        ["metric"] = AlertMetricKeys.ToKey(metric),
        ["sensitive"] = AlertMetricKeys.IsSensitive(metric),
        ["outcome"] = outcome switch
        {
            AlertMetricOutcome.Value => "value",
            AlertMetricOutcome.Suppressed => "suppressed",
            AlertMetricOutcome.Unavailable => "unavailable",
            _ => "unknown",
        },
    };
}
