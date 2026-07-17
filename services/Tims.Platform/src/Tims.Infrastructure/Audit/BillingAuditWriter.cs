using Microsoft.Extensions.Logging;
using Tims.Application.Billing;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// The <c>audit_logs</c> billing writer (<see cref="IBillingAuditWriter"/>) — the FIRST C# writer to the
/// admin/security <c>audit_logs</c> ledger (distinct from the <c>data_access_logs</c> writer). A faithful port
/// of the TS <c>recordBillingAudit</c>: it APPENDS one row (<c>entity='billing'</c>) UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so the RLS WITH CHECK passes, attributed to
/// the real operator. BEST-EFFORT / fail-SOFT: any failure is swallowed (parity with the TS
/// <c>.catch(() =&gt; {})</c>) so a lost audit row never fails or rolls back the completed billing action.
/// INSERT-only — honors the CB-1b append-only immutability.
/// </summary>
public sealed class BillingAuditWriter(AuditLogDbContext db, ILogger<BillingAuditWriter>? logger = null) : IBillingAuditWriter
{
    private const string BillingEntity = "billing";

    private readonly AuditLogDbContext _db = db;
    private readonly ILogger<BillingAuditWriter>? _logger = logger;

    public async Task WriteAsync(
        string organizationId,
        string actorId,
        string action,
        System.Text.Json.Nodes.JsonObject metadata,
        CancellationToken cancellationToken)
    {
        try
        {
            var orgGuid = Guid.Parse(organizationId);

            await using var scope = await TenantScope.BeginAsync(_db, orgGuid, cancellationToken).ConfigureAwait(false);

            _db.AuditLogs.Add(new AuditLogEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = orgGuid,
                ActorId = Guid.Parse(actorId),
                Action = action,
                Entity = BillingEntity,
                Metadata = metadata.ToJsonString(),
            });

            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // fail-soft: the billing action (the Stripe call) already succeeded; a lost audit row must never
            // surface as a failure. Matches the TS recordBillingAudit best-effort .catch(() => {}). For the
            // SOC2 audit control a DROPPED audit write is observable — log a Warning (PII-free: action + org only).
            _logger?.LogWarning(ex, "billing audit write dropped (fail-soft): action={Action} org={OrganizationId}", action, organizationId);
        }
    }
}
