using Tims.Application.Proctoring;
using Tims.Domain.Proctoring;

namespace Tims.UnitTests.Proctoring;

public sealed class ProctoringEvidenceUseCaseTests
{
    private static readonly Guid OrgId = Guid.NewGuid();
    private static readonly Guid CandidateId = Guid.NewGuid();
    private static readonly Guid AssignmentId = Guid.NewGuid();
    private static readonly Guid EvidenceId = Guid.NewGuid();
    private static readonly Guid SessionId = Guid.NewGuid();

    [Fact]
    public async Task Media_consent_is_separate_from_signal_consent()
    {
        var repository = new FakeRepository();
        var useCase = new ProctoringEvidenceUseCase(repository, new FakeStore());

        await Assert.ThrowsAsync<ProctoringException>(() =>
            useCase.AcceptMediaConsentAsync(OrgId, CandidateId, AssignmentId,
                false, CancellationToken.None));
        Assert.Null(repository.ConsentVersion);

        var accepted = await useCase.AcceptMediaConsentAsync(OrgId, CandidateId,
            AssignmentId, true, CancellationToken.None);
        Assert.Equal(ProctoringEvidencePolicy.MediaConsentVersion, accepted.ConsentVersion);
        Assert.Equal(accepted.ConsentVersion, repository.ConsentVersion);
        Assert.NotEqual(ProctoringSignalPolicy.ConsentVersion, accepted.ConsentVersion);
    }

    [Fact]
    public async Task Stopping_media_calls_the_authoritative_repository()
    {
        var repository = new FakeRepository();
        var useCase = new ProctoringEvidenceUseCase(repository, new FakeStore());

        var result = await useCase.StopMediaCaptureAsync(
            OrgId, CandidateId, AssignmentId, CancellationToken.None);

        Assert.True(result.Stopped);
        Assert.True(repository.MediaStopped);
    }

    [Fact]
    public async Task Upload_intent_signs_only_supported_media_and_existing_ready_retry_gets_no_grant()
    {
        var repository = new FakeRepository();
        var store = new FakeStore();
        var useCase = new ProctoringEvidenceUseCase(repository, store);

        await Assert.ThrowsAsync<ProctoringException>(() => useCase.CreateIntentAsync(
            OrgId, CandidateId, AssignmentId, Guid.NewGuid(), "camera", "periodic",
            "image/png", CancellationToken.None));
        Assert.Equal(0, repository.Reservations);

        var first = await useCase.CreateIntentAsync(OrgId, CandidateId, AssignmentId,
            Guid.NewGuid(), "screen", "event", "image/webp", CancellationToken.None);
        Assert.Equal(EvidenceId, first.EvidenceId);
        Assert.Equal("https://s3.example.test/upload", first.UploadUrl);
        Assert.Equal(ProctoringEvidencePolicy.MaximumScreenBytes, store.LastMaximumBytes);
        Assert.Equal(1, store.GrantCalls);

        repository.IntentStatus = "ready";
        var retry = await useCase.CreateIntentAsync(OrgId, CandidateId, AssignmentId,
            Guid.NewGuid(), "screen", "event", "image/webp", CancellationToken.None);
        Assert.Equal("ready", retry.Status);
        Assert.Null(retry.UploadUrl);
        Assert.Null(retry.UploadFields);
        Assert.Equal(1, store.GrantCalls);
    }

    [Fact]
    public async Task Confirm_seals_before_ready_and_enqueues_only_camera_when_cloud_is_enabled()
    {
        var repository = new FakeRepository();
        var store = new FakeStore();
        var useCase = new ProctoringEvidenceUseCase(repository, store);

        var result = await useCase.ConfirmAsync(OrgId, CandidateId, AssignmentId,
            EvidenceId, true, "camera-v1-eval", CancellationToken.None);
        Assert.Equal("ready", result.Status);
        Assert.Equal($"sealed/{OrgId:D}/{SessionId:D}/{EvidenceId:D}", store.LastSealedPrefix);
        Assert.Equal("camera-v1-eval", repository.FinishedModelRevision);
        Assert.True(repository.FinishedCloudInferenceEnabled);
        Assert.Equal(1, store.SealCalls);

        repository.LeaseMediaType = "screen";
        await useCase.ConfirmAsync(OrgId, CandidateId, AssignmentId,
            EvidenceId, true, "camera-v1-eval", CancellationToken.None);
        Assert.Null(repository.FinishedModelRevision);
        Assert.False(repository.FinishedCloudInferenceEnabled);

        repository.AlreadyReady = true;
        await useCase.ConfirmAsync(OrgId, CandidateId, AssignmentId,
            EvidenceId, true, "camera-v1-eval", CancellationToken.None);
        Assert.Equal(2, store.SealCalls);
    }

    [Fact]
    public async Task Failed_seal_releases_lease_and_never_marks_evidence_ready()
    {
        var repository = new FakeRepository();
        var store = new FakeStore { FailSeal = true };
        var useCase = new ProctoringEvidenceUseCase(repository, store);

        var error = await Assert.ThrowsAsync<ProctoringException>(() => useCase.ConfirmAsync(
            OrgId, CandidateId, AssignmentId, EvidenceId, false, null, CancellationToken.None));
        Assert.Equal("evidence_confirmation_failed", error.Code);
        Assert.True(repository.ResetCalled);
        Assert.False(repository.FinishCalled);
    }

    [Fact]
    public async Task Saturated_seal_preserves_rate_limit_and_releases_confirmation_lease()
    {
        var repository = new FakeRepository();
        var useCase = new ProctoringEvidenceUseCase(repository,
            new FakeStore { BusySeal = true });

        var error = await Assert.ThrowsAsync<ProctoringException>(() => useCase.ConfirmAsync(
            OrgId, CandidateId, AssignmentId, EvidenceId, false, null, CancellationToken.None));

        Assert.Equal(ProctoringError.TooManyRequests, error.Error);
        Assert.Equal("evidence_confirmation_busy", error.Code);
        Assert.True(repository.ResetCalled);
        Assert.False(repository.FinishCalled);
    }

    [Fact]
    public async Task Cancelled_confirmation_cleans_up_lease_with_independent_token()
    {
        var repository = new FakeRepository();
        using var cancellation = new CancellationTokenSource();
        var useCase = new ProctoringEvidenceUseCase(repository,
            new FakeStore { CancelSeal = cancellation });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => useCase.ConfirmAsync(
            OrgId, CandidateId, AssignmentId, EvidenceId, false, null, cancellation.Token));

        Assert.True(repository.ResetCalled);
        Assert.True(repository.ResetUsedActiveToken);
        Assert.False(repository.FinishCalled);
    }

    [Fact]
    public async Task Session_stop_after_seal_deletes_only_the_uncommitted_attempt()
    {
        var repository = new FakeRepository { FailFinishBeforeCommit = true };
        var store = new FakeStore();
        var useCase = new ProctoringEvidenceUseCase(repository, store);

        var error = await Assert.ThrowsAsync<ProctoringException>(() => useCase.ConfirmAsync(
            OrgId, CandidateId, AssignmentId, EvidenceId, false, null, CancellationToken.None));

        Assert.Equal("evidence_confirmation_failed", error.Code);
        Assert.True(repository.FinishCalled);
        Assert.True(repository.ResetCalled);
        Assert.Equal(store.LastSealedKey, Assert.Single(store.DeletedKeys));
    }

    [Fact]
    public async Task Lost_commit_acknowledgement_preserves_ready_evidence()
    {
        var repository = new FakeRepository { FailFinishAfterCommit = true };
        var store = new FakeStore();
        var useCase = new ProctoringEvidenceUseCase(repository, store);

        await Assert.ThrowsAsync<ProctoringException>(() => useCase.ConfirmAsync(
            OrgId, CandidateId, AssignmentId, EvidenceId, false, null, CancellationToken.None));

        Assert.Equal(store.LastSealedKey, repository.CurrentSealedKey);
        Assert.Empty(store.DeletedKeys);
    }

    [Fact]
    public async Task Unavailable_db_state_never_causes_unsafe_delete()
    {
        var repository = new FakeRepository
        {
            FailFinishBeforeCommit = true,
            FailResultLookup = true,
        };
        var store = new FakeStore();

        await Assert.ThrowsAsync<ProctoringException>(() =>
            new ProctoringEvidenceUseCase(repository, store).ConfirmAsync(
                OrgId, CandidateId, AssignmentId, EvidenceId, false, null,
                CancellationToken.None));

        Assert.Empty(store.DeletedKeys);
        Assert.True(repository.ResetCalled);
    }

    private sealed class FakeStore : IProctoringEvidenceStore
    {
        public int GrantCalls { get; private set; }
        public int SealCalls { get; private set; }
        public int LastMaximumBytes { get; private set; }
        public string? LastSealedPrefix { get; private set; }
        public string? LastSealedKey { get; private set; }
        public List<string> DeletedKeys { get; } = [];
        public bool FailSeal { get; init; }
        public bool BusySeal { get; init; }
        public CancellationTokenSource? CancelSeal { get; init; }

        public Task<ProctoringUploadGrant> CreateUploadGrantAsync(string stagingKey,
            string contentType, int maximumBytes, DateTime expiresAt, CancellationToken ct)
        {
            GrantCalls++;
            LastMaximumBytes = maximumBytes;
            return Task.FromResult(new ProctoringUploadGrant("https://s3.example.test/upload",
                new Dictionary<string, string> { ["key"] = stagingKey }, expiresAt));
        }

        public Task<ProctoringSealedObject> SealAsync(string stagingKey,
            string sealedKeyPrefix, string contentType, int maximumBytes, CancellationToken ct)
        {
            SealCalls++;
            LastSealedPrefix = sealedKeyPrefix;
            if (BusySeal)
                throw new ProctoringException(ProctoringError.TooManyRequests,
                    "evidence_confirmation_busy");
            if (CancelSeal is not null)
            {
                CancelSeal.Cancel();
                ct.ThrowIfCancellationRequested();
            }
            if (FailSeal) throw new IOException("S3 failed");
            LastSealedKey = sealedKeyPrefix + "/hash-" + Guid.NewGuid().ToString("N") + ".jpg";
            return Task.FromResult(new ProctoringSealedObject(LastSealedKey,
                new string('a', 64), "source-etag", "sealed-etag", 512));
        }

        public Task DeleteAsync(string key, CancellationToken ct)
        {
            DeletedKeys.Add(key);
            return Task.CompletedTask;
        }

        public Task<ProctoringReadGrant> CreateReadGrantAsync(string sealedKey,
            string contentType, DateTime expiresAt, CancellationToken ct) =>
            throw new NotSupportedException();
    }

    private sealed class FakeRepository : IProctoringEvidenceRepository
    {
        public string? ConsentVersion { get; private set; }
        public int Reservations { get; private set; }
        public string IntentStatus { get; set; } = "intent";
        public string LeaseMediaType { get; set; } = "camera";
        public bool AlreadyReady { get; set; }
        public bool ResetCalled { get; private set; }
        public bool ResetUsedActiveToken { get; private set; }
        public bool FinishCalled { get; private set; }
        public string? FinishedModelRevision { get; private set; }
        public bool FinishedCloudInferenceEnabled { get; private set; }
        public bool MediaStopped { get; private set; }
        public bool FailFinishBeforeCommit { get; init; }
        public bool FailFinishAfterCommit { get; init; }
        public bool FailResultLookup { get; init; }
        public string? CurrentSealedKey { get; private set; }

        public Task AcceptMediaConsentAsync(Guid organizationId, Guid candidateId,
            Guid assignmentId, string consentVersion, CancellationToken ct)
        {
            ConsentVersion = consentVersion;
            return Task.CompletedTask;
        }

        public Task StopMediaCaptureAsync(Guid organizationId, Guid candidateId,
            Guid assignmentId, CancellationToken ct)
        {
            MediaStopped = true;
            return Task.CompletedTask;
        }

        public Task<ProctoringEvidenceIntent> ReserveIntentAsync(Guid organizationId,
            Guid candidateId, Guid assignmentId, Guid clientCaptureId,
            string mediaType, string captureReason, string contentType, int maxBytes,
            CancellationToken ct)
        {
            Reservations++;
            return Task.FromResult(new ProctoringEvidenceIntent(EvidenceId, SessionId,
                IntentStatus, "staging/tenant/session/evidence.jpg", mediaType,
                captureReason, 0, contentType, maxBytes, DateTime.UtcNow.AddMinutes(2)));
        }

        public Task<ProctoringConfirmLease> BeginConfirmAsync(Guid organizationId,
            Guid candidateId, Guid assignmentId, Guid evidenceId, CancellationToken ct) =>
            Task.FromResult(new ProctoringConfirmLease(evidenceId, SessionId,
                AlreadyReady ? "ready" : "confirming", "staging/tenant/session/evidence.jpg",
                LeaseMediaType, "image/jpeg", 1024, DateTime.UtcNow.AddMinutes(2),
                DateTime.UtcNow,
                AlreadyReady, AlreadyReady ? "sealed/path.jpg" : null,
                AlreadyReady ? new string('a', 64) : null,
                AlreadyReady ? DateTime.UtcNow.AddDays(7) : null));

        public Task<ProctoringEvidenceReady> FinishConfirmAsync(Guid organizationId,
            Guid candidateId, Guid assignmentId, Guid evidenceId,
            ProctoringSealedObject sealedObject, string? modelRevision,
            bool cloudInferenceEnabled, DateTime leaseUpdatedAt, CancellationToken ct)
        {
            FinishCalled = true;
            FinishedModelRevision = modelRevision;
            FinishedCloudInferenceEnabled = cloudInferenceEnabled;
            if (FailFinishBeforeCommit)
                throw new ProctoringException(ProctoringError.Conflict,
                    "media_capture_stopped");
            CurrentSealedKey = sealedObject.Key;
            if (FailFinishAfterCommit) throw new IOException("commit acknowledgement lost");
            return Task.FromResult(new ProctoringEvidenceReady(evidenceId,
                sealedObject.Key, sealedObject.Sha256, DateTime.UtcNow.AddDays(7)));
        }

        public Task ResetConfirmAsync(Guid organizationId, Guid candidateId,
            Guid assignmentId, Guid evidenceId, DateTime leaseUpdatedAt, CancellationToken ct)
        {
            ResetCalled = true;
            ResetUsedActiveToken = !ct.IsCancellationRequested;
            return Task.CompletedTask;
        }

        public Task<ProctoringEvidenceForResult?> GetForResultAsync(Guid organizationId,
            Guid evidenceId, CancellationToken ct)
        {
            if (FailResultLookup) throw new IOException("database unavailable");
            return Task.FromResult<ProctoringEvidenceForResult?>(new ProctoringEvidenceForResult(
                evidenceId, organizationId, AssignmentId, SessionId, LeaseMediaType,
                CurrentSealedKey is null ? "confirming" : "ready", CurrentSealedKey,
                CurrentSealedKey is null ? null : new string('a', 64), null,
                CurrentSealedKey is null ? null : DateTime.UtcNow.AddDays(7)));
        }

        public Task<IReadOnlyList<Guid>> ListPendingOutboxOrganizationIdsAsync(
            int maxCount, CancellationToken ct) => throw new NotSupportedException();

        public Task<IReadOnlyList<ProctoringOutboxClaim>> ClaimPendingOutboxAsync(
            Guid organizationId, int maxCount, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<bool> MarkOutboxDispatchedAsync(Guid organizationId,
            Guid outboxId, int claimAttempt, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<bool> MarkOutboxRetryAsync(Guid organizationId, Guid outboxId,
            int claimAttempt, string errorCode, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<Guid>> ListStaleDispatchedOutboxOrganizationIdsAsync(
            int maxCount, CancellationToken ct) => throw new NotSupportedException();

        public Task<int> MarkStaleDispatchedUnavailableAsync(Guid organizationId,
            int maxCount, CancellationToken ct) => throw new NotSupportedException();

        public Task<ProctoringInferenceApplyResult> ApplyInferenceResultAsync(
            Guid organizationId, ProctoringInferenceResult result, CancellationToken ct) =>
            throw new NotSupportedException();
    }
}
