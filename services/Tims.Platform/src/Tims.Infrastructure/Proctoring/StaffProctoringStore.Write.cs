using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure;

namespace Tims.Infrastructure.Proctoring;

public sealed partial class StaffProctoringStore
{
    public async Task<StaffPolicyResponse> SetPolicyAsync(
        Guid organizationId, Guid typeId, bool enabled, Guid actorId,
        string? ip, string? userAgent, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var row = await _db.AssessmentTypes.AsNoTracking()
            .Where(type => type.Id == typeId && type.OrganizationId == organizationId)
            .Select(type => new { type.ConfigJson, type.UpdatedAt })
            .SingleOrDefaultAsync(ct)
            ?? throw new StaffProctoringFailure(404, "assessment_type_not_found");

        if (enabled && !await _db.Entitlements.AnyAsync(entitlement =>
                entitlement.OrganizationId == organizationId
                && entitlement.ModuleCode == "proctoring" && entitlement.Enabled, ct))
        {
            throw new StaffProctoringFailure(403, "entitlement_missing:proctoring");
        }

        JsonObject config;
        try
        {
            config = row.ConfigJson is null ? new JsonObject()
                : JsonNode.Parse(row.ConfigJson) as JsonObject
                    ?? throw new StaffProctoringFailure(409, "assessment_type_config_invalid");
        }
        catch (JsonException)
        {
            throw new StaffProctoringFailure(409, "assessment_type_config_invalid");
        }

        config["proctoringEnabled"] = enabled;
        var now = UtcTimestamp();
        if (now <= row.UpdatedAt) now = row.UpdatedAt.AddMilliseconds(1);
        var count = await _db.AssessmentTypes
            .Where(type => type.Id == typeId && type.OrganizationId == organizationId
                && type.UpdatedAt == row.UpdatedAt)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(type => type.ConfigJson, config.ToJsonString())
                .SetProperty(type => type.UpdatedAt, now), ct);
        if (count != 1)
        {
            throw new StaffProctoringFailure(409, "proctoring_policy_race");
        }

        _db.AuditLogs.Add(NewAudit(organizationId, actorId,
            "proctoring_policy_changed", "assessmentType", typeId,
            JsonSerializer.Serialize(new { proctoringEnabled = enabled }), ip, userAgent));
        await _db.SaveChangesAsync(ct);
        await tenant.CommitAsync(ct);
        return new StaffPolicyResponse(typeId, enabled);
    }

    public async Task<StaffReviewResponse> ReviewAsync(
        StaffProctoringScope scope, Guid assignmentId, Guid actorId,
        string status, string? notes, string? ip, string? userAgent, CancellationToken ct,
        Guid? seenExplanationId = null)
    {
        if (status is not ("clear" or "concern" or "inconclusive"))
        {
            throw new StaffProctoringFailure(400, "invalid_review_status");
        }

        notes = notes?.Trim();
        if (notes is { Length: > 2000 } || (status != "clear" && string.IsNullOrWhiteSpace(notes)))
        {
            throw new StaffProctoringFailure(400, "review_notes_invalid");
        }

        await AssertAuthorizedAssignmentAsync(scope, assignmentId, ct);
        await _candidateRepository.ReconcileCompletedForOrganizationAsync(
            scope.OrganizationId, assignmentId, ct);
        await using var tenant = await TenantScope.BeginAsync(_db, scope.OrganizationId, ct);
        if (!await CanAccessAssignmentAsync(scope, assignmentId, ct))
        {
            throw new StaffProctoringFailure(404, "assignment_not_found");
        }

        // Serialize the review with candidate submission. The reviewer must
        // confirm exactly the statement they saw (including seeing none).
        var locked = await _db.Sessions.FromSqlInterpolated($"""
            SELECT * FROM proctoring_sessions
             WHERE organization_id = {scope.OrganizationId}
               AND assignment_id = {assignmentId}
             FOR UPDATE
            """).AsNoTracking().ToListAsync(ct);
        var session = locked.SingleOrDefault()
            ?? throw new StaffProctoringFailure(404, "proctoring_session_not_found");
        if (session.EndedAt is null)
        {
            throw new StaffProctoringFailure(409, "proctoring_session_not_completed");
        }
        var now = UtcTimestamp();
        var currentExplanationId = await _db.CandidateExplanations.AsNoTracking()
            .Where(row => row.OrganizationId == scope.OrganizationId
                && row.AssignmentId == assignmentId && row.SessionId == session.Id
                && row.ExpiresAt > now)
            .Select(row => (Guid?)row.Id).SingleOrDefaultAsync(ct);
        if (currentExplanationId != seenExplanationId)
            throw new StaffProctoringFailure(409, "explanation_changed");

        var reviewedAt = UtcTimestamp();
        if (session.ReviewedAt is { } previousReviewAt && reviewedAt <= previousReviewAt)
        {
            reviewedAt = previousReviewAt.AddMilliseconds(1);
        }
        var changed = await _db.Sessions
            .Where(row => row.Id == session.Id && row.OrganizationId == scope.OrganizationId
                && row.AssignmentId == assignmentId && row.EndedAt != null
                && row.ReviewStatus == session.ReviewStatus
                && row.ReviewedAt == session.ReviewedAt
                && row.UpdatedAt == session.UpdatedAt)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(row => row.ReviewStatus, status)
                .SetProperty(row => row.ReviewNotes, notes)
                .SetProperty(row => row.ReviewedAt, reviewedAt)
                .SetProperty(row => row.ReviewedById, actorId)
                .SetProperty(row => row.UpdatedAt, reviewedAt), ct);
        if (changed != 1)
        {
            throw new StaffProctoringFailure(409, "proctoring_review_race");
        }

        _db.AuditLogs.Add(NewAudit(scope.OrganizationId, actorId,
            "proctoring_review", "proctoringSession", session.Id,
            JsonSerializer.Serialize(new { previousStatus = session.ReviewStatus, status }),
            ip, userAgent));
        await _db.SaveChangesAsync(ct);
        await tenant.CommitAsync(ct);
        return new StaffReviewResponse(status, notes, WireUtc(reviewedAt));
    }

    private static ProctoringAuditLogRow NewAudit(
        Guid orgId, Guid actorId, string action, string entity, Guid entityId,
        string metadata, string? ip, string? userAgent) => new()
        {
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            ActorId = actorId,
            Action = action,
            Entity = entity,
            EntityId = entityId.ToString(),
            MetadataJson = metadata,
            IpAddress = ip,
            UserAgent = userAgent,
            CreatedAt = UtcTimestamp(),
        };
}
