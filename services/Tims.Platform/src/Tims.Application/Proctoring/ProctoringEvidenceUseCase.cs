using Tims.Domain.Proctoring;

namespace Tims.Application.Proctoring;

public sealed record ProctoringMediaConsentResult(bool Accepted, string ConsentVersion);
public sealed record ProctoringMediaStopResult(bool Stopped);

public sealed record ProctoringMediaIntentResult(
    Guid EvidenceId,
    string Status,
    DateTime IntentExpiresAt,
    string? UploadUrl,
    IReadOnlyDictionary<string, string>? UploadFields);

public sealed record ProctoringMediaConfirmResult(
    Guid EvidenceId,
    string Status,
    DateTime ExpiresAt);

/// <summary>
/// Orchestrates short DB transactions and S3 calls without holding a tenant
/// transaction open over the network. All candidate ownership is proven by
/// the repository, not by any browser-supplied session or object key.
/// </summary>
public sealed class ProctoringEvidenceUseCase(
    IProctoringEvidenceRepository repository,
    IProctoringEvidenceStore objectStore)
{
    public async Task<ProctoringMediaConsentResult> AcceptMediaConsentAsync(
        Guid organizationId, Guid candidateId, Guid assignmentId,
        bool accepted, CancellationToken ct)
    {
        if (!accepted)
            throw new ProctoringException(ProctoringError.InvalidInput, "media_consent_required");
        await repository.AcceptMediaConsentAsync(organizationId, candidateId, assignmentId,
            ProctoringEvidencePolicy.MediaConsentVersion, ct);
        return new ProctoringMediaConsentResult(true, ProctoringEvidencePolicy.MediaConsentVersion);
    }

    public async Task<ProctoringMediaStopResult> StopMediaCaptureAsync(
        Guid organizationId, Guid candidateId, Guid assignmentId, CancellationToken ct)
    {
        await repository.StopMediaCaptureAsync(organizationId, candidateId, assignmentId, ct);
        return new ProctoringMediaStopResult(true);
    }

    public async Task<ProctoringMediaIntentResult> CreateIntentAsync(
        Guid organizationId, Guid candidateId, Guid assignmentId,
        Guid clientCaptureId, string? mediaType, string? captureReason,
        string? contentType, CancellationToken ct)
    {
        if (clientCaptureId == Guid.Empty || mediaType is null || captureReason is null
            || contentType is null)
            throw new ProctoringException(ProctoringError.InvalidInput, "invalid_evidence_intent");
        var maximumBytes = ProctoringEvidencePolicy.MaximumBytesFor(mediaType, contentType);
        if (maximumBytes is null || captureReason is not ("periodic" or "event"))
            throw new ProctoringException(ProctoringError.InvalidInput, "invalid_evidence_media");

        var intent = await repository.ReserveIntentAsync(organizationId, candidateId,
            assignmentId, clientCaptureId, mediaType, captureReason, contentType,
            maximumBytes.Value, ct);
        var expiresAt = DateTime.SpecifyKind(intent.IntentExpiresAt, DateTimeKind.Utc);
        if (intent.Status != "intent")
            return new ProctoringMediaIntentResult(intent.EvidenceId, intent.Status,
                expiresAt, null, null);
        if (expiresAt <= DateTime.UtcNow.AddSeconds(5))
            throw new ProctoringException(ProctoringError.Conflict, "evidence_intent_expired");

        var grant = await objectStore.CreateUploadGrantAsync(intent.StagingObjectKey,
            intent.ContentType, intent.MaxBytes, expiresAt, ct);
        return new ProctoringMediaIntentResult(intent.EvidenceId, intent.Status,
            expiresAt, grant.Url, grant.Fields);
    }

    public async Task<ProctoringMediaConfirmResult> ConfirmAsync(
        Guid organizationId, Guid candidateId, Guid assignmentId, Guid evidenceId,
        bool cloudInferenceEnabled, string? modelRevision, CancellationToken ct)
    {
        if (evidenceId == Guid.Empty)
            throw new ProctoringException(ProctoringError.InvalidInput, "invalid_evidence_id");
        if (cloudInferenceEnabled && (string.IsNullOrWhiteSpace(modelRevision)
            || modelRevision.Length > 128))
            throw new ProctoringException(ProctoringError.Conflict, "inference_model_not_configured");

        var lease = await repository.BeginConfirmAsync(organizationId, candidateId,
            assignmentId, evidenceId, ct);
        if (lease.AlreadyReady)
        {
            if (lease.ExpiresAt is not { } existingExpiry)
                throw new ProctoringException(ProctoringError.Conflict, "evidence_state_invalid");
            return new ProctoringMediaConfirmResult(evidenceId, "ready",
                DateTime.SpecifyKind(existingExpiry, DateTimeKind.Utc));
        }

        ProctoringSealedObject? sealedObject = null;
        try
        {
            var sealedKeyPrefix = $"sealed/{organizationId:D}/{lease.SessionId:D}/{evidenceId:D}";
            sealedObject = await objectStore.SealAsync(lease.StagingObjectKey,
                sealedKeyPrefix, lease.ContentType, lease.MaxBytes, ct);
            var enqueueInference = cloudInferenceEnabled && lease.MediaType == "camera";
            var ready = await repository.FinishConfirmAsync(organizationId, candidateId,
                assignmentId, evidenceId, sealedObject,
                enqueueInference ? modelRevision : null, enqueueInference,
                lease.LeaseUpdatedAt, ct);
            return new ProctoringMediaConfirmResult(evidenceId, "ready",
                DateTime.SpecifyKind(ready.ExpiresAt, DateTimeKind.Utc));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            await DeleteUncommittedSealBestEffortAsync(organizationId, evidenceId, sealedObject);
            await ResetConfirmLeaseBestEffortAsync(organizationId, candidateId,
                assignmentId, evidenceId, lease.LeaseUpdatedAt);
            throw;
        }
        catch (ProctoringException ex) when (ex.Error == ProctoringError.TooManyRequests)
        {
            await ResetConfirmLeaseBestEffortAsync(organizationId, candidateId,
                assignmentId, evidenceId, lease.LeaseUpdatedAt);
            throw;
        }
        catch
        {
            await DeleteUncommittedSealBestEffortAsync(organizationId, evidenceId, sealedObject);
            await ResetConfirmLeaseBestEffortAsync(organizationId, candidateId,
                assignmentId, evidenceId, lease.LeaseUpdatedAt);
            throw new ProctoringException(ProctoringError.Conflict, "evidence_confirmation_failed");
        }
    }

    private async Task DeleteUncommittedSealBestEffortAsync(Guid organizationId,
        Guid evidenceId, ProctoringSealedObject? sealedObject)
    {
        if (sealedObject is null) return;
        using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try
        {
            // A lost commit acknowledgement is ambiguous: it may have made
            // this exact key ready. Confirm DB state before deleting it. A
            // retry writes a different attempt key, so a negative result is
            // safe even if another confirmation begins during this cleanup.
            var row = await repository.GetForResultAsync(organizationId,
                evidenceId, cleanup.Token);
            if (row?.SealedObjectKey != sealedObject.Key)
                await objectStore.DeleteAsync(sealedObject.Key, cleanup.Token);
        }
        catch { /* Never delete when DB state cannot be established. */ }
    }

    private async Task ResetConfirmLeaseBestEffortAsync(Guid organizationId,
        Guid candidateId, Guid assignmentId, Guid evidenceId, DateTime leaseUpdatedAt)
    {
        // The request may have been cancelled after the repository leased the
        // row. Use a short independent token so a retry is not blocked until
        // the lease reaper runs; a failed cleanup still leaves that fallback.
        using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try
        {
            await repository.ResetConfirmAsync(organizationId, candidateId,
                assignmentId, evidenceId, leaseUpdatedAt, cleanup.Token);
        }
        catch { /* Preserve the original failure without exposing internals. */ }
    }
}
