using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using Tims.Application.Audit;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// See <see cref="ISecurityEventWriter"/>'s doc comment for the full rationale (new sibling to
/// <see cref="BillingAuditWriter"/>'s implementation, not a replacement). Writes under
/// <see cref="TenantScope"/> for the event's organization, so forced RLS does not depend on
/// the connection login holding BYPASSRLS. Callers include resolved staff, platform owners and API keys. Reuses
/// <see cref="AuditLogEntity"/>/<see cref="AuditLogDbContext"/> verbatim.
///
/// <para><b>#181 — guaranteed write with bounded retry.</b> A security-audit row is attempted up to
/// <see cref="MaxAttempts"/> times on a TRANSIENT failure (connection reset, pool timeout, the per-attempt
/// timeout), with a short backoff. The row id is fixed before the first attempt, so a retry after a commit whose
/// acknowledgement was lost hits the primary key and is recognised as already-written rather than duplicating the
/// row. Deterministic failures (missing table, privilege, constraint) are not retried — they cannot succeed.
/// When the row is finally lost the writer logs at ERROR with the stable event id <see cref="RowLostEventId"/>,
/// never a WARNING, so a dropped audit row is alertable rather than buried. The caller's request still never
/// fails because of it (fail-soft contract), and the caller's cancellation token is not used by the denial
/// middlewares, so a disconnecting client cannot cancel its own row.</para>
///
/// <para>The IP and user agent are normalized through <see cref="AuditAttribution"/> before persisting.</para>
/// </summary>
public sealed class SecurityEventWriter(AuditLogDbContext db, ILogger<SecurityEventWriter>? logger = null) : ISecurityEventWriter
{
    /// <summary>Total attempts on a transient failure (1 initial + 2 retries).</summary>
    public const int MaxAttempts = 3;

    /// <summary>Stable id of the "security audit row lost" log line — alert on it.</summary>
    public static readonly EventId RowLostEventId = new(18101, "SecurityAuditRowLost");

    private static readonly TimeSpan AttemptTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan[] Backoff = [TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(250)];

    private readonly AuditLogDbContext _db = db;
    private readonly ILogger<SecurityEventWriter>? _logger = logger;

    public async Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken)
    {
        var rowId = Guid.NewGuid();
        for (var attempt = 1; ; attempt++)
        {
            // Bound each attempt independently of a disconnected HTTP caller. Denial middleware supplies
            // CancellationToken.None so the request cannot erase its audit.
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(AttemptTimeout);
            try
            {
                await WriteOnceAsync(rowId, securityEvent, timeout.Token).ConfigureAwait(false);
                return;
            }
            catch (Exception ex) when (attempt > 1 && IsDuplicateOfThisRow(ex))
            {
                // A previous attempt committed but its acknowledgement was lost: the row exists. Done.
                return;
            }
            catch (Exception ex) when (attempt < MaxAttempts
                && !cancellationToken.IsCancellationRequested
                && IsTransient(ex, timeout.IsCancellationRequested))
            {
                _logger?.LogWarning(ex, "security event write attempt {Attempt} failed transiently; retrying: action={Action} org={OrganizationId}",
                    attempt, securityEvent.Action, securityEvent.OrganizationId);
                _db.ChangeTracker.Clear();
                try
                {
                    await Task.Delay(Backoff[attempt - 1], cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    LogLost(ex, securityEvent, attempt);
                    return;
                }
            }
            catch (Exception ex)
            {
                // fail-soft: a lost security-audit row must never block the caller's mutation/read — but it is
                // never silent either.
                LogLost(ex, securityEvent, attempt);
                return;
            }
        }
    }

    private async Task WriteOnceAsync(Guid rowId, SecurityEvent securityEvent, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(
            _db, securityEvent.OrganizationId, cancellationToken).ConfigureAwait(false);

        _db.AuditLogs.Add(new AuditLogEntity
        {
            Id = rowId,
            OrganizationId = securityEvent.OrganizationId,
            ActorId = securityEvent.ActorId,
            Action = securityEvent.Action,
            Entity = securityEvent.Entity,
            EntityId = securityEvent.EntityId,
            Metadata = securityEvent.Metadata?.ToJsonString(),
            IpAddress = AuditAttribution.Ip(securityEvent.IpAddress),
            UserAgent = AuditAttribution.UserAgent(securityEvent.UserAgent),
        });

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private void LogLost(Exception ex, SecurityEvent securityEvent, int attempts) =>
        _logger?.LogError(RowLostEventId, ex,
            "SECURITY AUDIT ROW LOST after {Attempts} attempt(s): action={Action} entity={Entity} org={OrganizationId}",
            attempts, securityEvent.Action, securityEvent.Entity, securityEvent.OrganizationId);

    /// <summary>
    /// Transient = the attempt's own timeout fired, or Npgsql classifies the failure as transient (I/O, socket,
    /// timeout). A PostgresException (a server-side error such as a missing relation or a policy violation) is
    /// deterministic and never retried.
    /// </summary>
    internal static bool IsTransient(Exception ex, bool attemptTimedOut)
    {
        if (ex is OperationCanceledException) return attemptTimedOut;
        for (var current = ex; current is not null; current = current.InnerException)
        {
            if (current is PostgresException) return false;
            if (current is NpgsqlException { IsTransient: true } or TimeoutException) return true;
        }

        return false;
    }

    private static bool IsDuplicateOfThisRow(Exception ex)
    {
        for (var current = ex; current is not null; current = current.InnerException)
        {
            if (current is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg
                && pg.ConstraintName is { } constraint
                && constraint.StartsWith("audit_logs_pkey", StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }
}
