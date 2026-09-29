using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Application.Proctoring;
using Tims.Domain.Access;
using Tims.Domain.Audit;
using Tims.Infrastructure.Proctoring;

namespace Tims.IntegrationTests.Proctoring;

/// <summary>Real PostgreSQL proof using the shipped Prisma evidence migration.</summary>
public sealed class ProctoringEvidenceRepositoryTests : IAsyncLifetime
{
    private static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid CandidateA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid CandidateB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid AssignmentA = Guid.Parse("cccccccc-cccc-cccc-cccc-ccccccccccca");
    private static readonly Guid AssignmentB = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccb");
    private static readonly Guid SessionA = Guid.Parse("dddddddd-dddd-dddd-dddd-ddddddddddda");
    private static readonly Guid Actor = Guid.Parse("99999999-9999-9999-9999-999999999999");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres").WithPassword("postgres")
        .WithDatabase("tims_proctoring_evidence").Build();
    private string _connectionString = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();
        await ExecuteAsync(BaseSchemaSql);
        await ExecuteAsync(File.ReadAllText(FindMigration()));
        await ExecuteAsync(SeedSql);
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();

    [Fact]
    public async Task Consent_reservation_confirmation_and_outbox_are_tenant_safe_and_idempotent()
    {
        await using var db = NewContext();
        var repository = new ProctoringEvidenceRepository(db);
        var captureId = Guid.NewGuid();

        var beforeConsent = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA, captureId,
                "camera", "periodic", "image/jpeg", 2 * 1024 * 1024, default));
        Assert.Equal("media_consent_required", beforeConsent.Code);
        var wrongTenant = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.AcceptMediaConsentAsync(OrgB, CandidateB, AssignmentA,
                "camera-screen-stills-v1", default));
        Assert.Equal("assignment_not_found", wrongTenant.Code);

        await repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
            "camera-screen-stills-v1", default);
        await repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
            "camera-screen-stills-v1", default);
        var mismatch = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
                "changed-notice", default));
        Assert.Equal("media_consent_version_changed", mismatch.Code);

        var first = await repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
            captureId, "camera", "periodic", "image/jpeg", 2 * 1024 * 1024, default);
        var retry = await repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
            captureId, "camera", "periodic", "image/jpeg", 2 * 1024 * 1024, default);
        Assert.Equal(first.EvidenceId, retry.EvidenceId);
        Assert.Equal("intent", retry.Status);
        Assert.Equal(0, first.CaptureSlot);
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_evidence WHERE organization_id = @id", OrgA));

        var lease1 = await repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
            first.EvidenceId, default);
        Assert.False(lease1.AlreadyReady);
        await repository.ResetConfirmAsync(OrgA, CandidateA, AssignmentA,
            first.EvidenceId, lease1.LeaseUpdatedAt, default);
        var lease2 = await repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
            first.EvidenceId, default);
        Assert.NotEqual(lease1.LeaseUpdatedAt, lease2.LeaseUpdatedAt);
        await ExecuteAsync("""
            UPDATE proctoring_evidence
               SET updated_at = CURRENT_TIMESTAMP - INTERVAL '61 seconds'
             WHERE id = @id
            """, first.EvidenceId);
        var lease3 = await repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
            first.EvidenceId, default);
        Assert.NotEqual(lease2.LeaseUpdatedAt, lease3.LeaseUpdatedAt);
        await repository.ResetConfirmAsync(OrgA, CandidateA, AssignmentA,
            first.EvidenceId, lease2.LeaseUpdatedAt, default);
        var sealedObject = new ProctoringSealedObject(
            $"sealed/{OrgA:D}/{SessionA:D}/{first.EvidenceId:D}/" + new string('a', 64) + ".jpg",
            new string('a', 64), "source-etag", "sealed-etag", 1234);
        var oldLease = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.FinishConfirmAsync(OrgA, CandidateA, AssignmentA,
                first.EvidenceId, sealedObject, "hf-v1", true,
                lease2.LeaseUpdatedAt, default));
        Assert.Equal("evidence_not_confirming", oldLease.Code);

        var ready = await repository.FinishConfirmAsync(OrgA, CandidateA, AssignmentA,
            first.EvidenceId, sealedObject, "hf-v1", true,
            lease3.LeaseUpdatedAt, default);
        Assert.Equal(sealedObject.Key, ready.SealedObjectKey);
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_inference_outbox WHERE evidence_id = @id",
            first.EvidenceId));
        var beginRetry = await repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
            first.EvidenceId, default);
        Assert.True(beginRetry.AlreadyReady);
        var finishRetry = await repository.FinishConfirmAsync(OrgA, CandidateA, AssignmentA,
            first.EvidenceId, sealedObject, "hf-v1", true,
            lease3.LeaseUpdatedAt, default);
        Assert.Equal(ready, finishRetry);
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_inference_outbox WHERE evidence_id = @id",
            first.EvidenceId));
        Assert.Null(await repository.GetForResultAsync(OrgB, first.EvidenceId, default));
        var result = await repository.GetForResultAsync(OrgA, first.EvidenceId, default);
        Assert.NotNull(result);
        Assert.Equal("ready", result.Status);
        Assert.Equal(AssignmentA, result.AssignmentId);
        Assert.Equal("hf-v1", result.ModelRevision);

        Assert.Contains(OrgA, await repository.ListPendingOutboxOrganizationIdsAsync(10, default));
        var claims = await repository.ClaimPendingOutboxAsync(OrgA, 10, default);
        var claim = Assert.Single(claims);
        Assert.Equal(first.EvidenceId, claim.EvidenceId);
        Assert.Equal(1, claim.ClaimAttempt);
        Assert.Empty(await repository.ClaimPendingOutboxAsync(OrgA, 10, default));
        Assert.True(await repository.MarkOutboxRetryAsync(OrgA, claim.OutboxId,
            claim.ClaimAttempt, "sqs_unavailable", default));
        await ExecuteAsync("""
            UPDATE proctoring_inference_outbox
               SET available_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
             WHERE id = @id
            """, claim.OutboxId);
        var reclaimed = Assert.Single(await repository.ClaimPendingOutboxAsync(OrgA, 10, default));
        Assert.Equal(2, reclaimed.ClaimAttempt);
        Assert.False(await repository.MarkOutboxDispatchedAsync(OrgA, claim.OutboxId,
            claim.ClaimAttempt, default));
        Assert.True(await repository.MarkOutboxDispatchedAsync(OrgA, reclaimed.OutboxId,
            reclaimed.ClaimAttempt, default));

        var inference = new ProctoringInferenceResult(1, OrgA, first.EvidenceId,
            sealedObject.Sha256, "hf-v1", "completed",
            [
                new ProctoringDetectorResult("rekognition_detect_faces", "face-v1", "completed",
                    [new ProctoringDetectorFinding("face_count", null, 0)], null),
                new ProctoringDetectorResult("hf_object_detector", "hf-v1", "completed",
                    [new ProctoringDetectorFinding("person", 0.94, 1)], null),
            ], DateTime.UtcNow);
        Assert.Equal("applied", (await repository.ApplyInferenceResultAsync(
            OrgA, inference, default)).Status);
        Assert.Equal("duplicate", (await repository.ApplyInferenceResultAsync(
            OrgA, inference, default)).Status);
        Assert.Equal(2L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_findings WHERE evidence_id = @id",
            first.EvidenceId));
        Assert.Equal("processed", await ScalarAsync<string>(
            "SELECT status FROM proctoring_evidence WHERE id = @id", first.EvidenceId));
        Assert.Equal("mismatch", (await repository.ApplyInferenceResultAsync(
            OrgB, inference, default)).Status);
    }

    [Fact]
    public async Task Inference_accepts_hf_cues_when_rekognition_is_unavailable_and_rejects_null_counts()
    {
        await using var db = NewContext();
        var repository = new ProctoringEvidenceRepository(db);
        await repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
            "camera-screen-stills-v1", default);
        var intent = await repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
            Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default);
        var lease = await repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
            intent.EvidenceId, default);
        var sealedObject = new ProctoringSealedObject(
            $"sealed/{OrgA:D}/{SessionA:D}/{intent.EvidenceId:D}/" + new string('b', 64) + ".jpg",
            new string('b', 64), "source-etag", "sealed-etag", 1234);
        await repository.FinishConfirmAsync(OrgA, CandidateA, AssignmentA,
            intent.EvidenceId, sealedObject, "hf-v1", true, lease.LeaseUpdatedAt, default);

        var mixed = new ProctoringInferenceResult(1, OrgA, intent.EvidenceId,
            sealedObject.Sha256, "hf-v1", "unavailable",
            [
                new ProctoringDetectorResult("rekognition_detect_faces", "face-v1", "unavailable",
                    [], "rekognition_unavailable"),
                new ProctoringDetectorResult("hf_object_detector", "hf-v1", "completed",
                    [new ProctoringDetectorFinding("cell_phone", 0.81, 1)], null),
            ], DateTime.UtcNow);
        var noCount = mixed with
        {
            Detectors =
            [mixed.Detectors[0], mixed.Detectors[1] with
                { Findings = [new ProctoringDetectorFinding("cell_phone", 0.81, null)] }]
        };
        Assert.Equal("mismatch", (await repository.ApplyInferenceResultAsync(
            OrgA, noCount, default)).Status);
        Assert.Equal("ready", await ScalarAsync<string>(
            "SELECT status FROM proctoring_evidence WHERE id = @id", intent.EvidenceId));
        Assert.Equal("applied", (await repository.ApplyInferenceResultAsync(
            OrgA, mixed, default)).Status);
        Assert.Equal("unavailable", await ScalarAsync<string>(
            "SELECT status FROM proctoring_evidence WHERE id = @id", intent.EvidenceId));
        Assert.Equal(2L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_findings WHERE evidence_id = @id", intent.EvidenceId));
    }

    [Fact]
    public async Task Submission_or_session_end_blocks_new_confirm_leases_and_sealing()
    {
        await using var db = NewContext();
        var repository = new ProctoringEvidenceRepository(db);
        await repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
            "camera-screen-stills-v1", default);
        var leased = await repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
            Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default);
        var notLeased = await repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
            Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default);
        var lease = await repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
            leased.EvidenceId, default);
        var sealedObject = new ProctoringSealedObject(
            $"sealed/{OrgA:D}/{SessionA:D}/{leased.EvidenceId:D}/" + new string('c', 64) + ".jpg",
            new string('c', 64), "source-etag", "sealed-etag", 1234);

        await ExecuteAsync("""
            UPDATE assessment_assignments SET status = 'completed',
                completed_at = CURRENT_TIMESTAMP WHERE id = @id
            """, AssignmentA);
        var beginAfterSubmit = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
                notLeased.EvidenceId, default));
        Assert.Equal("assignment_not_in_progress", beginAfterSubmit.Code);
        var finishAfterSubmit = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.FinishConfirmAsync(OrgA, CandidateA, AssignmentA,
                leased.EvidenceId, sealedObject, "hf-v1", true,
                lease.LeaseUpdatedAt, default));
        Assert.Equal("assignment_not_in_progress", finishAfterSubmit.Code);
        Assert.Equal("confirming", await ScalarAsync<string>(
            "SELECT status FROM proctoring_evidence WHERE id = @id", leased.EvidenceId));
        Assert.Equal(0L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_inference_outbox WHERE evidence_id = @id",
            leased.EvidenceId));

        // A delayed proctoring completion callback can leave the assignment
        // active briefly after the session ends. Check that independent guard.
        await ExecuteAsync("UPDATE assessment_assignments SET status = 'in_progress' WHERE id = @id",
            AssignmentA);
        await ExecuteAsync("UPDATE proctoring_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = @id",
            SessionA);
        var beginAfterEnd = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
                notLeased.EvidenceId, default));
        Assert.Equal("proctoring_session_not_active", beginAfterEnd.Code);
        var finishAfterEnd = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.FinishConfirmAsync(OrgA, CandidateA, AssignmentA,
                leased.EvidenceId, sealedObject, "hf-v1", true,
                lease.LeaseUpdatedAt, default));
        Assert.Equal("proctoring_session_not_active", finishAfterEnd.Code);
    }

    [Fact]
    public async Task Media_consent_and_capture_reject_long_or_untimed_assessments()
    {
        await using var db = NewContext();
        var repository = new ProctoringEvidenceRepository(db);
        await ExecuteAsync("UPDATE assessment_types SET duration = 60 WHERE id = @id",
            Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"));
        var longAssessment = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
                "camera-screen-stills-v1", default));
        Assert.Equal("media_duration_unsupported", longAssessment.Code);

        await ExecuteAsync("UPDATE assessment_types SET duration = 30 WHERE id = @id",
            Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"));
        await repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
            "camera-screen-stills-v1", default);
        await ExecuteAsync("UPDATE assessment_types SET duration = NULL WHERE id = @id",
            Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"));
        var untimed = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
                Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default));
        Assert.Equal("media_duration_unsupported", untimed.Code);
        Assert.Equal(0L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_evidence WHERE organization_id = @id", OrgA));
    }

    [Fact]
    public async Task Stopping_media_is_irreversible_and_blocks_consent_intents_and_sealing()
    {
        await using var db = NewContext();
        var repository = new ProctoringEvidenceRepository(db);
        await repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
            "camera-screen-stills-v1", default);
        var leased = await repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
            Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default);
        var notLeased = await repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
            Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default);
        var lease = await repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
            leased.EvidenceId, default);
        var sealedObject = new ProctoringSealedObject(
            $"sealed/{OrgA:D}/{SessionA:D}/{leased.EvidenceId:D}/" + new string('f', 64) + ".jpg",
            new string('f', 64), "source-etag", "sealed-etag", 1234);
        var wrongTenant = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.StopMediaCaptureAsync(OrgB, CandidateB, AssignmentA, default));
        Assert.Equal("assignment_not_found", wrongTenant.Code);

        await ExecuteAsync("UPDATE org_entitlements SET enabled = false WHERE organization_id = @id",
            OrgA);
        await repository.StopMediaCaptureAsync(OrgA, CandidateA, AssignmentA, default);
        await ExecuteAsync("UPDATE org_entitlements SET enabled = true WHERE organization_id = @id",
            OrgA);
        await repository.StopMediaCaptureAsync(OrgA, CandidateA, AssignmentA, default);
        Assert.False(await ScalarAsync<bool>(
            "SELECT media_stopped_at IS NULL FROM proctoring_sessions WHERE id = @id", SessionA));
        var reConsent = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
                "camera-screen-stills-v1", default));
        Assert.Equal("media_capture_stopped", reConsent.Code);
        var newIntent = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
                Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default));
        Assert.Equal("media_capture_stopped", newIntent.Code);
        var beginExisting = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
                notLeased.EvidenceId, default));
        Assert.Equal("media_capture_stopped", beginExisting.Code);
        var finishExisting = await Assert.ThrowsAsync<ProctoringException>(() =>
            repository.FinishConfirmAsync(OrgA, CandidateA, AssignmentA,
                leased.EvidenceId, sealedObject, "hf-v1", true,
                lease.LeaseUpdatedAt, default));
        Assert.Equal("media_capture_stopped", finishExisting.Code);
        Assert.Equal(0L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_inference_outbox WHERE organization_id = @id", OrgA));
        var clearStop = await Assert.ThrowsAsync<PostgresException>(() =>
            ExecuteAsync("UPDATE proctoring_sessions SET media_stopped_at = NULL WHERE id = @id",
                SessionA));
        Assert.Equal(PostgresErrorCodes.CheckViolation, clearStop.SqlState);

        await ExecuteAsync("UPDATE assessment_assignments SET status = 'completed' WHERE id = @id",
            AssignmentA);
        await repository.StopMediaCaptureAsync(OrgA, CandidateA, AssignmentA, default);
    }

    [Fact]
    public async Task Media_stop_signal_atomically_revokes_future_capture()
    {
        await using var db = NewContext();
        var evidenceRepository = new ProctoringEvidenceRepository(db);
        await evidenceRepository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
            "camera-screen-stills-v1", default);
        var signalRepository = new CandidateProctoringRepository(db);
        var eventId = Guid.NewGuid();
        var reported = await signalRepository.ReportEventAsync(OrgA, CandidateA,
            AssignmentA, eventId, "media_capture_stopped", "low", null, default);
        Assert.True(reported.Accepted);
        Assert.False(await ScalarAsync<bool>(
            "SELECT media_stopped_at IS NULL FROM proctoring_sessions WHERE id = @id", SessionA));
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_events WHERE session_id = @id", SessionA));
        var replay = await signalRepository.ReportEventAsync(OrgA, CandidateA,
            AssignmentA, eventId, "media_capture_stopped", "low", null, default);
        Assert.False(replay.Accepted);
        var consent = await Assert.ThrowsAsync<ProctoringException>(() =>
            evidenceRepository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
                "camera-screen-stills-v1", default));
        Assert.Equal("media_capture_stopped", consent.Code);
        var intent = await Assert.ThrowsAsync<ProctoringException>(() =>
            evidenceRepository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
                Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default));
        Assert.Equal("media_capture_stopped", intent.Code);
    }

    [Fact]
    public async Task Daily_media_quota_serializes_concurrent_sessions_and_counts_expired_intents()
    {
        var assignmentC = Guid.Parse("abababab-abab-abab-abab-abababababab");
        await ExecuteAsync("""
            INSERT INTO assessment_assignments
              (id, organization_id, candidate_id, vacancy_id, assessment_type_id,
               proctoring_required, status)
            SELECT md5('quota-assignment-' || i)::uuid,
                   '11111111-1111-1111-1111-111111111111',
                   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                   'ffffffff-ffff-ffff-ffff-ffffffffffff', true, 'completed'
            FROM generate_series(0, 28) AS i;
            INSERT INTO proctoring_sessions
              (id, organization_id, assignment_id, started_at, ended_at)
            SELECT md5('quota-session-' || i)::uuid,
                   '11111111-1111-1111-1111-111111111111',
                   md5('quota-assignment-' || i)::uuid,
                   CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP
            FROM generate_series(0, 28) AS i;
            INSERT INTO proctoring_evidence
              (id, organization_id, assignment_id, session_id, client_capture_id,
               media_type, capture_reason, capture_slot, status, staging_object_key,
               content_type, max_bytes, intent_expires_at, created_at, updated_at)
            SELECT md5('quota-evidence-' || i)::uuid,
                   '11111111-1111-1111-1111-111111111111',
                   md5('quota-assignment-' || (i / 35))::uuid,
                   md5('quota-session-' || (i / 35))::uuid,
                   md5('quota-client-' || i)::uuid,
                   'camera', CASE WHEN i % 35 < 30 THEN 'periodic' ELSE 'event' END,
                   CASE WHEN i % 35 < 30 THEN i % 35 ELSE (i % 35) - 30 END,
                   'expired', 'staging/quota/' || i || '.jpg',
                   'image/jpeg', 2097152, CURRENT_TIMESTAMP + INTERVAL '2 minutes',
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM generate_series(0, 998) AS i;
            INSERT INTO assessment_assignments
              (id, organization_id, candidate_id, vacancy_id, assessment_type_id,
               proctoring_required, status)
            VALUES ('abababab-abab-abab-abab-abababababab',
                    '11111111-1111-1111-1111-111111111111',
                    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                    'ffffffff-ffff-ffff-ffff-ffffffffffff', true, 'in_progress');
            INSERT INTO proctoring_sessions
              (id, organization_id, assignment_id, started_at,
               consented_at, consent_version)
            VALUES ('cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd',
                    '11111111-1111-1111-1111-111111111111',
                    'abababab-abab-abab-abab-abababababab',
                    CURRENT_TIMESTAMP - INTERVAL '10 seconds', CURRENT_TIMESTAMP,
                    'camera-screen-signals-v1');
            """);

        await using (var consentDb = NewContext())
        {
            var consentRepository = new ProctoringEvidenceRepository(consentDb);
            await consentRepository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
                "camera-screen-stills-v1", default);
            await consentRepository.AcceptMediaConsentAsync(OrgA, CandidateA, assignmentC,
                "camera-screen-stills-v1", default);
        }

        var contenders = new[]
        {
            (AssignmentId: AssignmentA, CaptureId: Guid.NewGuid()),
            (AssignmentId: assignmentC, CaptureId: Guid.NewGuid()),
        };
        var attempts = contenders.Select(async contender =>
        {
            await using var db = NewContext();
            try
            {
                var intent = await new ProctoringEvidenceRepository(db).ReserveIntentAsync(
                    OrgA, CandidateA, contender.AssignmentId, contender.CaptureId,
                    "camera", "event", "image/jpeg", 2 * 1024 * 1024, default);
                return (contender.AssignmentId, contender.CaptureId, intent.EvidenceId);
            }
            catch (ProctoringException ex) when (ex.Code == "evidence_daily_quota")
            {
                return (contender.AssignmentId, contender.CaptureId, EvidenceId: Guid.Empty);
            }
        });
        var results = await Task.WhenAll(attempts);
        var winner = Assert.Single(results, result => result.EvidenceId != Guid.Empty);
        Assert.Equal(1, results.Count(result => result.EvidenceId == Guid.Empty));
        Assert.Equal(1_000L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_evidence WHERE organization_id = @id", OrgA));
        await using var retryDb = NewContext();
        var retry = await new ProctoringEvidenceRepository(retryDb).ReserveIntentAsync(
            OrgA, CandidateA, winner.AssignmentId, winner.CaptureId,
            "camera", "event", "image/jpeg", 2 * 1024 * 1024, default);
        Assert.Equal(winner.EvidenceId, retry.EvidenceId);
    }

    [Fact]
    public async Task Final_dispatch_failure_marks_evidence_unavailable_without_overwriting_a_result()
    {
        await using var db = NewContext();
        var repository = new ProctoringEvidenceRepository(db);
        await repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
            "camera-screen-stills-v1", default);
        var ready = await repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
            Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default);
        var readyLease = await repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
            ready.EvidenceId, default);
        var readySeal = new ProctoringSealedObject(
            $"sealed/{OrgA:D}/{SessionA:D}/{ready.EvidenceId:D}/" + new string('a', 64) + ".jpg",
            new string('a', 64), "source-a", "sealed-a", 1234);
        await repository.FinishConfirmAsync(OrgA, CandidateA, AssignmentA,
            ready.EvidenceId, readySeal, "hf-v1", true, readyLease.LeaseUpdatedAt, default);
        await ExecuteAsync("""
            UPDATE proctoring_inference_outbox
               SET status = 'sending', attempt_count = 10
             WHERE evidence_id = @id
            """, ready.EvidenceId);
        var readyOutboxId = await ScalarAsync<Guid>(
            "SELECT id FROM proctoring_inference_outbox WHERE evidence_id = @id",
            ready.EvidenceId);
        Assert.True(await repository.MarkOutboxRetryAsync(OrgA, readyOutboxId, 10,
            "sqs_unavailable", default));
        Assert.Equal("unavailable", await ScalarAsync<string>(
            "SELECT status FROM proctoring_evidence WHERE id = @id", ready.EvidenceId));
        Assert.Equal("inference_dispatch_failed", await ScalarAsync<string>(
            "SELECT failure_code FROM proctoring_evidence WHERE id = @id", ready.EvidenceId));
        Assert.Equal("dead", await ScalarAsync<string>(
            "SELECT status FROM proctoring_inference_outbox WHERE id = @id", readyOutboxId));
        Assert.Equal("inference_dispatch_failed", await ScalarAsync<string>(
            "SELECT failure_code FROM proctoring_findings WHERE evidence_id = @id",
            ready.EvidenceId));
        Assert.False(await repository.MarkOutboxRetryAsync(OrgA, readyOutboxId, 10,
            "sqs_unavailable", default));

        var processed = await repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
            Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default);
        var processedLease = await repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
            processed.EvidenceId, default);
        var processedSeal = new ProctoringSealedObject(
            $"sealed/{OrgA:D}/{SessionA:D}/{processed.EvidenceId:D}/" + new string('b', 64) + ".jpg",
            new string('b', 64), "source-b", "sealed-b", 1234);
        await repository.FinishConfirmAsync(OrgA, CandidateA, AssignmentA,
            processed.EvidenceId, processedSeal, "hf-v1", true,
            processedLease.LeaseUpdatedAt, default);
        var inference = new ProctoringInferenceResult(1, OrgA, processed.EvidenceId,
            processedSeal.Sha256, "hf-v1", "completed",
            [
                new ProctoringDetectorResult("rekognition_detect_faces", "face-v1",
                    "completed", [new ProctoringDetectorFinding("face_count", null, 1)], null),
                new ProctoringDetectorResult("hf_object_detector", "hf-v1",
                    "completed", [], null),
            ], DateTime.UtcNow);
        Assert.Equal("applied", (await repository.ApplyInferenceResultAsync(
            OrgA, inference, default)).Status);
        await ExecuteAsync("""
            UPDATE proctoring_inference_outbox
               SET status = 'sending', attempt_count = 10
             WHERE evidence_id = @id
            """, processed.EvidenceId);
        var processedOutboxId = await ScalarAsync<Guid>(
            "SELECT id FROM proctoring_inference_outbox WHERE evidence_id = @id",
            processed.EvidenceId);
        Assert.True(await repository.MarkOutboxRetryAsync(OrgA, processedOutboxId, 10,
            "sqs_unavailable", default));
        Assert.Equal("processed", await ScalarAsync<string>(
            "SELECT status FROM proctoring_evidence WHERE id = @id", processed.EvidenceId));
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_findings WHERE evidence_id = @id",
            processed.EvidenceId));
    }

    [Fact]
    public async Task Stale_dispatched_inference_becomes_an_explicit_unavailable_cue()
    {
        await using var db = NewContext();
        var repository = new ProctoringEvidenceRepository(db);
        await repository.AcceptMediaConsentAsync(OrgA, CandidateA, AssignmentA,
            "camera-screen-stills-v1", default);
        var intent = await repository.ReserveIntentAsync(OrgA, CandidateA, AssignmentA,
            Guid.NewGuid(), "camera", "event", "image/jpeg", 2 * 1024 * 1024, default);
        var lease = await repository.BeginConfirmAsync(OrgA, CandidateA, AssignmentA,
            intent.EvidenceId, default);
        var sealedObject = new ProctoringSealedObject(
            $"sealed/{OrgA:D}/{SessionA:D}/{intent.EvidenceId:D}/" + new string('d', 64) + ".jpg",
            new string('d', 64), "source-etag", "sealed-etag", 1234);
        await repository.FinishConfirmAsync(OrgA, CandidateA, AssignmentA,
            intent.EvidenceId, sealedObject, "hf-v1", true, lease.LeaseUpdatedAt, default);
        var claim = Assert.Single(await repository.ClaimPendingOutboxAsync(OrgA, 10, default));
        Assert.True(await repository.MarkOutboxDispatchedAsync(OrgA, claim.OutboxId,
            claim.ClaimAttempt, default));
        Assert.Empty(await repository.ListStaleDispatchedOutboxOrganizationIdsAsync(10, default));
        Assert.Equal(0, await repository.MarkStaleDispatchedUnavailableAsync(OrgB, 10, default));

        await ExecuteAsync("""
            UPDATE proctoring_inference_outbox
               SET dispatched_at = CURRENT_TIMESTAMP - INTERVAL '31 minutes'
             WHERE id = @id
            """, claim.OutboxId);
        Assert.Equal([OrgA], await repository.ListStaleDispatchedOutboxOrganizationIdsAsync(
            10, default));
        Assert.Equal(1, await repository.MarkStaleDispatchedUnavailableAsync(
            OrgA, 10, default));
        Assert.Equal(0, await repository.MarkStaleDispatchedUnavailableAsync(
            OrgA, 10, default));
        Assert.Equal("unavailable", await ScalarAsync<string>(
            "SELECT status FROM proctoring_evidence WHERE id = @id", intent.EvidenceId));
        Assert.Equal("inference_result_timeout", await ScalarAsync<string>(
            "SELECT failure_code FROM proctoring_evidence WHERE id = @id", intent.EvidenceId));
        Assert.Equal("inference_result_timeout", await ScalarAsync<string>(
            "SELECT failure_code FROM proctoring_findings WHERE evidence_id = @id",
            intent.EvidenceId));
        Assert.Empty(await repository.ListStaleDispatchedOutboxOrganizationIdsAsync(10, default));
    }

    [Fact]
    public async Task Concurrent_event_reservations_stop_at_five_per_kind_and_never_cross_tenants()
    {
        await using (var consentDb = NewContext())
            await new ProctoringEvidenceRepository(consentDb).AcceptMediaConsentAsync(
                OrgA, CandidateA, AssignmentA, "camera-screen-stills-v1", default);

        var work = Enumerable.Range(0, 10).Select(async _ =>
        {
            await using var db = NewContext();
            try
            {
                return await new ProctoringEvidenceRepository(db).ReserveIntentAsync(
                    OrgA, CandidateA, AssignmentA, Guid.NewGuid(), "screen", "event",
                    "image/webp", 4 * 1024 * 1024, default);
            }
            catch (ProctoringException ex) when (ex.Code == "evidence_event_limit")
            {
                return null;
            }
        });
        var results = await Task.WhenAll(work);
        Assert.Equal(5, results.Count(row => row is not null));
        Assert.Equal(new[] { 0, 1, 2, 3, 4 }, results.Where(row => row is not null)
            .Select(row => row!.CaptureSlot).Order().ToArray());
        Assert.Equal(5L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_evidence WHERE session_id = @id", SessionA));

        // A request at second 55 passes the spacing rule but still belongs to
        // minute slot 0. It must fail as a domain conflict, not leak a unique
        // constraint exception from SaveChanges.
        await ExecuteAsync("""
            UPDATE proctoring_sessions
               SET started_at = CURRENT_TIMESTAMP - INTERVAL '55 seconds'
             WHERE id = 'dddddddd-dddd-dddd-dddd-ddddddddddda';
            INSERT INTO proctoring_evidence
              (id, organization_id, assignment_id, session_id, client_capture_id,
               media_type, capture_reason, capture_slot, staging_object_key,
               content_type, max_bytes, intent_expires_at, created_at, updated_at)
            VALUES ('abcdabcd-abcd-abcd-abcd-abcdabcdabcd',
                    '11111111-1111-1111-1111-111111111111',
                    'cccccccc-cccc-cccc-cccc-ccccccccccca',
                    'dddddddd-dddd-dddd-dddd-ddddddddddda',
                    'abcdabcd-abcd-abcd-abcd-111111111111',
                    'camera', 'periodic', 0, 'staging/test/previous.jpg',
                    'image/jpeg', 2097152, CURRENT_TIMESTAMP + INTERVAL '2 minutes',
                    CURRENT_TIMESTAMP - INTERVAL '55 seconds',
                    CURRENT_TIMESTAMP - INTERVAL '55 seconds');
            """);

        await using var db = NewContext();
        var sameSlot = await Assert.ThrowsAsync<ProctoringException>(() =>
            new ProctoringEvidenceRepository(db).ReserveIntentAsync(
                OrgA, CandidateA, AssignmentA, Guid.NewGuid(), "camera", "periodic",
                "image/jpeg", 2 * 1024 * 1024, default));
        Assert.Equal("evidence_periodic_slot_taken", sameSlot.Code);
        var wrongCandidate = await Assert.ThrowsAsync<ProctoringException>(() =>
            new ProctoringEvidenceRepository(db).ReserveIntentAsync(
                OrgA, CandidateB, AssignmentA, Guid.NewGuid(), "camera", "event",
                "image/jpeg", 2 * 1024 * 1024, default));
        Assert.Equal("assignment_not_found", wrongCandidate.Code);
    }

    [Fact]
    public async Task Staff_media_reads_are_scoped_audited_and_hide_storage_keys()
    {
        await ExecuteAsync("""
            INSERT INTO proctoring_evidence
              (id, organization_id, assignment_id, session_id, client_capture_id,
               media_type, capture_reason, capture_slot, status, staging_object_key,
               sealed_object_key, content_type, max_bytes, byte_size, sha256,
               staging_etag, sealed_etag, intent_expires_at, confirmed_at,
               expires_at, created_at, updated_at)
            VALUES
              ('acacacac-acac-acac-acac-acacacacacac',
               '11111111-1111-1111-1111-111111111111',
               'cccccccc-cccc-cccc-cccc-ccccccccccca',
               'dddddddd-dddd-dddd-dddd-ddddddddddda',
               'acacacac-acac-acac-acac-111111111111',
               'camera', 'periodic', 0, 'processed', 'staging/test/camera.jpg',
               'sealed/11111111-1111-1111-1111-111111111111/dddddddd-dddd-dddd-dddd-ddddddddddda/acacacac-acac-acac-acac-acacacacacac/' || repeat('c', 64) || '.jpg',
               'image/jpeg', 2097152, 1234, repeat('c', 64), 'source-c', 'sealed-c',
               CURRENT_TIMESTAMP - INTERVAL '58 minutes',
               CURRENT_TIMESTAMP - INTERVAL '59 minutes',
               CURRENT_TIMESTAMP + INTERVAL '6 days',
               CURRENT_TIMESTAMP - INTERVAL '60 minutes', CURRENT_TIMESTAMP),
              ('bcbcbcbc-bcbc-bcbc-bcbc-bcbcbcbcbcbc',
               '11111111-1111-1111-1111-111111111111',
               'cccccccc-cccc-cccc-cccc-ccccccccccca',
               'dddddddd-dddd-dddd-dddd-ddddddddddda',
               'bcbcbcbc-bcbc-bcbc-bcbc-111111111111',
               'screen', 'event', 0, 'ready', 'staging/test/screen.webp',
               'sealed/11111111-1111-1111-1111-111111111111/dddddddd-dddd-dddd-dddd-ddddddddddda/bcbcbcbc-bcbc-bcbc-bcbc-bcbcbcbcbcbc/' || repeat('d', 64) || '.webp',
               'image/webp', 4194304, 4321, repeat('d', 64), 'source-d', 'sealed-d',
               CURRENT_TIMESTAMP - INTERVAL '28 minutes',
               CURRENT_TIMESTAMP - INTERVAL '29 minutes',
               CURRENT_TIMESTAMP + INTERVAL '6 days',
               CURRENT_TIMESTAMP - INTERVAL '30 minutes', CURRENT_TIMESTAMP);
            INSERT INTO proctoring_findings
              (id, organization_id, evidence_id, detector, model_revision, label,
               result_kind, confidence, detected_count, inferred_at)
            VALUES ('fafafafa-fafa-fafa-fafa-fafafafafafa',
                    '11111111-1111-1111-1111-111111111111',
                    'acacacac-acac-acac-acac-acacacacacac',
                    'rekognition_detect_faces', 'face-v1', 'face_count',
                    'signal', NULL, 0, CURRENT_TIMESTAMP);
            """);

        await using var db = NewContext();
        var auditor = new RecordingAuditor();
        var store = new StaffProctoringStore(db, new UnusedAnchors(), auditor,
            new CandidateProctoringRepository(db));
        var scope = new StaffProctoringScope(OrgA, Actor, AccessScope.Company, [], []);
        var media = await store.ListMediaAsync(scope, AssignmentA, Actor,
            null, null, default);
        Assert.Equal(2, media.Items.Count);
        var camera = Assert.Single(media.Items, item => item.MediaType == "camera");
        Assert.Equal(0, Assert.Single(camera.Findings).DetectedCount);
        var serialized = System.Text.Json.JsonSerializer.Serialize(media);
        Assert.DoesNotContain("sealed/", serialized, StringComparison.Ordinal);
        Assert.DoesNotContain("staging/", serialized, StringComparison.Ordinal);
        Assert.Equal(1, auditor.Reads);

        var cameraRead = await store.GetMediaForReadAsync(scope, AssignmentA,
            camera.EvidenceId, Actor, null, null, default);
        Assert.StartsWith($"sealed/{OrgA:D}/", cameraRead.SealedObjectKey);
        Assert.Equal(2, auditor.Reads);
        var hidden = await Assert.ThrowsAsync<StaffProctoringFailure>(() =>
            store.ListMediaAsync(new StaffProctoringScope(OrgB, Actor,
                AccessScope.Company, [], []), AssignmentA, Actor, null, null, default));
        Assert.Equal(404, hidden.StatusCode);
        var wrongAssignment = await Assert.ThrowsAsync<StaffProctoringFailure>(() =>
            store.GetMediaForReadAsync(scope, AssignmentB, camera.EvidenceId,
                Actor, null, null, default));
        Assert.Equal(404, wrongAssignment.StatusCode);

        await ExecuteAsync("UPDATE proctoring_evidence SET status = 'expired' WHERE id = @id",
            camera.EvidenceId);
        var expired = await Assert.ThrowsAsync<StaffProctoringFailure>(() =>
            store.GetMediaForReadAsync(scope, AssignmentA, camera.EvidenceId,
                Actor, null, null, default));
        Assert.Equal("evidence_unavailable", expired.Code);
        var screen = Assert.Single(media.Items, item => item.MediaType == "screen");
        var failingStore = new StaffProctoringStore(db, new UnusedAnchors(),
            new ThrowingAuditor(), new CandidateProctoringRepository(db));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            failingStore.GetMediaForReadAsync(scope, AssignmentA, screen.EvidenceId,
                Actor, null, null, default));
    }

    [Fact]
    public async Task Retention_expires_due_media_and_stale_intents_then_marks_deletion_tenant_safely()
    {
        var readyId = Guid.Parse("edededed-eded-eded-eded-edededededed");
        var staleId = Guid.Parse("fefefefe-fefe-fefe-fefe-fefefefefefe");
        await ExecuteAsync("""
            INSERT INTO proctoring_evidence
              (id, organization_id, assignment_id, session_id, client_capture_id,
               media_type, capture_reason, capture_slot, status, staging_object_key,
               sealed_object_key, content_type, max_bytes, byte_size, sha256,
               staging_etag, sealed_etag, intent_expires_at, confirmed_at,
               expires_at, created_at, updated_at)
            VALUES ('edededed-eded-eded-eded-edededededed',
                    '11111111-1111-1111-1111-111111111111',
                    'cccccccc-cccc-cccc-cccc-ccccccccccca',
                    'dddddddd-dddd-dddd-dddd-ddddddddddda',
                    'edededed-eded-eded-eded-111111111111',
                    'camera', 'periodic', 0, 'ready', 'staging/test/old.jpg',
                    'sealed/11111111-1111-1111-1111-111111111111/dddddddd-dddd-dddd-dddd-ddddddddddda/edededed-eded-eded-eded-edededededed/' || repeat('e', 64) || '.jpg',
                    'image/jpeg', 2097152, 1234, repeat('e', 64), 'source-e', 'sealed-e',
                    CURRENT_TIMESTAMP - INTERVAL '8 days' + INTERVAL '1 minute',
                    CURRENT_TIMESTAMP - INTERVAL '8 days',
                    CURRENT_TIMESTAMP - INTERVAL '1 day',
                    CURRENT_TIMESTAMP - INTERVAL '8 days' - INTERVAL '1 minute',
                    CURRENT_TIMESTAMP),
                   ('fefefefe-fefe-fefe-fefe-fefefefefefe',
                    '11111111-1111-1111-1111-111111111111',
                    'cccccccc-cccc-cccc-cccc-ccccccccccca',
                    'dddddddd-dddd-dddd-dddd-ddddddddddda',
                    'fefefefe-fefe-fefe-fefe-111111111111',
                    'screen', 'event', 0, 'intent', 'staging/test/stale.webp',
                    NULL, 'image/webp', 4194304, NULL, NULL, NULL, NULL,
                    CURRENT_TIMESTAMP - INTERVAL '8 minutes', NULL, NULL,
                    CURRENT_TIMESTAMP - INTERVAL '10 minutes', CURRENT_TIMESTAMP);
            """);

        await using var db = NewContext();
        var retention = new ProctoringEvidenceRetentionRepository(db);
        Assert.Equal([OrgA], await retention.ListDueOrganizationIdsAsync(10, default));
        Assert.Empty(await retention.ExpireDueAsync(OrgB, 10, [], default));
        await retention.MarkDeletedAsync(OrgB, readyId, default);
        Assert.True(await ScalarAsync<bool>(
            "SELECT deleted_at IS NULL FROM proctoring_evidence WHERE id = @id", readyId));

        var due = await retention.ExpireDueAsync(OrgA, 10, [], default);
        Assert.Equal(2, due.Count);
        Assert.Contains(due, row => row.EvidenceId == readyId && row.SealedObjectKey is not null);
        Assert.Contains(due, row => row.EvidenceId == staleId && row.SealedObjectKey is null);
        Assert.Equal("expired", await ScalarAsync<string>(
            "SELECT status FROM proctoring_evidence WHERE id = @id", readyId));
        Assert.Equal("expired", await ScalarAsync<string>(
            "SELECT status FROM proctoring_evidence WHERE id = @id", staleId));
        await retention.MarkDeletedAsync(OrgA, readyId, default);
        await retention.MarkDeletedAsync(OrgA, staleId, default);
        Assert.False(await ScalarAsync<bool>(
            "SELECT deleted_at IS NULL FROM proctoring_evidence WHERE id = @id", readyId));
        Assert.False(await ScalarAsync<bool>(
            "SELECT deleted_at IS NULL FROM proctoring_evidence WHERE id = @id", staleId));
        Assert.Empty(await retention.ListDueOrganizationIdsAsync(10, default));
    }

    [Fact]
    public async Task Candidate_explanation_is_owned_immutable_idempotent_and_audited_for_staff()
    {
        await ExecuteAsync("""
            UPDATE assessment_assignments
               SET status = 'completed', completed_at = CURRENT_TIMESTAMP
             WHERE id = @id
            """, AssignmentA);
        await using var db = NewContext();
        var useCase = new CandidateExplanationUseCase(new CandidateExplanationRepository(db));
        var before = await useCase.GetAsync(OrgA, CandidateA, AssignmentA, default);
        Assert.True(before.CanSubmit);
        Assert.Null(before.Explanation);
        Assert.NotNull(before.ClosesAt);

        var foreign = await Assert.ThrowsAsync<ProctoringException>(() =>
            useCase.GetAsync(OrgB, CandidateB, AssignmentA, default));
        Assert.Equal("assignment_not_found", foreign.Code);
        var submissionId = Guid.NewGuid();
        var first = await useCase.SubmitAsync(OrgA, CandidateA, AssignmentA,
            submissionId, "  My connection dropped briefly.  ", default);
        Assert.Equal("My connection dropped briefly.", first.Text);
        Assert.Equal(first, await useCase.SubmitAsync(OrgA, CandidateA, AssignmentA,
            submissionId, first.Text, default));
        Assert.False((await useCase.GetAsync(OrgA, CandidateA, AssignmentA,
            default)).CanSubmit);
        var changed = await Assert.ThrowsAsync<ProctoringException>(() =>
            useCase.SubmitAsync(OrgA, CandidateA, AssignmentA,
                Guid.NewGuid(), "A replacement", default));
        Assert.Equal("explanation_already_submitted", changed.Code);
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_candidate_explanations WHERE session_id = @id",
            SessionA));
        await using (var connection = new NpgsqlConnection(_connectionString))
        {
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            await using (var role = new NpgsqlCommand("SET LOCAL ROLE app_tenant", connection, transaction))
                await role.ExecuteNonQueryAsync();
            await using (var context = new NpgsqlCommand(
                "SELECT set_config('app.current_org_id', @org, true)", connection, transaction))
            {
                context.Parameters.AddWithValue("org", OrgB.ToString());
                await context.ExecuteNonQueryAsync();
            }
            await using (var select = new NpgsqlCommand(
                "SELECT count(*) FROM proctoring_candidate_explanations", connection, transaction))
                Assert.Equal(0L, await select.ExecuteScalarAsync());
            await using var delete = new NpgsqlCommand(
                "DELETE FROM proctoring_candidate_explanations WHERE id = @id",
                connection, transaction);
            delete.Parameters.AddWithValue("id", first.Id);
            var denied = await Assert.ThrowsAsync<PostgresException>(() =>
                delete.ExecuteNonQueryAsync());
            Assert.Equal("42501", denied.SqlState);
        }

        var auditor = new RecordingAuditor();
        var staff = new StaffProctoringStore(db, new UnusedAnchors(), auditor,
            new CandidateProctoringRepository(db));
        var scope = new StaffProctoringScope(OrgA, Actor, AccessScope.Company, [], []);
        Assert.Equal(first, await staff.GetCandidateExplanationAsync(
            scope, AssignmentA, Actor, null, null, default));
        Assert.Equal(1, auditor.Reads);
        await ExecuteAsync("""
            UPDATE proctoring_sessions SET ended_at = CURRENT_TIMESTAMP
             WHERE id = @id
            """, SessionA);
        var unseen = await Assert.ThrowsAsync<StaffProctoringFailure>(() =>
            staff.ReviewAsync(scope, AssignmentA, Actor, "clear", null,
                null, null, default, null));
        Assert.Equal("explanation_changed", unseen.Code);
        Assert.Equal("clear", (await staff.ReviewAsync(scope, AssignmentA, Actor,
            "clear", null, null, null, default, first.Id)).Status);
        var forbidden = await Assert.ThrowsAsync<StaffProctoringFailure>(() =>
            staff.GetCandidateExplanationAsync(
                new StaffProctoringScope(OrgB, Actor, AccessScope.Company, [], []),
                AssignmentA, Actor, null, null, default));
        Assert.Equal(404, forbidden.StatusCode);
        var failingStaff = new StaffProctoringStore(db, new UnusedAnchors(),
            new ThrowingAuditor(), new CandidateProctoringRepository(db));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            failingStaff.GetCandidateExplanationAsync(scope, AssignmentA,
                Actor, null, null, default));
    }

    [Fact]
    public async Task Reviewed_or_expired_explanations_are_closed_and_expired_text_is_deleted_without_media()
    {
        await ExecuteAsync("""
            UPDATE assessment_assignments
               SET status = 'completed', completed_at = CURRENT_TIMESTAMP
             WHERE id = @id
            """, AssignmentA);
        await using var db = NewContext();
        var useCase = new CandidateExplanationUseCase(new CandidateExplanationRepository(db));
        await ExecuteAsync("""
            UPDATE proctoring_sessions
               SET review_status = 'concern', reviewed_at = CURRENT_TIMESTAMP
             WHERE id = @id
            """, SessionA);
        var reviewed = await Assert.ThrowsAsync<ProctoringException>(() =>
            useCase.SubmitAsync(OrgA, CandidateA, AssignmentA,
                Guid.NewGuid(), "I had a connection issue", default));
        Assert.Equal("proctoring_review_closed", reviewed.Code);
        Assert.False((await useCase.GetAsync(OrgA, CandidateA, AssignmentA,
            default)).CanSubmit);

        await ExecuteAsync("""
            UPDATE proctoring_sessions
               SET review_status = 'unreviewed', reviewed_at = NULL
             WHERE id = @id
            """, SessionA);
        var submitted = await useCase.SubmitAsync(OrgA, CandidateA, AssignmentA,
            Guid.NewGuid(), "My connection dropped", default);
        await ExecuteAsync("""
            UPDATE proctoring_candidate_explanations
               SET submitted_at = CURRENT_TIMESTAMP - INTERVAL '8 days',
                   expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
             WHERE id = @id
            """, submitted.Id);
        Assert.Null((await useCase.GetAsync(OrgA, CandidateA, AssignmentA,
            default)).Explanation);

        var retention = new CandidateExplanationRetentionRepository(db);
        Assert.Equal([OrgA], await retention.ListDueOrganizationIdsAsync(10, default));
        Assert.Equal(0, await retention.DeleteDueAsync(OrgB, 10, default));
        Assert.Equal(1, await retention.DeleteDueAsync(OrgA, 10, default));
        Assert.Equal(0L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_candidate_explanations WHERE id = @id",
            submitted.Id));
        Assert.Empty(await retention.ListDueOrganizationIdsAsync(10, default));
        Assert.Equal(0L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_evidence WHERE session_id = @id",
            SessionA));
    }

    [Fact]
    public async Task Concurrent_candidate_statement_and_unseen_review_cannot_both_commit()
    {
        await ExecuteAsync("""
            UPDATE assessment_assignments
               SET status = 'completed', completed_at = CURRENT_TIMESTAMP
             WHERE id = @id;
            UPDATE proctoring_sessions
               SET ended_at = CURRENT_TIMESTAMP
             WHERE assignment_id = @id;
            """, AssignmentA);

        async Task<string> SubmitAsync()
        {
            await using var db = NewContext();
            try
            {
                await new CandidateExplanationUseCase(new CandidateExplanationRepository(db))
                    .SubmitAsync(OrgA, CandidateA, AssignmentA,
                        Guid.NewGuid(), "A connection issue occurred", default);
                return "submitted";
            }
            catch (ProctoringException ex) when (ex.Code == "proctoring_review_closed")
            {
                return "review_closed";
            }
        }

        async Task<string> ReviewAsync()
        {
            await using var db = NewContext();
            var staff = new StaffProctoringStore(db, new UnusedAnchors(),
                new RecordingAuditor(), new CandidateProctoringRepository(db));
            try
            {
                await staff.ReviewAsync(new StaffProctoringScope(
                        OrgA, Actor, AccessScope.Company, [], []), AssignmentA,
                    Actor, "clear", null, null, null, default, null);
                return "reviewed";
            }
            catch (StaffProctoringFailure ex) when (ex.Code == "explanation_changed")
            {
                return "explanation_changed";
            }
        }

        var outcomes = await Task.WhenAll(SubmitAsync(), ReviewAsync());
        Assert.True(outcomes.SequenceEqual(["submitted", "explanation_changed"])
            || outcomes.SequenceEqual(["review_closed", "reviewed"]),
            $"Unexpected race result: {string.Join(",", outcomes)}");
    }

    private ProctoringDbContext NewContext() => new(
        new DbContextOptionsBuilder<ProctoringDbContext>().UseNpgsql(_connectionString).Options);

    private async Task ExecuteAsync(string sql, Guid? id = null)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection) { CommandTimeout = 60 };
        if (id is { } value) command.Parameters.AddWithValue("id", value);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<T> ScalarAsync<T>(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("id", id);
        return (T)(await command.ExecuteScalarAsync() ?? throw new InvalidOperationException("Missing scalar"));
    }

    private static string FindMigration()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var path = Path.Combine(dir.FullName, "packages", "db", "prisma", "migrations",
                "20260924100000_proctoring_evidence_foundation", "migration.sql");
            if (File.Exists(path)) return path;
        }
        throw new FileNotFoundException("Proctoring evidence migration not found");
    }

    private const string BaseSchemaSql = """
        CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
        GRANT app_tenant TO postgres;
        GRANT USAGE ON SCHEMA public TO app_tenant;
        CREATE TABLE vacancies (
          id uuid PRIMARY KEY, organization_id uuid NOT NULL,
          team_id uuid, business_unit_id uuid, assigned_to uuid,
          created_by uuid NOT NULL, deleted_at timestamp(3));
        CREATE TABLE assessment_types (
          id uuid PRIMARY KEY, organization_id uuid NOT NULL,
          duration integer);
        CREATE TABLE assessment_assignments (
          id uuid PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL,
          vacancy_id uuid NOT NULL, assessment_type_id uuid NOT NULL,
          proctoring_required boolean NOT NULL, status text NOT NULL,
          started_at timestamp(3), completed_at timestamp(3), expires_at timestamp(3),
          updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE proctoring_sessions (
          id uuid PRIMARY KEY, organization_id uuid NOT NULL, assignment_id uuid NOT NULL UNIQUE,
          started_at timestamp(3) NOT NULL, ended_at timestamp(3),
          consented_at timestamp(3), consent_version text,
          last_heartbeat_at timestamp(3), flag_count integer NOT NULL DEFAULT 0,
          severity text, review_status text NOT NULL DEFAULT 'unreviewed',
          review_notes text, reviewed_at timestamp(3), reviewed_by_id uuid,
          updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE proctoring_events (
          id uuid PRIMARY KEY, organization_id uuid NOT NULL,
          session_id uuid NOT NULL, client_event_id uuid NOT NULL,
          type text NOT NULL, source text NOT NULL, severity text NOT NULL,
          client_at timestamp(3), occurred_at timestamp(3) NOT NULL,
          UNIQUE(session_id, client_event_id),
          CONSTRAINT proctoring_events_type_check CHECK (type IN (
            'tab_hidden', 'focus_lost', 'camera_stopped', 'screen_share_stopped',
            'face_missing', 'multiple_faces', 'model_unavailable', 'heartbeat_gap')));
        CREATE TABLE org_entitlements (
          id uuid PRIMARY KEY, organization_id uuid NOT NULL,
          module_code text NOT NULL, enabled boolean NOT NULL);
        CREATE TABLE audit_logs (
          id uuid PRIMARY KEY, organization_id uuid NOT NULL,
          actor_id uuid, action text NOT NULL, entity text NOT NULL,
          entity_id text, metadata jsonb, ip_address text, user_agent text,
          created_at timestamp(3) NOT NULL);
        GRANT SELECT, INSERT, UPDATE ON vacancies, assessment_types,
          assessment_assignments, proctoring_sessions,
          org_entitlements TO app_tenant;
        GRANT SELECT, INSERT ON audit_logs TO app_tenant;
        GRANT SELECT, INSERT ON proctoring_events TO app_tenant;
        DO $$ DECLARE t text; BEGIN
          FOREACH t IN ARRAY ARRAY['vacancies', 'assessment_types',
              'assessment_assignments', 'proctoring_sessions', 'proctoring_events',
              'org_entitlements', 'audit_logs'] LOOP
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
            EXECUTE format('CREATE POLICY tenant_isolation ON %I USING '
              || '(organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid) '
              || 'WITH CHECK (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)', t);
          END LOOP;
        END $$;
        """;

    private const string SeedSql = """
        INSERT INTO vacancies (id, organization_id, created_by)
          VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                  '11111111-1111-1111-1111-111111111111',
                  '99999999-9999-9999-9999-999999999999');
        INSERT INTO assessment_types (id, organization_id, duration) VALUES
          ('ffffffff-ffff-ffff-ffff-ffffffffffff',
           '11111111-1111-1111-1111-111111111111', 30),
          ('ffffffff-ffff-ffff-ffff-fffffffffff0',
           '22222222-2222-2222-2222-222222222222', 30);
        INSERT INTO assessment_assignments
          (id, organization_id, candidate_id, vacancy_id, assessment_type_id,
           proctoring_required, status) VALUES
          ('cccccccc-cccc-cccc-cccc-ccccccccccca',
           '11111111-1111-1111-1111-111111111111',
           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
           'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
           'ffffffff-ffff-ffff-ffff-ffffffffffff', true, 'in_progress'),
          ('cccccccc-cccc-cccc-cccc-cccccccccccb',
           '22222222-2222-2222-2222-222222222222',
           'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
           'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
           'ffffffff-ffff-ffff-ffff-fffffffffff0', true, 'in_progress');
        INSERT INTO proctoring_sessions
          (id, organization_id, assignment_id, started_at,
           consented_at, consent_version) VALUES
          ('dddddddd-dddd-dddd-dddd-ddddddddddda',
           '11111111-1111-1111-1111-111111111111',
           'cccccccc-cccc-cccc-cccc-ccccccccccca',
           CURRENT_TIMESTAMP - INTERVAL '10 seconds', CURRENT_TIMESTAMP,
           'camera-screen-signals-v1'),
          ('dddddddd-dddd-dddd-dddd-dddddddddddb',
           '22222222-2222-2222-2222-222222222222',
           'cccccccc-cccc-cccc-cccc-cccccccccccb',
           CURRENT_TIMESTAMP - INTERVAL '10 seconds', CURRENT_TIMESTAMP,
           'camera-screen-signals-v1');
        INSERT INTO org_entitlements (id, organization_id, module_code, enabled)
          VALUES ('99999999-9999-9999-9999-99999999999a',
                  '11111111-1111-1111-1111-111111111111', 'proctoring', true),
                 ('99999999-9999-9999-9999-99999999999b',
                  '22222222-2222-2222-2222-222222222222', 'proctoring', true);
        """;

    private sealed class UnusedAnchors : IAnchorLoaderFactory
    {
        public IAnchorLoader Create(Guid organizationId, Guid userId) =>
            throw new InvalidOperationException("Company scope must not load narrow anchors.");
    }

    private sealed class RecordingAuditor : IDataAccessAuditor
    {
        public int Reads { get; private set; }
        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null,
            CancellationToken cancellationToken = default)
        {
            Assert.Equal("proctoringSession", auditEvent.Entity);
            Assert.True(failClosed);
            Reads++;
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingAuditor : IDataAccessAuditor
    {
        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null,
            CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Simulated audit sink failure");
    }
}
