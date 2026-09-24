namespace Tims.Application.Proctoring;

public sealed record ProctoringEvidenceIntent(
    Guid EvidenceId,
    Guid SessionId,
    string Status,
    string StagingObjectKey,
    string MediaType,
    string CaptureReason,
    int CaptureSlot,
    string ContentType,
    int MaxBytes,
    DateTime IntentExpiresAt);

public sealed record ProctoringConfirmLease(
    Guid EvidenceId,
    Guid SessionId,
    string Status,
    string StagingObjectKey,
    string MediaType,
    string ContentType,
    int MaxBytes,
    DateTime IntentExpiresAt,
    DateTime LeaseUpdatedAt,
    bool AlreadyReady,
    string? SealedObjectKey,
    string? Sha256,
    DateTime? ExpiresAt);

public sealed record ProctoringEvidenceReady(
    Guid EvidenceId,
    string SealedObjectKey,
    string Sha256,
    DateTime ExpiresAt);

public sealed record ProctoringEvidenceForResult(
    Guid EvidenceId,
    Guid OrganizationId,
    Guid AssignmentId,
    Guid SessionId,
    string MediaType,
    string Status,
    string? SealedObjectKey,
    string? Sha256,
    string? ModelRevision,
    DateTime? ExpiresAt);

public sealed record ProctoringOutboxClaim(
    Guid OutboxId,
    Guid OrganizationId,
    Guid EvidenceId,
    string ObjectKey,
    string Sha256,
    string MediaType,
    string ModelRevision,
    DateTime ExpiresAt,
    int ClaimAttempt);

public sealed record ProctoringDetectorFinding(string Label,
    double? Confidence, int? Count);

public sealed record ProctoringDetectorResult(string Name, string Revision,
    string Status, IReadOnlyList<ProctoringDetectorFinding> Findings,
    string? FailureCode);

public sealed record ProctoringInferenceResult(int SchemaVersion,
    Guid OrganizationId, Guid EvidenceId, string Sha256, string ModelRevision,
    string Status, IReadOnlyList<ProctoringDetectorResult> Detectors,
    DateTime ProcessedAt);

public sealed record ProctoringInferenceApplyResult(string Status);

/// <summary>
/// The .NET authority for consent and evidence metadata. Each method owns a
/// short TenantScope transaction; S3 and SQS calls must happen outside it.
/// </summary>
public interface IProctoringEvidenceRepository
{
    Task AcceptMediaConsentAsync(Guid organizationId, Guid candidateId,
        Guid assignmentId, string consentVersion, CancellationToken ct);

    Task StopMediaCaptureAsync(Guid organizationId, Guid candidateId,
        Guid assignmentId, CancellationToken ct);

    Task<ProctoringEvidenceIntent> ReserveIntentAsync(Guid organizationId,
        Guid candidateId, Guid assignmentId, Guid clientCaptureId,
        string mediaType, string captureReason, string contentType, int maxBytes,
        CancellationToken ct);

    Task<ProctoringConfirmLease> BeginConfirmAsync(Guid organizationId,
        Guid candidateId, Guid assignmentId, Guid evidenceId, CancellationToken ct);

    Task<ProctoringEvidenceReady> FinishConfirmAsync(Guid organizationId,
        Guid candidateId, Guid assignmentId, Guid evidenceId,
        ProctoringSealedObject sealedObject, string? modelRevision,
        bool cloudInferenceEnabled, DateTime leaseUpdatedAt, CancellationToken ct);

    Task ResetConfirmAsync(Guid organizationId, Guid candidateId,
        Guid assignmentId, Guid evidenceId, DateTime leaseUpdatedAt,
        CancellationToken ct);

    Task<ProctoringEvidenceForResult?> GetForResultAsync(Guid organizationId,
        Guid evidenceId, CancellationToken ct);

    // Privileged read-only dispatcher bootstrap: DISTINCT organization IDs
    // only. Every subsequent claim/write uses TenantScope and tenant RLS.
    Task<IReadOnlyList<Guid>> ListPendingOutboxOrganizationIdsAsync(
        int maxCount, CancellationToken ct);

    Task<IReadOnlyList<ProctoringOutboxClaim>> ClaimPendingOutboxAsync(
        Guid organizationId, int maxCount, CancellationToken ct);

    Task<bool> MarkOutboxDispatchedAsync(Guid organizationId,
        Guid outboxId, int claimAttempt, CancellationToken ct);

    Task<bool> MarkOutboxRetryAsync(Guid organizationId, Guid outboxId,
        int claimAttempt, string errorCode, CancellationToken ct);

    // Privileged read-only sweep bootstrap. Only tenant IDs leave this query;
    // each stale-evidence transition runs under TenantScope and RLS.
    Task<IReadOnlyList<Guid>> ListStaleDispatchedOutboxOrganizationIdsAsync(
        int maxCount, CancellationToken ct);

    Task<int> MarkStaleDispatchedUnavailableAsync(Guid organizationId,
        int maxCount, CancellationToken ct);

    Task<ProctoringInferenceApplyResult> ApplyInferenceResultAsync(
        Guid organizationId, ProctoringInferenceResult result, CancellationToken ct);
}
