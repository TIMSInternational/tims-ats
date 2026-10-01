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
/// <see cref="MaxAttempts"/> times on a TRANSIENT failure (connection reset or a terminated backend, a per-attempt
/// timeout, a transient Postgres state), with a short backoff, all inside ONE overall deadline of
/// <see cref="OverallDeadline"/> — so the worst case this adds to a denied request is bounded (~5 s, only while the
/// database is failing). The row id is fixed before the first attempt, so a retry after a commit whose
/// acknowledgement was lost hits the primary key and is recognised as already-written rather than duplicating the
/// row. Deterministic failures (missing table, privilege, constraint) and connection-POOL exhaustion are not
/// retried — the first cannot succeed, and retrying the second only adds load to an already saturated pool.
/// When the row is finally lost the writer logs at ERROR with the stable event id <see cref="RowLostEventId"/>.
/// The caller's request still never fails because of it (fail-soft contract).</para>
///
/// <para><b>Shared-context hygiene.</b> <see cref="AuditLogDbContext"/> is SCOPED and shared with
/// <see cref="BillingAuditWriter"/> and any later security write in the same request. The entity added by an
/// attempt is detached on EVERY exit path (success, dedupe, retry, final loss), so a failed attempt can never
/// leave a stale Added entity that the next SaveChanges on the same context would trip over.</para>
///
/// <para>The IP and user agent are normalized through <see cref="AuditAttribution"/> before persisting.</para>
/// </summary>
public sealed class SecurityEventWriter(AuditLogDbContext db, ILogger<SecurityEventWriter>? logger = null) : ISecurityEventWriter
{
    /// <summary>Total attempts on a transient failure (1 initial + 2 retries), all inside <see cref="OverallDeadline"/>.</summary>
    public const int MaxAttempts = 3;

    /// <summary>Upper bound on the whole write, every attempt and backoff included.</summary>
    public static readonly TimeSpan OverallDeadline = TimeSpan.FromSeconds(5);

    /// <summary>Stable id of the "security audit row lost" log line — alert on it.</summary>
    public static readonly EventId RowLostEventId = new(18101, "SecurityAuditRowLost");

    private static readonly TimeSpan AttemptTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan[] Backoff = [TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(250)];

    private readonly AuditLogDbContext _db = db;
    private readonly ILogger<SecurityEventWriter>? _logger = logger;

    public async Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken)
    {
        var rowId = Guid.NewGuid();
        using var overall = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        overall.CancelAfter(OverallDeadline);
        for (var attempt = 1; ; attempt++)
        {
            // Bound each attempt independently of a disconnected HTTP caller (denial middleware supplies
            // CancellationToken.None) and inside the overall deadline.
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(overall.Token);
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
                && !overall.IsCancellationRequested
                && IsTransient(ex, timeout.IsCancellationRequested))
            {
                _logger?.LogWarning(ex, "security event write attempt {Attempt} failed transiently; retrying: action={Action} org={OrganizationId}",
                    attempt, securityEvent.Action, securityEvent.OrganizationId);
                try
                {
                    await Task.Delay(Backoff[attempt - 1], overall.Token).ConfigureAwait(false);
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
        var entity = new AuditLogEntity
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
        };
        try
        {
            await using var scope = await TenantScope.BeginAsync(
                _db, securityEvent.OrganizationId, cancellationToken).ConfigureAwait(false);
            _db.AuditLogs.Add(entity);
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            // Every exit path — see "Shared-context hygiene" on the class.
            _db.Entry(entity).State = EntityState.Detached;
        }
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
            if (IsPoolExhaustion(current)) return false;
            // A server-side error is transient only for the states Npgsql itself classifies so — e.g. 57P01
            // admin_shutdown (a terminated backend), serialization/deadlock. Constraint/privilege/missing-relation
            // errors are not.
            if (current is PostgresException pg) return pg.IsTransient;
            if (current is NpgsqlException { IsTransient: true } or TimeoutException) return true;
        }

        return false;
    }

    /// <summary>
    /// The client pool is saturated (Npgsql's "connection pool has been exhausted", or the server's 53300
    /// too_many_connections). Retrying would queue more work on the exact resource that is out — never retried.
    /// </summary>
    internal static bool IsPoolExhaustion(Exception ex) =>
        ex is PostgresException { SqlState: PostgresErrorCodes.TooManyConnections }
        || (ex is NpgsqlException && ex.Message.Contains("pool has been exhausted", StringComparison.OrdinalIgnoreCase));

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
