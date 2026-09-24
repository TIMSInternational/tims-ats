using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Proctoring;

public sealed partial class StaffProctoringStore
{
    public async Task<StaffMediaResponse> ListMediaAsync(
        StaffProctoringScope scope, Guid assignmentId, Guid actorId,
        string? ip, string? userAgent, CancellationToken ct)
    {
        ProctoringSessionRow session;
        List<ProctoringEvidenceRow> evidence;
        List<ProctoringFindingRow> findings;
        await using (var tenant = await TenantScope.BeginAsync(_db, scope.OrganizationId, ct))
        {
            await AssertVisibleAssignmentInScopeAsync(scope, assignmentId, ct);
            session = await _db.Sessions.AsNoTracking().SingleOrDefaultAsync(row =>
                row.OrganizationId == scope.OrganizationId && row.AssignmentId == assignmentId, ct)
                ?? throw new StaffProctoringFailure(404, "proctoring_session_not_found");

            // The 30-minute policy permits at most 35 camera and 35 screen
            // images. Keep this query bounded even if older data violates it.
            evidence = await _db.Evidence.AsNoTracking()
                .Where(row => row.OrganizationId == scope.OrganizationId
                    && row.AssignmentId == assignmentId && row.SessionId == session.Id)
                .OrderBy(row => row.CreatedAt).ThenBy(row => row.Id)
                .Take(71).ToListAsync(ct);
            if (evidence.Count > 70)
                throw new StaffProctoringFailure(409, "evidence_limit_exceeded");
            var ids = evidence.Select(row => row.Id).ToArray();
            findings = ids.Length == 0 ? [] : await _db.Findings.AsNoTracking()
                .Where(row => row.OrganizationId == scope.OrganizationId
                    && ids.Contains(row.EvidenceId))
                .OrderBy(row => row.InferredAt).ThenBy(row => row.Id)
                .Take(701).ToListAsync(ct);
            if (findings.Count > 700)
                throw new StaffProctoringFailure(409, "finding_limit_exceeded");
            await tenant.CommitAsync(ct);
        }

        // Sensitive media metadata cannot leave the API unless the audit write
        // succeeds. The returned items intentionally contain no S3 key or URL.
        await AuditReadAsync(scope.OrganizationId, actorId, session.Id, ip, userAgent);
        var byEvidence = findings.GroupBy(row => row.EvidenceId)
            .ToDictionary(group => group.Key, group => group.Select(ToSummary).ToArray());
        return new StaffMediaResponse(session.Id, assignmentId,
            session.MediaConsentedAt is not null,
            evidence.Select(row => new StaffMediaItem(
                row.Id, row.MediaType, row.CaptureReason, row.Status,
                WireUtc(row.CreatedAt), WireUtc(row.ConfirmedAt), WireUtc(row.ExpiresAt),
                byEvidence.GetValueOrDefault(row.Id) ?? [])).ToArray());
    }

    public async Task<StaffMediaForRead> GetMediaForReadAsync(
        StaffProctoringScope scope, Guid assignmentId, Guid evidenceId,
        Guid actorId, string? ip, string? userAgent, CancellationToken ct)
    {
        ProctoringEvidenceRow evidence;
        await using (var tenant = await TenantScope.BeginAsync(_db, scope.OrganizationId, ct))
        {
            await AssertVisibleAssignmentInScopeAsync(scope, assignmentId, ct);
            evidence = await _db.Evidence.AsNoTracking().SingleOrDefaultAsync(row =>
                row.Id == evidenceId && row.OrganizationId == scope.OrganizationId
                && row.AssignmentId == assignmentId, ct)
                ?? throw new StaffProctoringFailure(404, "evidence_not_found");
            await tenant.CommitAsync(ct);
        }

        var now = DateTime.UtcNow;
        if (evidence.Status is not ("ready" or "processing" or "processed" or "unavailable")
            || evidence.ExpiresAt is not { } expiry
            || expiry <= now.AddSeconds(3)
            || evidence.SealedObjectKey is not { } key
            || !key.StartsWith(
                $"sealed/{scope.OrganizationId:D}/{evidence.SessionId:D}/{evidence.Id:D}/",
                StringComparison.Ordinal))
            throw new StaffProctoringFailure(404, "evidence_unavailable");
        await AuditReadAsync(scope.OrganizationId, actorId, evidence.SessionId, ip, userAgent);
        return new StaffMediaForRead(evidence.Id, key,
            evidence.ContentType, WireUtc(expiry));
    }

    private async Task AssertVisibleAssignmentInScopeAsync(
        StaffProctoringScope scope, Guid assignmentId, CancellationToken ct)
    {
        var visible = await ScopedAssignments(scope)
            .AnyAsync(row => row.Id == assignmentId, ct);
        if (!visible) throw new StaffProctoringFailure(404, "assignment_not_found");
    }

    private static StaffFindingSummary ToSummary(ProctoringFindingRow row) =>
        new(row.Detector, row.ModelRevision, row.Label, row.ResultKind,
            row.Confidence, row.DetectedCount, row.FailureCode, WireUtc(row.InferredAt));
}

public sealed record StaffFindingSummary(string Detector, string ModelRevision,
    string Label, string ResultKind, double? Confidence, int? DetectedCount,
    string? FailureCode, DateTime InferredAt);

public sealed record StaffMediaItem(Guid EvidenceId, string MediaType,
    string CaptureReason, string Status, DateTime CreatedAt,
    DateTime? ConfirmedAt, DateTime? ExpiresAt,
    IReadOnlyList<StaffFindingSummary> Findings);

public sealed record StaffMediaResponse(Guid SessionId, Guid AssignmentId,
    bool MediaConsented,
    IReadOnlyList<StaffMediaItem> Items);

public sealed record StaffMediaForRead(Guid EvidenceId, string SealedObjectKey,
    string ContentType, DateTime ExpiresAt);
