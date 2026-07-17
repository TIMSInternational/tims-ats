using System.Text.Json.Nodes;

namespace Tims.Application.Billing;

/// <summary>
/// Writes an attributable audit record for a self-service billing action (portal open / cancel) to
/// <c>audit_logs</c> — a faithful port of the TS <c>recordBillingAudit</c> (billing.repository.ts). BEST-EFFORT
/// / fail-soft: a lost audit row must NEVER fail the completed billing action (the Stripe side already ran).
/// The action is attributed to the REAL operator (<paramref name="actorId"/> = impersonator during
/// impersonation); the impersonated account is carried inside the metadata, never misattributed.
/// </summary>
public interface IBillingAuditWriter
{
    /// <summary>Append one <c>audit_logs</c> row (<c>entity='billing'</c>). Never throws (fail-soft).</summary>
    Task WriteAsync(string organizationId, string actorId, string action, JsonObject metadata, CancellationToken cancellationToken);
}
