using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure;

namespace Tims.Infrastructure.Proctoring;

public sealed partial class StaffProctoringStore
{
    /// <summary>
    /// A staff accommodation waives proctoring for one assignment before it starts.
    /// The conditional update and audit insert share one tenant transaction. A
    /// candidate start must also condition its transition on ProctoringRequired.
    /// </summary>
    public async Task<StaffAccommodationResponse> AccommodateAsync(
        StaffProctoringScope scope, Guid assignmentId, Guid actorId, string reason,
        string? ip, string? userAgent, CancellationToken ct)
    {
        if (!IsAccommodationReason(reason))
        {
            throw new StaffProctoringFailure(400, "invalid_accommodation_reason");
        }

        await using var tenant = await TenantScope.BeginAsync(_db, scope.OrganizationId, ct);
        var assignment = await ScopedAssignments(scope)
            .Where(row => row.Id == assignmentId)
            .Select(row => new { row.Status, row.ProctoringRequired })
            .SingleOrDefaultAsync(ct)
            ?? throw new StaffProctoringFailure(404, "assignment_not_found");

        if (assignment.Status != "assigned" || !assignment.ProctoringRequired
            || await _db.Sessions.AnyAsync(session =>
                session.OrganizationId == scope.OrganizationId
                && session.AssignmentId == assignmentId, ct))
        {
            throw new StaffProctoringFailure(409, "accommodation_no_longer_available");
        }

        var now = UtcTimestamp();
        var changed = await ScopedAssignments(scope)
            .Where(row => row.Id == assignmentId && row.Status == "assigned"
                && row.ProctoringRequired
                && !_db.Sessions.Any(session =>
                    session.OrganizationId == scope.OrganizationId
                    && session.AssignmentId == assignmentId))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(row => row.ProctoringRequired, false)
                .SetProperty(row => row.UpdatedAt, now), ct);

        if (changed != 1)
        {
            // A concurrent scope change must not be mistaken for an ordinary
            // lifecycle conflict, which would disclose the assignment's existence.
            if (!await CanAccessAssignmentAsync(scope, assignmentId, ct))
            {
                throw new StaffProctoringFailure(404, "assignment_not_found");
            }
            throw new StaffProctoringFailure(409, "accommodation_no_longer_available");
        }

        _db.AuditLogs.Add(NewAudit(scope.OrganizationId, actorId,
            "proctoring_accommodation", "assessmentAssignment", assignmentId,
            JsonSerializer.Serialize(new { reason }), ip, userAgent));
        await _db.SaveChangesAsync(ct);
        await tenant.CommitAsync(ct);
        return new StaffAccommodationResponse(assignmentId, false, reason);
    }

    public static bool IsAccommodationReason(string? reason) =>
        reason is "technical_unavailable" or "accessibility" or "other";
}

public sealed record StaffAccommodationResponse(
    Guid AssignmentId, bool ProctoringRequired, string Reason);
