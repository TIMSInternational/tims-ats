using Microsoft.EntityFrameworkCore;
using Tims.Application.Proctoring;

namespace Tims.Infrastructure.Proctoring;

public sealed partial class StaffProctoringStore
{
    public async Task<CandidateExplanation?> GetCandidateExplanationAsync(
        StaffProctoringScope scope, Guid assignmentId, Guid actorId,
        string? ip, string? userAgent, CancellationToken ct)
    {
        await AssertAuthorizedAssignmentAsync(scope, assignmentId, ct);
        Guid sessionId;
        ProctoringCandidateExplanationRow? explanation;
        await using (var tenant = await TenantScope.BeginAsync(_db, scope.OrganizationId, ct))
        {
            if (!await ScopedAssignments(scope).AnyAsync(row =>
                    row.Id == assignmentId, ct))
                throw new StaffProctoringFailure(404, "assignment_not_found");
            sessionId = await _db.Sessions.AsNoTracking()
                .Where(row => row.OrganizationId == scope.OrganizationId
                    && row.AssignmentId == assignmentId)
                .Select(row => row.Id).SingleOrDefaultAsync(ct);
            if (sessionId == Guid.Empty)
                throw new StaffProctoringFailure(404, "proctoring_session_not_found");
            var now = UtcTimestamp();
            explanation = await _db.CandidateExplanations.AsNoTracking()
                .SingleOrDefaultAsync(row => row.OrganizationId == scope.OrganizationId
                    && row.AssignmentId == assignmentId && row.SessionId == sessionId
                    && row.ExpiresAt > now, ct);
            await tenant.CommitAsync(ct);
        }

        // The text is disclosed only after the existing sensitive-read auditor
        // has written its durable, fail-closed record.
        await AuditReadAsync(scope.OrganizationId, actorId, sessionId, ip, userAgent);
        if (explanation?.ExpiresAt <= UtcTimestamp()) return null;
        return explanation is null ? null : new CandidateExplanation(
            explanation.Id, explanation.Text,
            WireUtc(explanation.SubmittedAt), WireUtc(explanation.ExpiresAt));
    }
}
