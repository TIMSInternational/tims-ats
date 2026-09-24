using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tims.Domain.Audit;
using Tims.Infrastructure;

namespace Tims.Infrastructure.Proctoring;

public sealed partial class StaffProctoringStore
{
    public async Task<StaffEvidenceResponse> GetEvidenceAsync(
        StaffProctoringScope scope, Guid assignmentId, Guid actorId,
        int limit, Guid? cursorId, string? ip, string? userAgent, CancellationToken ct)
    {
        ProctoringSessionRow session;
        List<ProctoringEventRow> events;
        // A lost candidate completion request is repaired from the authoritative assignment.
        // The shared finalizer also records an idempotent server-inferred heartbeat gap.
        await AssertAuthorizedAssignmentAsync(scope, assignmentId, ct);
        await _candidateRepository.ReconcileCompletedForOrganizationAsync(
            scope.OrganizationId, assignmentId, ct);
        await using (var tenant = await TenantScope.BeginAsync(_db, scope.OrganizationId, ct))
        {
            var assignment = await ScopedAssignments(scope)
                .Where(row => row.Id == assignmentId).Select(row => row.Id).SingleOrDefaultAsync(ct);
            if (assignment == Guid.Empty)
            {
                throw new StaffProctoringFailure(404, "assignment_not_found");
            }

            session = await _db.Sessions.AsNoTracking()
                .SingleOrDefaultAsync(row => row.OrganizationId == scope.OrganizationId
                    && row.AssignmentId == assignmentId, ct)
                ?? throw new StaffProctoringFailure(404, "proctoring_session_not_found");

            IQueryable<ProctoringEventRow> eventQuery = _db.Events.AsNoTracking()
                .Where(row => row.OrganizationId == scope.OrganizationId && row.SessionId == session.Id);
            if (cursorId is { } cursor)
            {
                var cursorRow = await eventQuery.Where(row => row.Id == cursor)
                    .Select(row => new { row.OccurredAt }).SingleOrDefaultAsync(ct)
                    ?? throw new StaffProctoringFailure(400, "invalid_cursor");
                // PostgreSQL UUID comparison gives a deterministic tie-break without fetching
                // an unbounded event set into application memory.
                var before = Timestamp(cursorRow.OccurredAt);
                var equal = Timestamp(cursorRow.OccurredAt);
                eventQuery = _db.Events.FromSqlInterpolated($"""
                    SELECT * FROM proctoring_events
                    WHERE organization_id = {scope.OrganizationId} AND session_id = {session.Id}
                      AND (occurred_at < {before}
                           OR (occurred_at = {equal} AND id < {cursor}))
                    """).AsNoTracking();
            }

            events = await eventQuery.OrderByDescending(row => row.OccurredAt)
                .ThenByDescending(row => row.Id).Take(limit + 1).ToListAsync(ct);
            await tenant.CommitAsync(ct);
        }

        // Restricted review evidence is never returned if its access audit cannot be written.
        await AuditReadAsync(scope.OrganizationId, actorId, session.Id, ip, userAgent);
        var hasMore = events.Count > limit;
        var page = events.Take(limit).ToArray();
        return new StaffEvidenceResponse(
            session.Id, session.AssignmentId, WireUtc(session.StartedAt), WireUtc(session.EndedAt),
            WireUtc(session.LastHeartbeatAt), session.FlagCount, session.Severity,
            session.EndedAt is null ? "active" : "completed",
            page.Select(row => new StaffEventSummary(
                row.Id, row.Type, row.Severity, WireUtc(row.OccurredAt), row.Source,
                WireUtc(row.ClientAt))).ToArray(),
            hasMore ? page[^1].Id : null,
            new StaffReviewSummary(NormalizeReviewStatus(session.ReviewStatus),
                session.ReviewNotes, WireUtc(session.ReviewedAt)),
            "unverified_client_signals");
    }

    public async Task<StaffReviewQueueResponse> ListQueueAsync(
        StaffProctoringScope scope, Guid actorId, int limit, Guid? cursorId,
        string? ip, string? userAgent, CancellationToken ct)
    {
        List<QueueRow> rows;
        var staleBefore = UtcTimestamp().AddMinutes(-3);
        // Queue GET repairs at most 100 orphaned completed sessions per call. Narrow
        // staff can repair only assignments visible through their vacancy scope.
        await ReconcileQueueAsync(scope, ct);
        await using (var tenant = await TenantScope.BeginAsync(_db, scope.OrganizationId, ct))
        {
            var sessions = _db.Sessions.AsNoTracking()
                .Where(row => row.OrganizationId == scope.OrganizationId);
            if (cursorId is { } cursor)
            {
                var visible = from session in sessions
                    join assignment in ScopedAssignments(scope) on session.AssignmentId equals assignment.Id
                    where session.Id == cursor
                        && (session.EndedAt != null || assignment.Status == "completed"
                            || (assignment.Status == "in_progress"
                                && (session.LastHeartbeatAt ?? session.StartedAt) < staleBefore))
                    let effectiveEnd = session.EndedAt ?? (assignment.Status == "completed"
                        ? (assignment.CompletedAt > session.StartedAt
                            ? assignment.CompletedAt : session.StartedAt)
                        : null)
                    select new { session.ReviewedAt, EffectiveEnd = effectiveEnd };
                var cursorRow = await visible.SingleOrDefaultAsync(ct)
                    ?? throw new StaffProctoringFailure(400, "invalid_cursor");
                sessions = QueueSessions(scope.OrganizationId, staleBefore, cursor,
                    new QueueCursor(cursorRow.ReviewedAt, cursorRow.EffectiveEnd));
            }

            var query = from session in sessions
                join assignment in ScopedAssignments(scope) on session.AssignmentId equals assignment.Id
                join candidate in _db.Candidates on assignment.CandidateId equals candidate.Id
                join assessmentType in _db.AssessmentTypes on assignment.AssessmentTypeId equals assessmentType.Id
                where candidate.OrganizationId == scope.OrganizationId
                    && assessmentType.OrganizationId == scope.OrganizationId
                    && (session.EndedAt != null || assignment.Status == "completed"
                        || (assignment.Status == "in_progress"
                            && (session.LastHeartbeatAt ?? session.StartedAt) < staleBefore))
                let effectiveEnd = session.EndedAt ?? (assignment.Status == "completed"
                    ? (assignment.CompletedAt > session.StartedAt
                        ? assignment.CompletedAt : session.StartedAt)
                    : null)
                orderby session.ReviewedAt == null descending,
                    session.ReviewedAt,
                    effectiveEnd != null descending, effectiveEnd descending,
                    session.Id descending
                select new QueueRow(session.Id, assignment.Id, candidate.Id,
                    candidate.FirstName, candidate.LastName, assessmentType.Name,
                    effectiveEnd, session.FlagCount, session.Severity,
                    session.ReviewStatus, effectiveEnd == null ? "needs_attention" : "completed");

            rows = await query.Take(limit + 1).ToListAsync(ct);
            await tenant.CommitAsync(ct);
        }

        var hasMore = rows.Count > limit;
        var page = rows.Take(limit).ToArray();
        foreach (var row in page)
        {
            await AuditReadAsync(scope.OrganizationId, actorId, row.SessionId, ip, userAgent);
        }

        return new StaffReviewQueueResponse(page.Select(row => new StaffReviewQueueItem(
            row.SessionId, row.AssignmentId,
            new StaffCandidateSummary(row.CandidateId, row.FirstName, row.LastName),
            new StaffAssessmentTypeSummary(row.AssessmentTypeName),
            WireUtc(row.EndedAt), row.FlagCount, row.Severity,
            NormalizeReviewStatus(row.ReviewStatus), row.Status)).ToArray(),
            hasMore ? page[^1].SessionId : null);
    }

    private IQueryable<ProctoringSessionRow> QueueSessions(
        Guid orgId, DateTime staleBefore, Guid cursorId, QueueCursor cursor)
    {
        var id = cursorId;
        var c = cursor;
        var reviewedAt = c.ReviewedAt;
        var endedAt = c.EffectiveEnd;
        var reviewedIsNull = reviewedAt is null;
        var endedIsNotNull = endedAt is not null;
        var staleParameter = Timestamp(staleBefore);
        var reviewedGreater = NullableTimestamp(reviewedAt);
        var reviewedEqual = NullableTimestamp(reviewedAt);
        var endedLess = NullableTimestamp(endedAt);
        var endedEqual = NullableTimestamp(endedAt);
        // The effective end is derived from the authoritative completed assignment
        // even while its session is still awaiting a bounded repair. Cursor position
        // therefore does not change when a later GET finalizes another 100 sessions.
        // Flag count is deliberately display-only: inferred-gap repair can increase it.
        return _db.Sessions.FromSqlInterpolated($"""
            SELECT s.* FROM proctoring_sessions AS s
            JOIN assessment_assignments AS a
              ON a.id = s.assignment_id AND a.organization_id = {orgId}
            CROSS JOIN LATERAL (
              SELECT CASE
                WHEN s.ended_at IS NOT NULL THEN s.ended_at
                WHEN a.status = 'completed' THEN
                  GREATEST(COALESCE(a.completed_at, s.started_at), s.started_at)
                ELSE NULL::timestamp
              END AS effective_end
            ) AS derived
            WHERE s.organization_id = {orgId}
              AND (s.ended_at IS NOT NULL OR a.status = 'completed'
                OR (a.status = 'in_progress' AND s.ended_at IS NULL
                    AND COALESCE(s.last_heartbeat_at, s.started_at) < {staleParameter}))
              AND (
                (s.reviewed_at IS NOT NULL AND {reviewedIsNull})
                OR s.reviewed_at > {reviewedGreater}
                OR (s.reviewed_at IS NOT DISTINCT FROM {reviewedEqual} AND (
                    (derived.effective_end IS NULL AND {endedIsNotNull})
                    OR derived.effective_end < {endedLess}
                    OR (derived.effective_end IS NOT DISTINCT FROM {endedEqual}
                        AND s.id < {id})
                ))
              )
            """).AsNoTracking();
    }

    private Task AuditReadAsync(Guid orgId, Guid actorId, Guid sessionId, string? ip, string? userAgent) =>
        _auditor.LogAsync(new DataAccessEvent(orgId.ToString(), actorId.ToString(),
            "proctoringSession", sessionId.ToString(), AuditAction.Read, ip, userAgent),
            failClosed: true, cancellationToken: CancellationToken.None);

    private static string NormalizeReviewStatus(string value) => value switch
    {
        "clear" or "concern" or "inconclusive" => value,
        _ => "unreviewed",
    };

    private sealed record QueueCursor(DateTime? ReviewedAt, DateTime? EffectiveEnd);
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
    private sealed record QueueRow(
        Guid SessionId, Guid AssignmentId, Guid CandidateId,
        string FirstName, string LastName, string AssessmentTypeName,
        DateTime? EndedAt, int FlagCount, string? Severity, string ReviewStatus,
        string Status);
}
