using Tims.Application.Audit;
using Tims.Domain.Audit;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// The single data_access_log writer (<see cref="IDataAccessAuditor"/>) — the ONE legitimate,
/// append-only C# write. A faithful port of <c>logDataAccess</c> (packages/api/src/access/audit.ts):
///
///   1. Resolve the policy: <c>failClosed ?? (DataClassification.Of(entity) == Restricted)</c>.
///   2. Append ONE row UNDER the tenant path — <see cref="TenantScope"/> issues
///      <c>SET LOCAL ROLE app_tenant</c> + the org GUC (derived from the event's org) so the RLS
///      <c>WITH CHECK</c> passes for the caller's org before the INSERT runs.
///   3. On failure: fail-CLOSED → throw <see cref="AuditWriteFailedException"/> (caller aborts before
///      returning restricted data); fail-SOFT → swallow (one lost audit row must not block a read or
///      roll back a completed write).
///
/// A plain injected service, not a MediatR pipeline — the "single data_access_log writer" the design
/// calls for. The injected context is short-lived (scoped per request / per test); a swallowed failure
/// leaves it unused thereafter.
/// </summary>
public sealed class DataAccessAuditWriter(DataAccessAuditDbContext db) : IDataAccessAuditor
{
    public async Task LogAsync(
        DataAccessEvent auditEvent,
        bool? failClosed = null,
        CancellationToken cancellationToken = default)
    {
        var effectiveFailClosed =
            failClosed ?? DataClassification.Of(auditEvent.Entity) == DataClass.Restricted;

        try
        {
            // The write runs under the caller's org: a valid org GUC makes RLS WITH CHECK pass; an
            // unparseable org yields a null GUC (empty string) that the fail-closed policy rejects,
            // surfacing as a write failure the policy below handles.
            Guid? orgGuc = Guid.TryParse(auditEvent.OrganizationId, out var parsedOrg) ? parsedOrg : null;

            await using var scope = await TenantScope.BeginAsync(db, orgGuc, cancellationToken);

            db.DataAccessLogs.Add(new DataAccessLogEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = Guid.Parse(auditEvent.OrganizationId),
                ActorId = Guid.Parse(auditEvent.ActorId),
                DataType = auditEvent.Entity,
                RecordId = Guid.Parse(auditEvent.RecordId),
                Action = auditEvent.Action.ToWire(),
                IpAddress = auditEvent.IpAddress,
                UserAgent = auditEvent.UserAgent,
            });

            await db.SaveChangesAsync(cancellationToken);
            await scope.CommitAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not AuditWriteFailedException)
        {
            if (effectiveFailClosed)
            {
                throw new AuditWriteFailedException(ex);
            }

            // fail-soft: do not block the read / roll back the completed write.
        }
    }
}
