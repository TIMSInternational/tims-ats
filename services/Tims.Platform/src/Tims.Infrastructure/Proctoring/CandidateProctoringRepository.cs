using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.Proctoring;
using Tims.Domain.Proctoring;

namespace Tims.Infrastructure.Proctoring;

/// <summary>
/// One tenant transaction per candidate operation. Every assignment probe uses
/// organization + candidate + assignment, and event writes are idempotent
/// INSERTs into the append-only RLS table. No media is stored here.
/// </summary>
public sealed class CandidateProctoringRepository(ProctoringDbContext db) : ICandidateProctoringRepository
{
    private readonly ProctoringDbContext _db = db;

    public Task<Guid?> ResolveOrganizationBySlugAsync(string slug, CancellationToken ct) =>
        _db.Organizations.AsNoTracking()
            .Where(o => o.Slug == slug && o.IsActive && o.DeletedAt == null)
            .Select(o => (Guid?)o.Id).FirstOrDefaultAsync(ct);

    public async Task<ProctoringStartResult> StartAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        string? ipAddress, string? userAgent, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, orgId, ct);
        var assignment = await OwnedAssignmentAsync(orgId, candidateId, assignmentId, ct);
        if (!assignment.ProctoringRequired)
            throw new ProctoringException(ProctoringError.Conflict, "proctoring_not_required");
        if (!await _db.Entitlements.AsNoTracking().AnyAsync(e =>
            e.OrganizationId == orgId && e.ModuleCode == "proctoring" && e.Enabled, ct))
            throw new ProctoringException(ProctoringError.Forbidden, "entitlement_missing:proctoring");
        var now = DbNow();
        if (assignment.ExpiresAt is { } expiry && expiry < now)
            throw new ProctoringException(ProctoringError.Conflict, "assignment_expired");
        if (assignment.Status is not ("assigned" or "in_progress"))
            throw new ProctoringException(ProctoringError.Conflict, "assignment_not_startable");

        // Non-repudiation: first acceptance wins; retries do not change the
        // assessment consent time or IP. The separate proctoring consent is on
        // the session and likewise written only on first INSERT.
        var consentId = Guid.NewGuid();
        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO assessment_consents
              (id, organization_id, assignment_id, candidate_id, consent_type, text_version,
               agreed_at, ip_address, user_agent, created_at, updated_at)
            VALUES ({consentId}, {orgId}, {assignmentId}, {candidateId}, 'habeas_data',
              {ProctoringSignalPolicy.AssessmentConsentVersion}, {Timestamp(now)}, {ipAddress}, {userAgent}, {Timestamp(now)}, {Timestamp(now)})
            ON CONFLICT (assignment_id) DO NOTHING
            """, ct);

        if (assignment.Status == "assigned")
        {
            var changed = await _db.Assignments
                .Where(a => a.Id == assignmentId && a.OrganizationId == orgId
                    && a.CandidateId == candidateId && a.Status == "assigned"
                    && a.ProctoringRequired)
                .ExecuteUpdateAsync(update => update
                    .SetProperty(a => a.Status, "in_progress")
                    .SetProperty(a => a.StartedAt, now)
                    .SetProperty(a => a.UpdatedAt, now), ct);
            if (changed == 0)
            {
                // Another start may have won the row lock. Treat that as a
                // resume only if the same owned assignment is now in progress.
                assignment = await OwnedAssignmentAsync(orgId, candidateId, assignmentId, ct);
                if (assignment.Status != "in_progress" || !assignment.ProctoringRequired)
                    throw new ProctoringException(ProctoringError.Conflict, "assignment_start_race");
            }
        }

        var startedAt = assignment.StartedAt ?? now;
        var sessionId = Guid.NewGuid();
        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO proctoring_sessions
              (id, organization_id, assignment_id, started_at, consented_at, consent_version,
               last_heartbeat_at, flag_count, review_status, created_at, updated_at)
            VALUES ({sessionId}, {orgId}, {assignmentId}, {Timestamp(startedAt)}, {Timestamp(now)},
              {ProctoringSignalPolicy.ConsentVersion}, {Timestamp(now)}, 0, 'unreviewed', {Timestamp(now)}, {Timestamp(now)})
            ON CONFLICT (assignment_id) DO NOTHING
            """, ct);
        var session = await _db.Sessions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.OrganizationId == orgId && s.AssignmentId == assignmentId, ct);
        if (session is null || session.EndedAt is not null)
            throw new ProctoringException(ProctoringError.Conflict, "proctoring_session_ended");
        await tenant.CommitAsync(ct);
        return new ProctoringStartResult(session.Id, "active", session.StartedAt);
    }

    public async Task<ProctoringEventResult> ReportEventAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        Guid eventId, string type, string severity, DateTime? clientAt, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, orgId, ct);
        var session = await ActiveOwnedSessionAsync(orgId, candidateId, assignmentId, ct);
        var now = DbNow();
        await LockActiveSessionAsync(orgId, session.Id, now, ct);
        await RecordGapIfNeededAsync(orgId, session, now, ct);
        if (type == "media_capture_stopped")
        {
            // Withdrawal is committed in the same transaction as the event.
            // It takes effect even if the ordinary signal cap was reached.
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE proctoring_sessions
                   SET media_stopped_at = COALESCE(media_stopped_at, {Timestamp(now)}),
                       updated_at = {Timestamp(now)}
                 WHERE id = {session.Id} AND organization_id = {orgId}
                   AND ended_at IS NULL
                """, ct);
            var alreadyReported = await _db.Events.AsNoTracking().AnyAsync(e =>
                e.OrganizationId == orgId && e.SessionId == session.Id &&
                e.Type == "media_capture_stopped", ct);
            var accepted = !alreadyReported && await InsertEventAsync(orgId,
                session.Id, eventId, type, "client_observation", severity,
                clientAt, now, ct) == 1;
            if (accepted)
                await IncrementSummaryAsync(orgId, session.Id, severity, now, ct);
            await tenant.CommitAsync(ct);
            return new ProctoringEventResult(accepted, eventId);
        }
        var currentCount = await _db.Sessions.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && s.Id == session.Id)
            .Select(s => s.FlagCount).SingleAsync(ct);
        if (currentCount >= ProctoringSignalPolicy.MaximumEventsPerSession)
        {
            var duplicate = await _db.Events.AsNoTracking().AnyAsync(e =>
                e.OrganizationId == orgId && e.SessionId == session.Id && e.ClientEventId == eventId, ct);
            if (!duplicate)
                throw new ProctoringException(ProctoringError.TooManyRequests, "proctoring_signal_limit");
            await tenant.CommitAsync(ct);
            return new ProctoringEventResult(false, eventId);
        }
        var inserted = await InsertEventAsync(orgId, session.Id, eventId, type,
            "client_observation", severity, clientAt, now, ct);
        if (inserted == 1) await IncrementSummaryAsync(orgId, session.Id, severity, now, ct);
        await tenant.CommitAsync(ct);
        return new ProctoringEventResult(inserted == 1, eventId);
    }

    public async Task<ProctoringHeartbeatResult> HeartbeatAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, orgId, ct);
        var session = await ActiveOwnedSessionAsync(orgId, candidateId, assignmentId, ct);
        var now = DbNow();
        await LockActiveSessionAsync(orgId, session.Id, now, ct);
        await RecordGapIfNeededAsync(orgId, session, now, ct);
        await tenant.CommitAsync(ct);
        return new ProctoringHeartbeatResult(now, true);
    }

    public async Task<ProctoringCompleteResult> CompleteAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, orgId, ct);
        var assignment = await OwnedAssignmentAsync(orgId, candidateId, assignmentId, ct);
        if (assignment.Status != "completed")
            throw new ProctoringException(ProctoringError.Conflict, "assignment_not_completed");
        var session = await _db.Sessions.AsNoTracking().FirstOrDefaultAsync(s =>
            s.OrganizationId == orgId && s.AssignmentId == assignmentId, ct);
        if (session is null)
            throw new ProctoringException(ProctoringError.Conflict, "proctoring_session_missing");
        if (session.EndedAt is { } ended)
        {
            await tenant.CommitAsync(ct);
            return new ProctoringCompleteResult(session.Id, "completed", ended);
        }
        // A malformed legacy completed assignment may have no completed_at.
        // Use a stable fallback so staff queue pagination cannot reorder when
        // this session is reconciled.
        var endTime = assignment.CompletedAt ?? session.StartedAt;
        if (endTime < session.StartedAt) endTime = session.StartedAt;
        if (!await LockSessionForCompletionAsync(orgId, session.Id, ct))
        {
            // A concurrent completion won the row lock. Return its persisted
            // end time instead of appending a late observation.
            var winner = await _db.Sessions.AsNoTracking().FirstOrDefaultAsync(s =>
                s.OrganizationId == orgId && s.Id == session.Id, ct);
            if (winner?.EndedAt is not { } winnerEnd)
                throw new ProctoringException(ProctoringError.Conflict, "proctoring_session_ended");
            await tenant.CommitAsync(ct);
            return new ProctoringCompleteResult(session.Id, "completed", winnerEnd);
        }
        await RecordGapIfNeededAsync(orgId, session, endTime, ct);
        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_sessions SET ended_at = {Timestamp(endTime)}, updated_at = {Timestamp(DbNow())}
            WHERE id = {session.Id} AND organization_id = {orgId} AND ended_at IS NULL
            """, ct);
        await tenant.CommitAsync(ct);
        return new ProctoringCompleteResult(session.Id, "completed", endTime);
    }

    /// <summary>
    /// Repairs lost client completion calls after the authoritative assessment
    /// submission committed. Queue reads repair at most 100 sessions per call;
    /// assignment-specific evidence reads repair only their requested session.
    /// </summary>
    public Task<int> ReconcileCompletedForOrganizationAsync(Guid orgId, Guid? assignmentId,
        CancellationToken ct) => ReconcileCompletedAsync(orgId,
            assignmentId is { } id ? [id] : null, ct);

    public Task<int> ReconcileCompletedForAssignmentsAsync(Guid orgId,
        IReadOnlyCollection<Guid> assignmentIds, CancellationToken ct)
    {
        if (assignmentIds.Count > 100)
            throw new ArgumentOutOfRangeException(nameof(assignmentIds), "At most 100 assignments per repair batch.");
        return assignmentIds.Count == 0 ? Task.FromResult(0)
            : ReconcileCompletedAsync(orgId, assignmentIds, ct);
    }

    private async Task<int> ReconcileCompletedAsync(Guid orgId,
        IReadOnlyCollection<Guid>? assignmentIds, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, orgId, ct);
        var pending = await (from session in _db.Sessions.AsNoTracking()
                             join assignment in _db.Assignments.AsNoTracking()
                                 on session.AssignmentId equals assignment.Id
                             where session.OrganizationId == orgId && assignment.OrganizationId == orgId
                                 && session.EndedAt == null && assignment.Status == "completed"
                                 && (assignmentIds == null || assignmentIds.Contains(assignment.Id))
                             orderby assignment.CompletedAt, session.Id
                             select new { Session = session, assignment.CompletedAt })
            .Take(assignmentIds?.Count ?? 100).ToListAsync(ct);
        var repaired = 0;
        foreach (var row in pending)
        {
            var endTime = row.CompletedAt ?? row.Session.StartedAt;
            if (endTime < row.Session.StartedAt) endTime = row.Session.StartedAt;
            if (!await LockSessionForCompletionAsync(orgId, row.Session.Id, ct)) continue;
            await RecordGapIfNeededAsync(orgId, row.Session, endTime, ct);
            repaired += await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE proctoring_sessions SET ended_at = {Timestamp(endTime)}, updated_at = {Timestamp(DbNow())}
                WHERE id = {row.Session.Id} AND organization_id = {orgId} AND ended_at IS NULL
                """, ct);
        }
        await tenant.CommitAsync(ct);
        return repaired;
    }

    private async Task<ProctoringAssignmentRow> OwnedAssignmentAsync(Guid orgId, Guid candidateId,
        Guid assignmentId, CancellationToken ct) =>
        await _db.Assignments.AsNoTracking().FirstOrDefaultAsync(a =>
            a.Id == assignmentId && a.OrganizationId == orgId && a.CandidateId == candidateId, ct)
        ?? throw new ProctoringException(ProctoringError.NotFound, "assignment_not_found");

    private async Task<ProctoringSessionRow> ActiveOwnedSessionAsync(Guid orgId, Guid candidateId,
        Guid assignmentId, CancellationToken ct)
    {
        var assignment = await OwnedAssignmentAsync(orgId, candidateId, assignmentId, ct);
        if (assignment.Status != "in_progress")
            throw new ProctoringException(ProctoringError.Conflict, "assignment_not_in_progress");
        var session = await _db.Sessions.AsNoTracking().FirstOrDefaultAsync(s =>
            s.OrganizationId == orgId && s.AssignmentId == assignmentId && s.EndedAt == null, ct);
        return session ?? throw new ProctoringException(ProctoringError.Conflict, "proctoring_session_not_active");
    }

    private async Task LockActiveSessionAsync(Guid orgId, Guid sessionId, DateTime now, CancellationToken ct)
    {
        var changed = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_sessions SET last_heartbeat_at = {Timestamp(now)}, updated_at = {Timestamp(now)}
            WHERE id = {sessionId} AND organization_id = {orgId} AND ended_at IS NULL
            """, ct);
        if (changed != 1)
            throw new ProctoringException(ProctoringError.Conflict, "proctoring_session_ended");
    }

    private async Task<bool> LockSessionForCompletionAsync(Guid orgId, Guid sessionId,
        CancellationToken ct) =>
        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_sessions SET updated_at = {Timestamp(DbNow())}
            WHERE id = {sessionId} AND organization_id = {orgId} AND ended_at IS NULL
            """, ct) == 1;

    private async Task RecordGapIfNeededAsync(Guid orgId, ProctoringSessionRow session, DateTime now, CancellationToken ct)
    {
        var previous = session.LastHeartbeatAt ?? session.StartedAt;
        if ((now - previous).TotalSeconds <= ProctoringSignalPolicy.HeartbeatGapSeconds) return;
        var count = await _db.Sessions.AsNoTracking()
            .Where(s => s.OrganizationId == orgId && s.Id == session.Id)
            .Select(s => s.FlagCount).SingleAsync(ct);
        if (count >= ProctoringSignalPolicy.MaximumEventsPerSession) return;
        var key = GapEventId(session.Id, previous);
        if (await InsertEventAsync(orgId, session.Id, key, "heartbeat_gap", "server_inferred",
            "medium", null, now, ct) == 1)
            await IncrementSummaryAsync(orgId, session.Id, "medium", now, ct);
    }

    private Task<int> InsertEventAsync(Guid orgId, Guid sessionId, Guid clientEventId, string type,
        string source, string severity, DateTime? clientAt, DateTime now, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        return _db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO proctoring_events
              (id, organization_id, session_id, client_event_id, type, source, severity, client_at, occurred_at)
            VALUES ({id}, {orgId}, {sessionId}, {clientEventId}, {type}, {source}, {severity}, {NullableTimestamp(clientAt)}, {Timestamp(now)})
            ON CONFLICT (session_id, client_event_id) DO NOTHING
            """, ct);
    }

    private Task<int> IncrementSummaryAsync(Guid orgId, Guid sessionId, string severity, DateTime now,
        CancellationToken ct) => _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_sessions
               SET flag_count = flag_count + 1,
                   severity = CASE WHEN {severity} = 'medium' THEN 'medium'
                                   ELSE COALESCE(severity, 'low') END,
                   updated_at = {Timestamp(now)}
             WHERE id = {sessionId} AND organization_id = {orgId} AND ended_at IS NULL
            """, ct);

    private static Guid GapEventId(Guid sessionId, DateTime previous)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{sessionId}:{previous:O}:gap"));
        return new Guid(bytes.AsSpan(0, 16));
    }

    private static DateTime DbNow()
    {
        var utc = DateTime.UtcNow;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)),
            DateTimeKind.Unspecified);
    }

    // Raw SQL parameters otherwise default to timestamptz under Npgsql. Prisma
    // owns these columns as timestamp(3) without time zone, storing UTC wall
    // clock values. Bind explicitly so Kind=Unspecified is never reinterpreted.
    private static NpgsqlParameter Timestamp(DateTime value) => new()
    {
        NpgsqlDbType = NpgsqlDbType.Timestamp,
        Value = value,
    };

    private static NpgsqlParameter NullableTimestamp(DateTime? value) => new()
    {
        NpgsqlDbType = NpgsqlDbType.Timestamp,
        Value = value is { } present ? present : DBNull.Value,
    };
}
