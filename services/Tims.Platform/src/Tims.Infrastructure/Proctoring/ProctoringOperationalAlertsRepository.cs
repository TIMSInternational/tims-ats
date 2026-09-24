using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tims.Domain.Proctoring;

namespace Tims.Infrastructure.Proctoring;

/// <summary>
/// Creates an inbox notification for each operational signal and currently authorized
/// reviewer. Both the signal write and the fan-out run under tenant RLS. A durable
/// delivery receipt is written atomically with the inbox row, so retries, replicas,
/// and user deletion of a notification cannot cause a second delivery.
/// </summary>
public sealed class ProctoringOperationalAlertsRepository(ProctoringDbContext db)
{
    private const int MaximumOrganizations = 1_000;
    private const int MaximumGapBatch = 25;
    private const int MaximumNotificationBatch = 100;
    private const int MaximumNotificationBatches = 10;
    private readonly ProctoringDbContext _db = db;

    /// <summary>
    /// Privileged bootstrap returns organization IDs only. No candidate or signal data
    /// crosses the tenant boundary; each organization is processed under TenantScope.
    /// Seven days is the operational retry window, matching beta evidence retention.
    /// </summary>
    public Task<Guid[]> ListActiveOrganizationIdsAsync(CancellationToken ct)
    {
        var since = UtcTimestamp().AddDays(-7);
        var expiredReceipt = UtcTimestamp().AddDays(-8);
        return _db.Database.SqlQuery<Guid>($"""
            SELECT organization_id AS "Value" FROM proctoring_sessions
             WHERE ended_at IS NULL
            UNION
            SELECT organization_id AS "Value" FROM proctoring_events
             WHERE occurred_at >= {Timestamp(since)}
               AND type IN ('heartbeat_gap', 'camera_stopped', 'screen_share_stopped')
            UNION
            SELECT organization_id AS "Value" FROM proctoring_alert_deliveries
             WHERE delivered_at < {Timestamp(expiredReceipt)}
            ORDER BY "Value" LIMIT {MaximumOrganizations}
            """).ToArrayAsync(ct);
    }

    public async Task<ProctoringOperationalAlertResult> RunOrganizationAsync(
        Guid organizationId, CancellationToken ct)
    {
        if (organizationId == Guid.Empty)
            throw new ArgumentOutOfRangeException(nameof(organizationId));

        var gaps = await RecordHeartbeatGapsAsync(organizationId, ct);
        var created = 0;
        for (var batch = 0; batch < MaximumNotificationBatches; batch++)
        {
            var count = await DeliverNotificationBatchAsync(organizationId, ct);
            created += count;
            if (count < MaximumNotificationBatch) break;
        }
        await DeleteExpiredReceiptsAsync(organizationId, ct);
        return new ProctoringOperationalAlertResult(gaps, created);
    }

    private async Task<int> RecordHeartbeatGapsAsync(Guid organizationId, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var now = UtcTimestamp();
        var staleBefore = now.AddSeconds(-ProctoringSignalPolicy.HeartbeatGapSeconds);
        // The row lock serializes this inference with candidate heartbeat/completion.
        // SKIP LOCKED keeps one slow candidate transaction from blocking the sweep.
        var due = await _db.Database.SqlQuery<GapCandidate>($"""
            SELECT s.id AS "SessionId", s.started_at AS "StartedAt",
                   s.last_heartbeat_at AS "LastHeartbeatAt"
              FROM proctoring_sessions s
              JOIN assessment_assignments a ON a.id = s.assignment_id
                 AND a.organization_id = {organizationId}
             WHERE s.organization_id = {organizationId}
               AND s.ended_at IS NULL AND s.consented_at IS NOT NULL
               AND a.status = 'in_progress'
               AND COALESCE(s.last_heartbeat_at, s.started_at) < {Timestamp(staleBefore)}
               AND NOT EXISTS (
                 SELECT 1 FROM proctoring_events e
                  WHERE e.organization_id = {organizationId}
                    AND e.session_id = s.id AND e.type = 'heartbeat_gap'
                    AND e.occurred_at >= COALESCE(s.last_heartbeat_at, s.started_at))
             ORDER BY COALESCE(s.last_heartbeat_at, s.started_at), s.id
             LIMIT {MaximumGapBatch}
             FOR UPDATE OF s SKIP LOCKED
            """).ToListAsync(ct);

        var inserted = 0;
        foreach (var session in due)
        {
            var previous = session.LastHeartbeatAt ?? session.StartedAt;
            var signalId = Guid.NewGuid();
            var dedupeId = HeartbeatGapId(session.SessionId, previous);
            var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO proctoring_events
                  (id, organization_id, session_id, client_event_id, type,
                   source, severity, client_at, occurred_at)
                VALUES ({signalId}, {organizationId}, {session.SessionId}, {dedupeId},
                  'heartbeat_gap', 'server_inferred', 'medium', NULL, {Timestamp(now)})
                ON CONFLICT (session_id, client_event_id) DO NOTHING
                """, ct);
            if (count != 1) continue;
            inserted++;
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE proctoring_sessions
                   SET flag_count = flag_count + 1, severity = 'medium',
                       updated_at = {Timestamp(now)}
                 WHERE id = {session.SessionId} AND organization_id = {organizationId}
                   AND ended_at IS NULL
                """, ct);
        }
        await tenant.CommitAsync(ct);
        return inserted;
    }

    private async Task<int> DeliverNotificationBatchAsync(Guid organizationId, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var since = UtcTimestamp().AddDays(-7);
        // The role and unit join is deliberately done again on every retry: a
        // revoked reviewer must not receive a pending signal after revocation.
        // Receipt and notification INSERTs are one PostgreSQL statement inside
        // the tenant transaction. Any failure rolls both back.
        var summaries = await _db.Database.SqlQuery<DeliverySummary>($"""
            WITH pending AS MATERIALIZED (
              SELECT md5('proctoring-alert:v1:' || e.id::text || ':' || u.id::text)::uuid AS notification_id,
                     u.id AS user_id, e.type, a.id AS assignment_id, a.candidate_id,
                     e.occurred_at, e.id AS event_id
                FROM proctoring_events e
                JOIN proctoring_sessions s ON s.id = e.session_id
                  AND s.organization_id = {organizationId}
                JOIN assessment_assignments a ON a.id = s.assignment_id
                  AND a.organization_id = {organizationId}
                JOIN vacancies v ON v.id = a.vacancy_id
                  AND v.organization_id = {organizationId} AND v.deleted_at IS NULL
                JOIN users u ON u.organization_id = {organizationId}
                  AND u.is_active AND u.deleted_at IS NULL
               WHERE e.organization_id = {organizationId}
                 AND e.occurred_at >= {Timestamp(since)}
                 AND ((e.type = 'heartbeat_gap' AND e.source = 'server_inferred')
                   OR (e.type IN ('camera_stopped', 'screen_share_stopped')
                     AND e.source = 'client_observation'))
                 AND EXISTS (
                   SELECT 1 FROM user_roles ur
                   JOIN roles r ON r.id = ur.role_id
                     AND r.organization_id = {organizationId} AND r.is_active
                   JOIN role_permissions rp ON rp.role_id = r.id
                   JOIN permissions p ON p.id = rp.permission_id
                     AND p.module = 'assessment' AND p.action = 'read'
                  WHERE ur.user_id = u.id
                    AND (ur.expires_at IS NULL OR ur.expires_at > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
                    AND (ur.company_scope IS NULL OR ur.company_scope = v.company_id)
                    AND (ur.unit_scope IS NULL OR ur.unit_scope = v.business_unit_id)
                    AND ((r.slug IN ('super_admin', 'hr_admin')
                           AND rp.scope = 'organization')
                      OR (r.slug = 'hrbp' AND rp.scope = 'unit'
                          AND v.business_unit_id IS NOT NULL
                          AND EXISTS (
                            SELECT 1 FROM user_business_units ubu
                            JOIN business_units bu ON bu.id = ubu.business_unit_id
                              AND bu.organization_id = {organizationId} AND bu.is_active
                            WHERE ubu.organization_id = {organizationId}
                              AND ubu.user_id = u.id
                              AND ubu.business_unit_id = v.business_unit_id)))
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM proctoring_alert_deliveries d
                    WHERE d.organization_id = {organizationId}
                      AND d.event_id = e.id AND d.user_id = u.id)
               ORDER BY e.occurred_at, e.id, u.id
               LIMIT {MaximumNotificationBatch}
            ), receipts AS (
              INSERT INTO proctoring_alert_deliveries
                (id, organization_id, event_id, user_id, notification_id)
              SELECT notification_id, {organizationId}, event_id, user_id, notification_id
                FROM pending
              ON CONFLICT (event_id, user_id) DO NOTHING
              RETURNING notification_id
            ), sent AS (
              INSERT INTO notifications
                (id, organization_id, user_id, type, title, message, module,
                 entity_type, entity_id, action_url)
              SELECT p.notification_id, {organizationId}, p.user_id, 'warning',
                     'Proctoring signal needs review',
                     CASE p.type
                       WHEN 'heartbeat_gap' THEN 'Assessment heartbeat was interrupted. Review the session.'
                       WHEN 'camera_stopped' THEN 'The browser reported a stopped camera track. Review the session.'
                       ELSE 'The browser reported stopped screen sharing. Review the session.'
                     END,
                     'assessment', 'assessmentAssignment', p.assignment_id,
                     '/recruitment/candidates/' || p.candidate_id::text
                FROM pending p
                JOIN receipts r ON r.notification_id = p.notification_id
              ON CONFLICT (id) DO NOTHING
              RETURNING id
            )
            SELECT (SELECT count(*) FROM receipts)::integer AS "Receipts",
                   (SELECT count(*) FROM sent)::integer AS "Notifications"
            """).ToListAsync(ct);
        var summary = summaries.Single();
        if (summary.Receipts != summary.Notifications)
            throw new InvalidOperationException("Proctoring receipt and inbox insertion diverged");
        await tenant.CommitAsync(ct);
        return summary.Notifications;
    }

    private async Task DeleteExpiredReceiptsAsync(Guid organizationId, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var before = UtcTimestamp().AddDays(-8);
        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM proctoring_alert_deliveries
             WHERE id IN (
               SELECT id FROM proctoring_alert_deliveries
                WHERE organization_id = {organizationId}
                  AND delivered_at < {Timestamp(before)}
                ORDER BY delivered_at, id LIMIT 1000
             ) AND organization_id = {organizationId}
            """, ct);
        await tenant.CommitAsync(ct);
    }

    internal static Guid HeartbeatGapId(Guid sessionId, DateTime previous)
    {
        // Keep byte-for-byte parity with CandidateProctoringRepository.GapEventId.
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{sessionId}:{previous:O}:gap"));
        return new Guid(bytes.AsSpan(0, 16));
    }

    private static DateTime UtcTimestamp()
    {
        var utc = DateTime.UtcNow;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)),
            DateTimeKind.Unspecified);
    }

    private static NpgsqlParameter Timestamp(DateTime value) => new()
    {
        NpgsqlDbType = NpgsqlDbType.Timestamp,
        Value = value,
    };

    private sealed class GapCandidate
    {
        public Guid SessionId { get; set; }
        public DateTime StartedAt { get; set; }
        public DateTime? LastHeartbeatAt { get; set; }
    }

    private sealed class DeliverySummary
    {
        public int Receipts { get; set; }
        public int Notifications { get; set; }
    }
}

public sealed record ProctoringOperationalAlertResult(int HeartbeatGaps, int InboxNotifications);
