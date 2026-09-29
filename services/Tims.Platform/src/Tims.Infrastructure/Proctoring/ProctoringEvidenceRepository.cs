using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.Proctoring;
using Tims.Domain.Proctoring;

namespace Tims.Infrastructure.Proctoring;

/// <summary>
/// Tenant-scoped metadata lifecycle. Every transaction ends before the caller
/// contacts S3; the sealed object is recorded with an outbox row atomically.
/// </summary>
public sealed partial class ProctoringEvidenceRepository(ProctoringDbContext db) : IProctoringEvidenceRepository
{
    private readonly ProctoringDbContext _db = db;

    public async Task AcceptMediaConsentAsync(Guid organizationId, Guid candidateId,
        Guid assignmentId, string consentVersion, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(consentVersion) || consentVersion.Length > 128)
            throw Invalid("invalid_media_consent_version");
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var session = await ActiveOwnedSessionAsync(organizationId, candidateId, assignmentId, ct);
        if (session.MediaStoppedAt is not null)
            throw Conflict("media_capture_stopped");
        if (session.ConsentedAt is null || string.IsNullOrEmpty(session.ConsentVersion))
            throw Conflict("proctoring_consent_required");
        await AssertMediaDurationSupportedAsync(organizationId, assignmentId, ct);
        if (session.MediaConsentedAt is not null)
        {
            if (session.MediaConsentVersion != consentVersion)
                throw Conflict("media_consent_version_changed");
            await tenant.CommitAsync(ct);
            return;
        }
        var now = DbNow();
        var changed = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_sessions
               SET media_consented_at = {Timestamp(now)},
                   media_consent_version = {consentVersion},
                   updated_at = {Timestamp(now)}
             WHERE id = {session.Id} AND organization_id = {organizationId}
               AND media_consented_at IS NULL AND ended_at IS NULL
            """, ct);
        if (changed != 1) throw Conflict("media_consent_race");
        await tenant.CommitAsync(ct);
    }

    public async Task StopMediaCaptureAsync(Guid organizationId, Guid candidateId,
        Guid assignmentId, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var assignmentOwned = await _db.Assignments.AsNoTracking().AnyAsync(a =>
            a.Id == assignmentId && a.OrganizationId == organizationId &&
            a.CandidateId == candidateId, ct);
        if (!assignmentOwned) throw NotFound("assignment_not_found");
        var existingSession = await _db.Sessions.AsNoTracking().FirstOrDefaultAsync(s =>
            s.OrganizationId == organizationId && s.AssignmentId == assignmentId, ct)
            ?? throw Conflict("proctoring_session_not_active");
        if (existingSession.MediaStoppedAt is not null)
        {
            await tenant.CommitAsync(ct);
            return;
        }

        var session = await ActiveOwnedSessionAsync(
            organizationId, candidateId, assignmentId, ct,
            requireEntitlement: false);
        if (session.MediaStoppedAt is not null)
        {
            await tenant.CommitAsync(ct);
            return;
        }
        var now = DbNow();
        var changed = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_sessions
               SET media_stopped_at = {Timestamp(now)}, updated_at = {Timestamp(now)}
             WHERE id = {session.Id} AND organization_id = {organizationId}
               AND assignment_id = {assignmentId}
               AND ended_at IS NULL AND media_stopped_at IS NULL
            """, ct);
        if (changed != 1) throw Conflict("media_capture_stop_race");
        await tenant.CommitAsync(ct);
    }

    public async Task<ProctoringEvidenceIntent> ReserveIntentAsync(Guid organizationId,
        Guid candidateId, Guid assignmentId, Guid clientCaptureId,
        string mediaType, string captureReason, string contentType, int maxBytes,
        CancellationToken ct)
    {
        if (clientCaptureId == Guid.Empty || captureReason is not ("periodic" or "event"))
            throw Invalid("invalid_evidence_intent");
        var kindLimit = ProctoringEvidencePolicy.MaximumBytesFor(mediaType, contentType);
        if (kindLimit is null || maxBytes is < 1 || maxBytes > kindLimit.Value)
            throw Invalid("invalid_evidence_media_bounds");

        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var session = await ActiveOwnedSessionAsync(organizationId, candidateId, assignmentId, ct);
        if (session.MediaStoppedAt is not null)
            throw Conflict("media_capture_stopped");
        if (session.MediaConsentedAt is null || string.IsNullOrEmpty(session.MediaConsentVersion))
            throw Conflict("media_consent_required");
        await AssertMediaDurationSupportedAsync(organizationId, assignmentId, ct);

        // The session row is locked by ActiveOwnedSessionAsync. Return exact
        // same intent on a client retry before applying rate/cap checks.
        var prior = await _db.Evidence.AsNoTracking().FirstOrDefaultAsync(e =>
            e.OrganizationId == organizationId && e.SessionId == session.Id &&
            e.ClientCaptureId == clientCaptureId, ct);
        if (prior is not null)
        {
            if (prior.MediaType != mediaType || prior.CaptureReason != captureReason ||
                prior.ContentType != contentType || prior.MaxBytes != maxBytes)
                throw Conflict("evidence_intent_id_reused");
            await tenant.CommitAsync(ct);
            return ToIntent(prior);
        }

        var now = DbNow();
        var periodicCount = await _db.Evidence.AsNoTracking().CountAsync(e =>
            e.OrganizationId == organizationId && e.SessionId == session.Id &&
            e.MediaType == mediaType && e.CaptureReason == "periodic", ct);
        var eventCount = await _db.Evidence.AsNoTracking().CountAsync(e =>
            e.OrganizationId == organizationId && e.SessionId == session.Id &&
            e.MediaType == mediaType && e.CaptureReason == "event", ct);
        var lastPeriodicAt = await _db.Evidence.AsNoTracking()
            .Where(e => e.OrganizationId == organizationId && e.SessionId == session.Id &&
                e.MediaType == mediaType && e.CaptureReason == "periodic")
            .OrderByDescending(e => e.CreatedAt)
            .Select(e => (DateTime?)e.CreatedAt).FirstOrDefaultAsync(ct);
        var policyError = ProctoringEvidencePolicy.ValidateIntent(mediaType, captureReason,
            session.StartedAt, session.EndedAt, now, periodicCount, eventCount, lastPeriodicAt);
        if (policyError is not null)
            throw new ProctoringException(ProctoringError.TooManyRequests, policyError);

        var captureSlot = captureReason == "periodic"
            ? (int)Math.Floor((now - session.StartedAt).TotalMinutes)
            : eventCount;
        if (captureReason == "periodic" && await _db.Evidence.AsNoTracking().AnyAsync(e =>
            e.OrganizationId == organizationId && e.SessionId == session.Id &&
            e.MediaType == mediaType && e.CaptureReason == "periodic" &&
            e.CaptureSlot == captureSlot, ct))
            throw Conflict("evidence_periodic_slot_taken");

        // One active 25-person cohort can produce up to 875 intents of each
        // kind. This beta cap includes expired/rejected intents and is keyed
        // by UTC day. The organization advisory lock serializes admission
        // across different assessment sessions and API replicas.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({DailyQuotaLockKey(organizationId)})", ct);
        var dayStart = now.Date;
        var dayEnd = dayStart.AddDays(1);
        var dailyCount = await _db.Evidence.AsNoTracking().CountAsync(e =>
            e.OrganizationId == organizationId && e.MediaType == mediaType &&
            e.CreatedAt >= dayStart && e.CreatedAt < dayEnd, ct);
        if (dailyCount >= 1_000)
            throw new ProctoringException(ProctoringError.TooManyRequests,
                "evidence_daily_quota");

        var evidenceId = Guid.NewGuid();
        var extension = contentType == "image/jpeg" ? "jpg" : "webp";
        var row = new ProctoringEvidenceRow
        {
            Id = evidenceId,
            OrganizationId = organizationId,
            AssignmentId = assignmentId,
            SessionId = session.Id,
            ClientCaptureId = clientCaptureId,
            MediaType = mediaType,
            CaptureReason = captureReason,
            CaptureSlot = captureSlot,
            Status = "intent",
            StagingObjectKey = $"staging/{organizationId:N}/{session.Id:N}/{evidenceId:N}.{extension}",
            ContentType = contentType,
            MaxBytes = maxBytes,
            IntentExpiresAt = now.AddMinutes(2),
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Evidence.Add(row);
        await _db.SaveChangesAsync(ct);
        await tenant.CommitAsync(ct);
        _db.Entry(row).State = EntityState.Detached;
        return ToIntent(row);
    }

    public async Task<ProctoringConfirmLease> BeginConfirmAsync(Guid organizationId,
        Guid candidateId, Guid assignmentId, Guid evidenceId, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var row = await OwnedEvidenceAsync(organizationId, candidateId, assignmentId, evidenceId, ct);
        var now = DbNow();
        if (row.Status is "ready" or "processing" or "processed" or "unavailable")
        {
            if (row.ExpiresAt is null || row.ExpiresAt <= now)
                throw Conflict("evidence_expired");
            await tenant.CommitAsync(ct);
            return ToLease(row, row.UpdatedAt, alreadyReady: true);
        }
        // A grant can outlive assessment submission. Serialize with the
        // assignment/session completion writes before leasing an unsealed row.
        var activeSession = await ActiveOwnedSessionAsync(
            organizationId, candidateId, assignmentId, ct);
        if (activeSession.Id != row.SessionId)
            throw Conflict("proctoring_session_not_active");
        if (activeSession.MediaStoppedAt is not null)
            throw Conflict("media_capture_stopped");
        if (row.IntentExpiresAt <= now) throw Conflict("evidence_intent_expired");
        if (row.Status == "confirming")
        {
            // A process can die between the intent CAS and the S3 copy. After
            // a short lease, reclaim the pre-seal state under the same row CAS.
            if (now - row.UpdatedAt < TimeSpan.FromSeconds(60))
                throw Conflict("evidence_confirming");
            var reclaimed = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE proctoring_evidence SET status = 'intent',
                    updated_at = GREATEST({Timestamp(now)}, updated_at + INTERVAL '1 millisecond')
                WHERE id = {evidenceId} AND organization_id = {organizationId}
                  AND status = 'confirming' AND sealed_object_key IS NULL
                  AND updated_at = {Timestamp(row.UpdatedAt)}
                """, ct);
            if (reclaimed != 1) throw Conflict("evidence_confirming");
        }
        else if (row.Status != "intent") throw Conflict("evidence_not_confirmable");

        var updated = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_evidence SET status = 'confirming',
                updated_at = GREATEST({Timestamp(now)}, updated_at + INTERVAL '1 millisecond')
            WHERE id = {evidenceId} AND organization_id = {organizationId}
              AND assignment_id = {assignmentId} AND status = 'intent'
              AND intent_expires_at > {Timestamp(now)}
            """, ct);
        if (updated != 1) throw Conflict("evidence_confirm_race");
        var leaseUpdatedAt = await _db.Evidence.AsNoTracking()
            .Where(e => e.Id == evidenceId && e.OrganizationId == organizationId)
            .Select(e => e.UpdatedAt).SingleAsync(ct);
        await tenant.CommitAsync(ct);
        return ToLease(row, leaseUpdatedAt, alreadyReady: false);
    }

    public async Task<ProctoringEvidenceReady> FinishConfirmAsync(Guid organizationId,
        Guid candidateId, Guid assignmentId, Guid evidenceId,
        ProctoringSealedObject sealedObject, string? modelRevision,
        bool cloudInferenceEnabled, DateTime leaseUpdatedAt, CancellationToken ct)
    {
        if (sealedObject.SizeBytes is < 1 or > 4 * 1024 * 1024 ||
            sealedObject.Key.Length is < 30 or > 512 ||
            !sealedObject.Key.StartsWith("sealed/", StringComparison.Ordinal) ||
            sealedObject.Sha256.Length != 64 ||
            sealedObject.Sha256.Any(c => !Uri.IsHexDigit(c) || char.IsUpper(c)) ||
            string.IsNullOrWhiteSpace(sealedObject.SourceETag) ||
            string.IsNullOrWhiteSpace(sealedObject.SealedETag) ||
            sealedObject.SourceETag.Length > 128 || sealedObject.SealedETag.Length > 128 ||
            modelRevision?.Length > 128)
            throw Invalid("invalid_sealed_evidence");

        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var row = await OwnedEvidenceAsync(organizationId, candidateId, assignmentId, evidenceId, ct);
        var expectedPrefix = $"sealed/{organizationId:D}/{row.SessionId:D}/{evidenceId:D}/";
        var expectedExtension = row.ContentType == "image/jpeg" ? ".jpg" : ".webp";
        if (!sealedObject.Key.StartsWith(expectedPrefix, StringComparison.Ordinal) ||
            !sealedObject.Key.EndsWith(expectedExtension, StringComparison.Ordinal))
            throw Invalid("invalid_sealed_evidence_key");
        var now = DbNow();
        if (row.Status is "ready" or "processing" or "processed" or "unavailable")
        {
            if (row.ExpiresAt is null || row.ExpiresAt <= now)
                throw Conflict("evidence_expired");
            if (row.SealedObjectKey != sealedObject.Key || row.Sha256 != sealedObject.Sha256 ||
                row.ByteSize != sealedObject.SizeBytes)
                throw Conflict("evidence_seal_conflict");
            await tenant.CommitAsync(ct);
            return new ProctoringEvidenceReady(row.Id, row.SealedObjectKey, row.Sha256,
                row.ExpiresAt.Value);
        }
        // Recheck after the external S3 seal, while holding the same assignment
        // and session row locks used by intent reservation. A submitted exam
        // cannot gain newly ready evidence or queue inference.
        var activeSession = await ActiveOwnedSessionAsync(
            organizationId, candidateId, assignmentId, ct);
        if (activeSession.Id != row.SessionId)
            throw Conflict("proctoring_session_not_active");
        if (activeSession.MediaStoppedAt is not null)
            throw Conflict("media_capture_stopped");
        if (row.Status != "confirming" || row.UpdatedAt != leaseUpdatedAt ||
            sealedObject.SizeBytes > row.MaxBytes)
            throw Conflict("evidence_not_confirming");
        if (cloudInferenceEnabled && row.MediaType == "camera" &&
            string.IsNullOrWhiteSpace(modelRevision))
            throw Invalid("model_revision_required");

        var expiry = now.AddDays(7);
        var size = checked((int)sealedObject.SizeBytes);
        var updated = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_evidence
               SET status = 'ready', sealed_object_key = {sealedObject.Key},
                   byte_size = {size}, sha256 = {sealedObject.Sha256},
                   staging_etag = {sealedObject.SourceETag},
                   sealed_etag = {sealedObject.SealedETag},
                   model_revision = {modelRevision},
                   confirmed_at = {Timestamp(now)}, expires_at = {Timestamp(expiry)},
                   updated_at = {Timestamp(now)}
             WHERE id = {evidenceId} AND organization_id = {organizationId}
               AND assignment_id = {assignmentId} AND status = 'confirming'
               AND updated_at = {Timestamp(leaseUpdatedAt)}
            """, ct);
        if (updated != 1) throw Conflict("evidence_confirm_race");
        if (cloudInferenceEnabled && row.MediaType == "camera")
        {
            var outboxId = Guid.NewGuid();
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO proctoring_inference_outbox
                  (id, organization_id, evidence_id, status, attempt_count,
                   available_at, created_at, updated_at)
                VALUES ({outboxId}, {organizationId}, {evidenceId}, 'pending', 0,
                        {Timestamp(now)}, {Timestamp(now)}, {Timestamp(now)})
                ON CONFLICT (evidence_id) DO NOTHING
                """, ct);
        }
        await tenant.CommitAsync(ct);
        return new ProctoringEvidenceReady(evidenceId, sealedObject.Key,
            sealedObject.Sha256, expiry);
    }

    public async Task ResetConfirmAsync(Guid organizationId, Guid candidateId,
        Guid assignmentId, Guid evidenceId, DateTime leaseUpdatedAt,
        CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var row = await OwnedEvidenceAsync(organizationId, candidateId, assignmentId, evidenceId, ct);
        if (row.Status == "confirming" && row.UpdatedAt == leaseUpdatedAt)
        {
            var now = DbNow();
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE proctoring_evidence SET status = 'intent',
                    updated_at = GREATEST({Timestamp(now)}, updated_at + INTERVAL '1 millisecond')
                WHERE id = {evidenceId} AND organization_id = {organizationId}
                  AND assignment_id = {assignmentId} AND status = 'confirming'
                  AND sealed_object_key IS NULL
                  AND updated_at = {Timestamp(leaseUpdatedAt)}
                """, ct);
        }
        await tenant.CommitAsync(ct);
    }

    public async Task<ProctoringEvidenceForResult?> GetForResultAsync(Guid organizationId,
        Guid evidenceId, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var row = await _db.Evidence.AsNoTracking().FirstOrDefaultAsync(e =>
            e.Id == evidenceId && e.OrganizationId == organizationId, ct);
        await tenant.CommitAsync(ct);
        return row is null ? null : new ProctoringEvidenceForResult(row.Id,
            row.OrganizationId, row.AssignmentId, row.SessionId, row.MediaType,
            row.Status, row.SealedObjectKey, row.Sha256, row.ModelRevision, row.ExpiresAt);
    }

    private async Task<ProctoringSessionRow> ActiveOwnedSessionAsync(Guid orgId,
        Guid candidateId, Guid assignmentId, CancellationToken ct,
        bool requireEntitlement = true)
    {
        var assignment = await _db.Assignments.AsNoTracking().FirstOrDefaultAsync(a =>
            a.Id == assignmentId && a.OrganizationId == orgId && a.CandidateId == candidateId, ct);
        if (assignment is null) throw NotFound("assignment_not_found");
        if (!assignment.ProctoringRequired || assignment.Status != "in_progress")
            throw Conflict("assignment_not_in_progress");
        var assignmentLocked = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE assessment_assignments SET updated_at = updated_at
            WHERE id = {assignmentId} AND organization_id = {orgId}
              AND candidate_id = {candidateId} AND status = 'in_progress'
              AND proctoring_required = true
            """, ct);
        if (assignmentLocked != 1) throw Conflict("assignment_not_in_progress");
        if (requireEntitlement && !await _db.Entitlements.AsNoTracking().AnyAsync(e =>
            e.OrganizationId == orgId && e.ModuleCode == "proctoring" && e.Enabled, ct))
            throw new ProctoringException(ProctoringError.Forbidden,
                "entitlement_missing:proctoring");
        var session = await _db.Sessions.AsNoTracking().FirstOrDefaultAsync(s =>
            s.OrganizationId == orgId && s.AssignmentId == assignmentId && s.EndedAt == null, ct);
        if (session is null) throw Conflict("proctoring_session_not_active");
        // No-op UPDATE provides an exclusive row lock under TenantScope. The
        // next reservation sees previous slots, even across API replicas.
        var locked = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_sessions SET updated_at = updated_at
            WHERE id = {session.Id} AND organization_id = {orgId} AND ended_at IS NULL
            """, ct);
        if (locked != 1) throw Conflict("proctoring_session_not_active");
        return await _db.Sessions.AsNoTracking().SingleAsync(s =>
            s.Id == session.Id && s.OrganizationId == orgId, ct);
    }

    private async Task<ProctoringEvidenceRow> OwnedEvidenceAsync(Guid orgId,
        Guid candidateId, Guid assignmentId, Guid evidenceId, CancellationToken ct)
    {
        var assignmentOwned = await _db.Assignments.AsNoTracking().AnyAsync(a =>
            a.Id == assignmentId && a.OrganizationId == orgId && a.CandidateId == candidateId, ct);
        if (!assignmentOwned) throw NotFound("assignment_not_found");
        return await _db.Evidence.AsNoTracking().FirstOrDefaultAsync(e =>
            e.Id == evidenceId && e.OrganizationId == orgId &&
            e.AssignmentId == assignmentId, ct)
            ?? throw NotFound("evidence_not_found");
    }

    private async Task AssertMediaDurationSupportedAsync(Guid orgId,
        Guid assignmentId, CancellationToken ct)
    {
        var duration = await (from assignment in _db.Assignments.AsNoTracking()
                              join assessmentType in _db.AssessmentTypes.AsNoTracking()
                                  on assignment.AssessmentTypeId equals assessmentType.Id
                              where assignment.Id == assignmentId && assignment.OrganizationId == orgId
                                  && assessmentType.OrganizationId == orgId
                              select assessmentType.Duration).SingleOrDefaultAsync(ct);
        if (duration is null or < 1 or > 30)
            throw Conflict("media_duration_unsupported");
    }

    private static ProctoringEvidenceIntent ToIntent(ProctoringEvidenceRow row) =>
        new(row.Id, row.SessionId, row.Status, row.StagingObjectKey,
            row.MediaType, row.CaptureReason, row.CaptureSlot, row.ContentType,
            row.MaxBytes, row.IntentExpiresAt);

    private static ProctoringConfirmLease ToLease(ProctoringEvidenceRow row,
        DateTime leaseUpdatedAt, bool alreadyReady) => new(row.Id, row.SessionId,
            alreadyReady ? row.Status : "confirming",
            row.StagingObjectKey, row.MediaType, row.ContentType, row.MaxBytes,
            row.IntentExpiresAt, leaseUpdatedAt, alreadyReady, row.SealedObjectKey,
            row.Sha256, row.ExpiresAt);

    private static ProctoringException Invalid(string code) =>
        new(ProctoringError.InvalidInput, code);
    private static ProctoringException NotFound(string code) =>
        new(ProctoringError.NotFound, code);
    private static ProctoringException Conflict(string code) =>
        new(ProctoringError.Conflict, code);

    private static DateTime DbNow()
    {
        var utc = DateTime.UtcNow;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)),
            DateTimeKind.Unspecified);
    }

    private static long DailyQuotaLockKey(Guid organizationId)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(
            $"tims.proctoring.evidence.daily-quota:{organizationId:D}"));
        return BinaryPrimitives.ReadInt64BigEndian(bytes);
    }

    private static NpgsqlParameter Timestamp(DateTime value) => new()
    {
        NpgsqlDbType = NpgsqlDbType.Timestamp,
        Value = value,
    };
}
