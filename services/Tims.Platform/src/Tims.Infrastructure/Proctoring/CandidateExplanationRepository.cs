using Microsoft.EntityFrameworkCore;
using Tims.Application.Proctoring;

namespace Tims.Infrastructure.Proctoring;

/// <summary>
/// One candidate-authored statement per session. The session row lock orders
/// submission against staff review, while the unique session index makes
/// retries safe. Every product read/write runs under tenant RLS.
/// </summary>
public sealed class CandidateExplanationRepository(ProctoringDbContext db)
    : ICandidateExplanationRepository
{
    private readonly ProctoringDbContext _db = db;

    public async Task<CandidateExplanationState> GetAsync(Guid organizationId,
        Guid candidateId, Guid assignmentId, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var assignment = await OwnedAssignmentAsync(organizationId, candidateId, assignmentId, ct);
        var session = await _db.Sessions.AsNoTracking().SingleOrDefaultAsync(row =>
            row.OrganizationId == organizationId && row.AssignmentId == assignmentId, ct)
            ?? throw new ProctoringException(ProctoringError.NotFound, "proctoring_session_not_found");
        var now = DbNow();
        var closesAt = ClosesAt(assignment, session);
        var row = await _db.CandidateExplanations.AsNoTracking().SingleOrDefaultAsync(item =>
            item.OrganizationId == organizationId && item.SessionId == session.Id
                && item.CandidateId == candidateId && item.ExpiresAt > now, ct);
        await tenant.CommitAsync(ct);
        return new CandidateExplanationState(row is null ? null : ToResult(row),
            row is null && assignment.Status == "completed" && session.ReviewedAt is null
                && session.ReviewStatus == "unreviewed" && closesAt is { } deadline
                && deadline > now,
            WireUtc(closesAt));
    }

    public async Task<CandidateExplanation> SubmitAsync(Guid organizationId,
        Guid candidateId, Guid assignmentId, Guid submissionId, string text,
        CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var assignment = await OwnedAssignmentAsync(organizationId, candidateId, assignmentId, ct);

        // A real row lock serializes this insert with the staff review UPDATE.
        // AsNoTracking avoids an unrelated session SaveChanges write.
        var locked = await _db.Sessions.FromSqlInterpolated($"""
            SELECT * FROM proctoring_sessions
             WHERE organization_id = {organizationId}
               AND assignment_id = {assignmentId}
             FOR UPDATE
            """).AsNoTracking().ToListAsync(ct);
        var session = locked.SingleOrDefault()
            ?? throw new ProctoringException(ProctoringError.NotFound, "proctoring_session_not_found");
        var now = DbNow();
        var existing = await _db.CandidateExplanations.AsNoTracking().SingleOrDefaultAsync(row =>
            row.OrganizationId == organizationId && row.SessionId == session.Id
                && row.CandidateId == candidateId, ct);
        if (existing is not null)
        {
            if (existing.ExpiresAt <= now)
                throw new ProctoringException(ProctoringError.Conflict,
                    "explanation_window_closed");
            if (existing.SubmissionId != submissionId || existing.Text != text)
                throw new ProctoringException(ProctoringError.Conflict,
                    "explanation_already_submitted");
            await tenant.CommitAsync(ct);
            return ToResult(existing);
        }

        if (assignment.Status != "completed")
            throw new ProctoringException(ProctoringError.Conflict,
                "assessment_not_completed");
        if (session.ReviewedAt is not null || session.ReviewStatus != "unreviewed")
            throw new ProctoringException(ProctoringError.Conflict,
                "proctoring_review_closed");
        var closesAt = ClosesAt(assignment, session);
        if (closesAt is not { } deadline || deadline <= now)
            throw new ProctoringException(ProctoringError.Conflict,
                "explanation_window_closed");
        if (deadline > now.AddDays(7)) deadline = now.AddDays(7);

        var rowToAdd = new ProctoringCandidateExplanationRow
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            AssignmentId = assignmentId,
            SessionId = session.Id,
            CandidateId = candidateId,
            SubmissionId = submissionId,
            Text = text,
            SubmittedAt = now,
            ExpiresAt = deadline,
        };
        _db.CandidateExplanations.Add(rowToAdd);
        await _db.SaveChangesAsync(ct);
        await tenant.CommitAsync(ct);
        return ToResult(rowToAdd);
    }

    private async Task<ProctoringAssignmentRow> OwnedAssignmentAsync(Guid organizationId,
        Guid candidateId, Guid assignmentId, CancellationToken ct) =>
        await _db.Assignments.AsNoTracking().SingleOrDefaultAsync(row =>
            row.Id == assignmentId && row.OrganizationId == organizationId
                && row.CandidateId == candidateId, ct)
        ?? throw new ProctoringException(ProctoringError.NotFound, "assignment_not_found");

    private static DateTime? ClosesAt(ProctoringAssignmentRow assignment,
        ProctoringSessionRow session)
    {
        if (assignment.Status != "completed") return null;
        var completed = assignment.CompletedAt ?? session.EndedAt ?? session.StartedAt;
        if (completed < session.StartedAt) completed = session.StartedAt;
        return completed.AddDays(7);
    }

    private static CandidateExplanation ToResult(ProctoringCandidateExplanationRow row) =>
        new(row.Id, row.Text, WireUtc(row.SubmittedAt), WireUtc(row.ExpiresAt));

    private static DateTime DbNow()
    {
        var now = DateTime.UtcNow;
        return DateTime.SpecifyKind(now.AddTicks(-(now.Ticks % TimeSpan.TicksPerMillisecond)),
            DateTimeKind.Unspecified);
    }

    private static DateTime WireUtc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
    private static DateTime? WireUtc(DateTime? value) => value is { } instant ? WireUtc(instant) : null;
}
