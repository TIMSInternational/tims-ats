using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.Proctoring;

namespace Tims.Infrastructure.Proctoring;

public sealed partial class ProctoringEvidenceRepository
{
    private static readonly TimeSpan ResultTimeout = TimeSpan.FromMinutes(30);

    /// <summary>
    /// The sole privileged discovery query for the dispatcher. It returns
    /// distinct tenant IDs, never evidence rows or media metadata. A caller
    /// must use ClaimPendingOutboxAsync under TenantScope for actual work.
    /// </summary>
    public async Task<IReadOnlyList<Guid>> ListPendingOutboxOrganizationIdsAsync(
        int maxCount, CancellationToken ct)
    {
        if (maxCount is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(maxCount));
        var now = DbNow();
        return await (from outbox in _db.InferenceOutbox.AsNoTracking()
                      join evidence in _db.Evidence.AsNoTracking()
                          on outbox.EvidenceId equals evidence.Id
                      where outbox.OrganizationId == evidence.OrganizationId
                          && (outbox.Status == "pending" || outbox.Status == "sending")
                          && outbox.AvailableAt <= now && outbox.AttemptCount < 10
                          && evidence.MediaType == "camera"
                          && (evidence.Status == "ready" || evidence.Status == "processing")
                          && evidence.ExpiresAt > now && evidence.ModelRevision != null
                      select outbox.OrganizationId)
            .Distinct().OrderBy(id => id).Take(maxCount).ToListAsync(ct);
    }

    /// <summary>
    /// Claim attempt_count is the fencing token. SQS send happens after this
    /// transaction commits; duplicate sends are harmless to the result CAS.
    /// </summary>
    public async Task<IReadOnlyList<ProctoringOutboxClaim>> ClaimPendingOutboxAsync(
        Guid organizationId, int maxCount, CancellationToken ct)
    {
        if (maxCount is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(maxCount));
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var now = DbNow();
        var leaseUntil = now.AddMinutes(2);
        var rows = await (from outbox in _db.InferenceOutbox.AsNoTracking()
                          join evidence in _db.Evidence.AsNoTracking()
                              on outbox.EvidenceId equals evidence.Id
                          where outbox.OrganizationId == organizationId
                              && evidence.OrganizationId == organizationId
                              && (outbox.Status == "pending" || outbox.Status == "sending")
                              && outbox.AvailableAt <= now && outbox.AttemptCount < 10
                              && evidence.MediaType == "camera"
                              && (evidence.Status == "ready" || evidence.Status == "processing")
                              && evidence.ExpiresAt > now && evidence.SealedObjectKey != null
                              && evidence.Sha256 != null && evidence.ModelRevision != null
                          orderby outbox.AvailableAt, outbox.Id
                          select new { Outbox = outbox, Evidence = evidence })
            .Take(Math.Min(maxCount * 4, 400)).ToListAsync(ct);
        var claims = new List<ProctoringOutboxClaim>(maxCount);
        foreach (var row in rows)
        {
            if (claims.Count == maxCount) break;
            var changed = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE proctoring_inference_outbox
                   SET status = 'sending', attempt_count = attempt_count + 1,
                       available_at = {Timestamp(leaseUntil)},
                       last_error_code = NULL, updated_at = {Timestamp(now)}
                 WHERE id = {row.Outbox.Id} AND organization_id = {organizationId}
                   AND attempt_count = {row.Outbox.AttemptCount}
                   AND attempt_count < 10
                   AND (status = 'pending' OR status = 'sending')
                   AND available_at <= {Timestamp(now)}
                """, ct);
            if (changed != 1) continue;
            claims.Add(new ProctoringOutboxClaim(row.Outbox.Id, organizationId,
                row.Evidence.Id, row.Evidence.SealedObjectKey!, row.Evidence.Sha256!,
                row.Evidence.MediaType, row.Evidence.ModelRevision!,
                row.Evidence.ExpiresAt!.Value, row.Outbox.AttemptCount + 1));
        }
        await tenant.CommitAsync(ct);
        return claims;
    }

    public async Task<bool> MarkOutboxDispatchedAsync(Guid organizationId,
        Guid outboxId, int claimAttempt, CancellationToken ct)
    {
        if (claimAttempt is < 1 or > 10) throw new ArgumentOutOfRangeException(nameof(claimAttempt));
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var now = DbNow();
        var changed = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_inference_outbox
               SET status = 'dispatched', dispatched_at = {Timestamp(now)},
                   updated_at = {Timestamp(now)}
             WHERE id = {outboxId} AND organization_id = {organizationId}
               AND status = 'sending' AND attempt_count = {claimAttempt}
            """, ct);
        var already = changed == 1 || await _db.InferenceOutbox.AsNoTracking().AnyAsync(o =>
            o.Id == outboxId && o.OrganizationId == organizationId &&
            o.Status == "dispatched" && o.AttemptCount == claimAttempt, ct);
        await tenant.CommitAsync(ct);
        return already;
    }

    public async Task<bool> MarkOutboxRetryAsync(Guid organizationId, Guid outboxId,
        int claimAttempt, string errorCode, CancellationToken ct)
    {
        if (claimAttempt is < 1 or > 10) throw new ArgumentOutOfRangeException(nameof(claimAttempt));
        if (!IsCode(errorCode, 64)) throw Invalid("invalid_outbox_error_code");
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var now = DbNow();
        var next = now.AddSeconds(Math.Min(300, 5 * (1 << Math.Min(claimAttempt, 6))));
        var status = claimAttempt >= 10 ? "dead" : "pending";
        var changed = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_inference_outbox
               SET status = {status}, available_at = {Timestamp(next)},
                   last_error_code = {errorCode}, updated_at = {Timestamp(now)}
             WHERE id = {outboxId} AND organization_id = {organizationId}
               AND status = 'sending' AND attempt_count = {claimAttempt}
            """, ct);
        if (changed == 1 && claimAttempt == 10)
        {
            // A permanently undeliverable request must not masquerade as a
            // clean frame. The evidence CAS preserves a valid result that
            // reached processed/unavailable before this final send failure.
            var findingId = Guid.NewGuid();
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                WITH failed_evidence AS (
                  UPDATE proctoring_evidence AS evidence
                     SET status = 'unavailable',
                         failure_code = 'inference_dispatch_failed',
                         processed_at = {Timestamp(now)},
                         updated_at = {Timestamp(now)}
                    FROM proctoring_inference_outbox AS outbox
                   WHERE outbox.id = {outboxId}
                     AND outbox.organization_id = {organizationId}
                     AND outbox.evidence_id = evidence.id
                     AND evidence.organization_id = {organizationId}
                     AND outbox.status = 'dead'
                     AND evidence.status IN ('ready', 'processing')
                     AND evidence.expires_at > {Timestamp(now)}
                  RETURNING evidence.id, evidence.organization_id,
                            evidence.model_revision
                )
                INSERT INTO proctoring_findings
                  (id, organization_id, evidence_id, detector, model_revision,
                   label, result_kind, failure_code, inferred_at, created_at)
                SELECT {findingId}, organization_id, id, 'inference_dispatch',
                       COALESCE(model_revision, 'dispatch-v1'),
                       'dispatch_unavailable', 'unavailable',
                       'inference_dispatch_failed', {Timestamp(now)}, {Timestamp(now)}
                  FROM failed_evidence
                ON CONFLICT (evidence_id, detector, model_revision, label) DO NOTHING
                """, ct);
        }
        await tenant.CommitAsync(ct);
        return changed == 1;
    }

    /// <summary>
    /// Discover only tenant IDs whose dispatched inference has produced no
    /// result after the fixed 30-minute beta timeout. Evidence remains scoped
    /// to a tenant transaction in MarkStaleDispatchedUnavailableAsync.
    /// </summary>
    public async Task<IReadOnlyList<Guid>> ListStaleDispatchedOutboxOrganizationIdsAsync(
        int maxCount, CancellationToken ct)
    {
        if (maxCount is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(maxCount));
        var now = DbNow();
        var staleBefore = now.Subtract(ResultTimeout);
        return await (from outbox in _db.InferenceOutbox.AsNoTracking()
                      join evidence in _db.Evidence.AsNoTracking()
                          on outbox.EvidenceId equals evidence.Id
                      where outbox.OrganizationId == evidence.OrganizationId
                          && outbox.Status == "dispatched"
                          && outbox.DispatchedAt != null && outbox.DispatchedAt <= staleBefore
                          && (evidence.Status == "ready" || evidence.Status == "processing")
                          && evidence.ExpiresAt > now
                      select outbox.OrganizationId).Distinct().OrderBy(id => id)
            .Take(maxCount).ToListAsync(ct);
    }

    public async Task<int> MarkStaleDispatchedUnavailableAsync(Guid organizationId,
        int maxCount, CancellationToken ct)
    {
        if (organizationId == Guid.Empty || maxCount is < 1 or > 100)
            throw new ArgumentOutOfRangeException(nameof(maxCount));
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var now = DbNow();
        var staleBefore = now.Subtract(ResultTimeout);
        var rows = await (from outbox in _db.InferenceOutbox.AsNoTracking()
                          join evidence in _db.Evidence.AsNoTracking()
                              on outbox.EvidenceId equals evidence.Id
                          where outbox.OrganizationId == organizationId
                              && evidence.OrganizationId == organizationId
                              && outbox.Status == "dispatched"
                              && outbox.DispatchedAt != null && outbox.DispatchedAt <= staleBefore
                              && (evidence.Status == "ready" || evidence.Status == "processing")
                              && evidence.ExpiresAt > now
                          orderby outbox.DispatchedAt, outbox.Id
                          select new { evidence.Id, evidence.ModelRevision })
            .Take(maxCount).ToListAsync(ct);
        var marked = 0;
        foreach (var row in rows)
        {
            var changed = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE proctoring_evidence AS evidence
                   SET status = 'unavailable',
                       failure_code = 'inference_result_timeout',
                       processed_at = {Timestamp(now)},
                       updated_at = {Timestamp(now)}
                 WHERE evidence.id = {row.Id}
                   AND evidence.organization_id = {organizationId}
                   AND evidence.status IN ('ready', 'processing')
                   AND evidence.expires_at > {Timestamp(now)}
                   AND EXISTS (
                     SELECT 1 FROM proctoring_inference_outbox AS outbox
                      WHERE outbox.evidence_id = evidence.id
                        AND outbox.organization_id = {organizationId}
                        AND outbox.status = 'dispatched'
                        AND outbox.dispatched_at <= {Timestamp(staleBefore)})
                """, ct);
            if (changed != 1) continue;
            await InsertFindingAsync(organizationId, row.Id, "inference_dispatch",
                row.ModelRevision ?? "dispatch-v1", "result_timeout", "unavailable",
                null, null, "inference_result_timeout", now, ct);
            marked++;
        }
        await tenant.CommitAsync(ct);
        return marked;
    }

    /// <summary>
    /// OrganizationId in the queue is only a scope hint. RLS, immutable media
    /// identity, checksum, model revision and expiry are checked before a cue
    /// is stored. No outcome/assessment decision is written here.
    /// </summary>
    public async Task<ProctoringInferenceApplyResult> ApplyInferenceResultAsync(
        Guid organizationId, ProctoringInferenceResult result, CancellationToken ct)
    {
        if (!ValidResultShape(result) || result.OrganizationId != organizationId)
            return new ProctoringInferenceApplyResult("mismatch");
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var evidence = await _db.Evidence.AsNoTracking().FirstOrDefaultAsync(e =>
            e.Id == result.EvidenceId && e.OrganizationId == organizationId, ct);
        if (evidence is null)
        {
            await tenant.CommitAsync(ct);
            return new ProctoringInferenceApplyResult("not_found");
        }
        var expectedPrefix = $"sealed/{organizationId:D}/{evidence.SessionId:D}/{evidence.Id:D}/";
        if (evidence.MediaType != "camera" || evidence.SealedObjectKey is null ||
            !evidence.SealedObjectKey.StartsWith(expectedPrefix, StringComparison.Ordinal) ||
            evidence.Sha256 != result.Sha256 ||
            evidence.ModelRevision != result.ModelRevision)
        {
            await tenant.CommitAsync(ct);
            return new ProctoringInferenceApplyResult("mismatch");
        }
        var now = DbNow();
        if (evidence.ExpiresAt is null || evidence.ExpiresAt <= now || evidence.Status == "expired")
        {
            await tenant.CommitAsync(ct);
            return new ProctoringInferenceApplyResult("expired");
        }
        if (evidence.Status is "processed" or "unavailable")
        {
            await tenant.CommitAsync(ct);
            return new ProctoringInferenceApplyResult("duplicate");
        }
        if (evidence.Status is not ("ready" or "processing"))
        {
            await tenant.CommitAsync(ct);
            return new ProctoringInferenceApplyResult("mismatch");
        }

        var targetStatus = result.Status == "completed" ? "processed" : "unavailable";
        var failureCode = targetStatus == "unavailable" ? "inference_unavailable" : null;
        var updated = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_evidence
               SET status = {targetStatus}, processed_at = {Timestamp(now)},
                   failure_code = {failureCode}, updated_at = {Timestamp(now)}
             WHERE id = {evidence.Id} AND organization_id = {organizationId}
               AND status IN ('ready', 'processing')
               AND expires_at > {Timestamp(now)}
               AND sealed_object_key = {evidence.SealedObjectKey}
               AND sha256 = {result.Sha256}
               AND model_revision = {result.ModelRevision}
            """, ct);
        if (updated != 1)
        {
            var current = await _db.Evidence.AsNoTracking().SingleAsync(e =>
                e.Id == evidence.Id && e.OrganizationId == organizationId, ct);
            await tenant.CommitAsync(ct);
            return new ProctoringInferenceApplyResult(current.Status is "processed" or "unavailable"
                ? "duplicate" : "mismatch");
        }

        foreach (var detector in result.Detectors)
        {
            if (detector.Status == "unavailable")
            {
                await InsertFindingAsync(organizationId, evidence.Id, detector.Name,
                    detector.Revision, "detector_unavailable", "unavailable", null, null,
                    detector.FailureCode, now, ct);
                continue;
            }
            foreach (var finding in detector.Findings)
                await InsertFindingAsync(organizationId, evidence.Id, detector.Name,
                    detector.Revision, finding.Label, "signal", finding.Confidence,
                    finding.Count, null, now, ct);
        }
        await tenant.CommitAsync(ct);
        return new ProctoringInferenceApplyResult("applied");
    }

    private Task<int> InsertFindingAsync(Guid organizationId, Guid evidenceId,
        string detector, string revision, string label, string kind,
        double? confidence, int? count, string? failureCode, DateTime now,
        CancellationToken ct)
    {
        var id = Guid.NewGuid();
        return _db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO proctoring_findings
              (id, organization_id, evidence_id, detector, model_revision, label,
               result_kind, confidence, detected_count, failure_code,
               inferred_at, created_at)
            VALUES ({id}, {organizationId}, {evidenceId}, {detector}, {revision}, {label},
                    {kind}, {NullableDouble(confidence)}, {NullableInteger(count)},
                    {failureCode}, {Timestamp(now)}, {Timestamp(now)})
            ON CONFLICT (evidence_id, detector, model_revision, label) DO NOTHING
            """, ct);
    }

    private static bool ValidResultShape(ProctoringInferenceResult result)
    {
        if (result.SchemaVersion != 1 || result.OrganizationId == Guid.Empty ||
            result.EvidenceId == Guid.Empty || !IsSha256(result.Sha256) ||
            string.IsNullOrWhiteSpace(result.ModelRevision) || result.ModelRevision.Length > 128 ||
            result.Status is not ("completed" or "unavailable") ||
            result.Detectors is null || result.Detectors.Count != 2 ||
            result.Detectors.Select(d => d.Name).Distinct(StringComparer.Ordinal).Count() != 2 ||
            !result.Detectors.Any(d => d.Name == "rekognition_detect_faces") ||
            !result.Detectors.Any(d => d.Name == "hf_object_detector"))
            return false;
        var rekognition = result.Detectors.Single(d => d.Name == "rekognition_detect_faces");
        if ((result.Status == "completed") != (rekognition.Status == "completed"))
            return false;
        foreach (var detector in result.Detectors)
        {
            if (!IsCode(detector.Name, 64) ||
                string.IsNullOrWhiteSpace(detector.Revision) || detector.Revision.Length > 128 ||
                detector.Findings is null || detector.Findings.Count > 20)
                return false;
            if (detector.Status == "unavailable")
            {
                if (detector.Findings.Count != 0 ||
                    !IsCode(detector.FailureCode, 64)) return false;
                continue;
            }
            if (detector.Status != "completed" || detector.FailureCode is not null)
                return false;
            if (detector.Findings.Select(f => f.Label)
                .Distinct(StringComparer.Ordinal).Count() != detector.Findings.Count)
                return false;
            if (detector.Name == "rekognition_detect_faces" &&
                (detector.Findings.Count != 1 || detector.Findings[0].Label != "face_count"))
                return false;
            foreach (var finding in detector.Findings)
            {
                if (!IsCode(finding.Label, 64) || finding.Count is null or < 0 or > 100 ||
                    (detector.Name == "rekognition_detect_faces" &&
                        (finding.Label != "face_count" || finding.Confidence is not null)) ||
                    (detector.Name == "hf_object_detector" &&
                        (finding.Label is not ("person" or "cell_phone") ||
                            finding.Confidence is null || finding.Count == 0)) ||
                    finding.Confidence is { } value &&
                    (!double.IsFinite(value) || value is < 0 or > 1))
                    return false;
            }
        }
        return true;
    }

    private static bool IsSha256(string? value) =>
        value is { Length: 64 } && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static bool IsCode(string? value, int maximum) =>
        value is { Length: > 0 } && value.Length <= maximum &&
        value[0] is >= 'a' and <= 'z' &&
        value.Skip(1).All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' or '_');

    private static NpgsqlParameter NullableDouble(double? value) => new()
    {
        NpgsqlDbType = NpgsqlDbType.Double,
        Value = value is { } present ? present : DBNull.Value,
    };

    private static NpgsqlParameter NullableInteger(int? value) => new()
    {
        NpgsqlDbType = NpgsqlDbType.Integer,
        Value = value is { } present ? present : DBNull.Value,
    };
}
