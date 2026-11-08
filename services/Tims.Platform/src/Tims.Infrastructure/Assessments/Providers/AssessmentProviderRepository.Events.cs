using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>Webhook inbox, attempt lifecycle, results, DSAR cascade and bindings.</summary>
public sealed partial class AssessmentProviderRepository
{
    public async Task MarkExpiredAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken) =>
        await AdvanceAttemptAsync(organizationId, attemptId, ProviderAttemptStates.Expired, null, now, cancellationToken)
            .ConfigureAwait(false);

    public async Task<Guid?> FindOrganizationByProviderTenantAsync(Guid providerTenantId, CancellationToken cancellationToken)
    {
        // PRE-TENANT on the privileged connection: a webhook names a provider tenant, not an org. Only the org id leaves.
        return await _db.Bindings.AsNoTracking()
            .Where(b => b.Provider == ProviderNames.TimsAssessments && b.ProviderTenantId == providerTenantId && b.IsActive)
            .Select(b => (Guid?)b.OrganizationId)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<InboxOutcome> RecordInboxAsync(
        Guid organizationId, ProviderEventEnvelope envelope, int? deliveryAttempt, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var id = Guid.NewGuid();
        var occurredAt = envelope.OccurredAt.UtcDateTime;
        var receivedAt = now.UtcDateTime;
        var data = envelope.DataJson;
        // ON CONFLICT DO NOTHING (not catch-23505): a unique violation would abort the whole transaction.
        var inserted = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO assessment_provider_webhook_inbox
                 (id, organization_id, event_id, event_type, event_version, provider_tenant_id, occurred_at,
                  delivery_attempt, status, processing_attempts, data, received_at)
             VALUES ({id}, {organizationId}, {envelope.EventId}, {envelope.EventType}, 1, {envelope.ProviderTenantId},
                     {occurredAt}, CAST({deliveryAttempt} AS integer), 'received', 0, CAST({data} AS jsonb), {receivedAt})
             ON CONFLICT (organization_id, event_id) DO NOTHING
             """, cancellationToken).ConfigureAwait(false);
        if (inserted == 1)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return InboxOutcome.New;
        }

        var status = await _db.Inbox.AsNoTracking()
            .Where(i => i.OrganizationId == organizationId && i.EventId == envelope.EventId)
            .Select(i => i.Status)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return status is InboxStatuses.Processed or InboxStatuses.Ignored ? InboxOutcome.Done : InboxOutcome.Retry;
    }

    public async Task CompleteInboxAsync(
        Guid organizationId, Guid eventId, string status, string? errorCode, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var row = await _db.Inbox
            .FirstOrDefaultAsync(i => i.OrganizationId == organizationId && i.EventId == eventId, cancellationToken)
            .ConfigureAwait(false);
        if (row is not null)
        {
            row.Status = status;
            row.LastErrorCode = errorCode is null ? null : errorCode.Length <= 64 ? errorCode : errorCode[..64];
            row.ProcessingAttempts += 1;
            row.ProcessedAt = status is InboxStatuses.Processed or InboxStatuses.Ignored ? now.UtcDateTime : null;
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<AttemptRow?> FindAttemptByProviderAssignmentAsync(
        Guid organizationId, Guid providerAssignmentId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var attempt = await _db.Attempts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.OrganizationId == organizationId && a.ProviderAssignmentId == providerAssignmentId,
                cancellationToken)
            .ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return attempt is null ? null : ToRow(attempt, isNew: false);
    }

    public async Task<bool> AdvanceAttemptAsync(
        Guid organizationId, Guid attemptId, string toState, DateTimeOffset? at, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await LockAttemptAsync(attemptId, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        var attempt = await _db.Attempts
            .FirstOrDefaultAsync(a => a.Id == attemptId && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        if (attempt is null || !ProviderAttemptStates.CanTransition(attempt.State, toState))
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return false;
        }

        var from = attempt.State;
        attempt.State = toState;
        attempt.UpdatedAt = now.UtcDateTime;
        if (toState == ProviderAttemptStates.InProgress && at is { } started)
        {
            attempt.StartedAt ??= started.UtcDateTime;
        }
        else if (toState == ProviderAttemptStates.Completed && at is { } completed)
        {
            attempt.CompletedAt ??= completed.UtcDateTime;
        }

        AddAudit(organizationId, null, "assessment_provider_state_changed", attempt.Id, new Dictionary<string, object?>
        {
            ["instrument"] = attempt.Instrument,
            ["from"] = from,
            ["to"] = toState,
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    public async Task<bool> StoreResultAsync(
        Guid organizationId, AttemptRow attempt, ParsedProviderResult result, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(attempt);
        ArgumentNullException.ThrowIfNull(result);
        var timestamp = now.UtcDateTime;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await LockSubjectAsync(result.SubjectId, cancellationToken).ConfigureAwait(false);
        await LockAttemptAsync(attempt.Id, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();

        // Checked under the locks erasure also takes, on a fresh read, BEFORE anything is inserted: a result fetched
        // before a subject.erased committed must not bring the erased scores back, whether the erasure already reached
        // this attempt (state) or only its tombstone exists (an erasure that ran before the mapping committed).
        var entity = await _db.Attempts
            .FirstOrDefaultAsync(a => a.Id == attempt.Id && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        if (entity is null || entity.State is ProviderAttemptStates.Erased or ProviderAttemptStates.Cancelled
            || await IsSubjectErasedAsync(organizationId, result.SubjectId, cancellationToken).ConfigureAwait(false))
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return false;
        }

        var stored = await _db.Results
            .FirstOrDefaultAsync(r => r.OrganizationId == organizationId && r.ProviderResultId == result.ResultId,
                cancellationToken)
            .ConfigureAwait(false);
        if (stored is not null && stored.ResultRevision >= result.ResultRevision)
        {
            // Deliveries are unordered: an older or repeated revision never overwrites a newer one.
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return false;
        }

        if (stored is null)
        {
            stored = new ProviderResultEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                AttemptId = attempt.Id,
                ProviderResultId = result.ResultId,
                CreatedAt = timestamp,
            };
            _db.Results.Add(stored);
        }

        stored.ResultRevision = result.ResultRevision;
        stored.ResultSchema = result.ResultSchema;
        stored.Instrument = result.Instrument;
        stored.InstrumentVersion = result.InstrumentVersion;
        stored.ContentVersion = result.ContentVersion;
        stored.ContentSha256 = result.ContentSha256;
        stored.NormVersion = result.NormVersion;
        stored.ScoringVersion = result.ScoringVersion;
        stored.ScoringMethod = result.ScoringMethod;
        stored.Purpose = result.Purpose;
        stored.ValidityStatus = result.ValidityStatus;
        stored.ValidityReasons = [.. result.ValidityReasons];
        stored.RequiresHumanReview = result.RequiresHumanReview;
        stored.Completion = result.Completion;
        stored.GlobalPercentile = result.GlobalPercentile;
        stored.Cefr = result.Cefr;
        stored.Level = result.Level;
        stored.TimeMultiplierApplied = result.TimeMultiplierApplied;
        stored.RenderedFor = result.RenderedFor;
        stored.RenderedLevel = result.RenderedLevel;
        stored.Scores = result.ScoresJson;
        stored.CompletedAt = result.CompletedAt.UtcDateTime;
        stored.ScoredAt = result.ScoredAt.UtcDateTime;
        stored.UpdatedAt = timestamp;

        // A newer revision decides the attempt's state: a voided result voids it, a re-published valid result (staff
        // review overturned a void) restores it — unless HR re-assigned the instrument after the void (or the expiry):
        // the replacement holds the one open slot and supersedes this attempt, so the corrected revision is kept on
        // record but the attempt is not reopened (that would also break ux_assessment_provider_attempts_open and fail
        // the delivery on every retry). The candidate lock is the one the reserve takes, so a re-assignment can never
        // interleave between this check and the update.
        var restored = result.ValidityStatus == ProviderValidity.Voided ? ProviderAttemptStates.Voided : ProviderAttemptStates.ResultReady;
        var superseded = false;
        if (restored == ProviderAttemptStates.ResultReady && !ProviderAttemptStates.IsOpen(entity.State))
        {
            var candidateKey = entity.CandidateId.ToString();
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({candidateKey}, 0))", cancellationToken).ConfigureAwait(false);
            var open = ProviderAttemptStates.Open.ToList();
            superseded = await _db.Attempts.AsNoTracking()
                .AnyAsync(a => a.OrganizationId == organizationId && a.Id != entity.Id && a.CandidateId == entity.CandidateId
                    && a.VacancyId == entity.VacancyId && a.Instrument == entity.Instrument && open.Contains(a.State),
                    cancellationToken)
                .ConfigureAwait(false);
        }

        if (!superseded)
        {
            entity.State = restored;
        }

        entity.LatestResultId = result.ResultId;
        entity.CompletedAt ??= result.CompletedAt.UtcDateTime;
        entity.UpdatedAt = timestamp;
        AddAudit(organizationId, null, "assessment_provider_result_received", attempt.Id, new Dictionary<string, object?>
        {
            ["instrument"] = result.Instrument,
            ["resultId"] = result.ResultId,
            ["revision"] = result.ResultRevision,
            ["validity"] = result.ValidityStatus,
            ["contentVersion"] = result.ContentVersion,
            ["normVersion"] = result.NormVersion,
            ["scoringVersion"] = result.ScoringVersion,
            ["to"] = entity.State,
            ["supersededByReassignment"] = superseded,
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    public async Task<int> EraseSubjectAsync(
        Guid organizationId, Guid providerSubjectId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // The subject lock first: a mapping (MarkCreatedAsync) or result write for this subject either committed
        // before the lookup below (and is found) or runs after and sees the tombstone, the inbox row recorded before
        // this method runs.
        await LockSubjectAsync(providerSubjectId, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        var ids = await _db.Attempts.AsNoTracking()
            .Where(a => a.OrganizationId == organizationId && a.ProviderSubjectId == providerSubjectId)
            .OrderBy(a => a.Id)
            .Select(a => a.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        // The same per-attempt locks result storage takes, in a fixed order (no lock-order deadlock): a result write
        // in flight finishes first and is then deleted here, or runs after and sees the attempt erased.
        foreach (var id in ids)
        {
            await LockAttemptAsync(id, cancellationToken).ConfigureAwait(false);
        }

        var attempts = await _db.Attempts
            .Where(a => a.OrganizationId == organizationId && ids.Contains(a.Id))
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        if (ids.Count > 0)
        {
            await _db.Results.Where(r => r.OrganizationId == organizationId && ids.Contains(r.AttemptId))
                .ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
            foreach (var attempt in attempts)
            {
                attempt.State = ProviderAttemptStates.Erased;
                attempt.LatestResultId = null;
                attempt.UpdatedAt = now.UtcDateTime;
            }

            AddAudit(organizationId, null, "assessment_provider_subject_erased", ids[0], new Dictionary<string, object?>
            {
                ["attempts"] = ids.Count,
            });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return ids.Count;
    }

    public async Task<ProviderBindingRow> UpsertBindingAsync(
        Guid organizationId, Guid providerTenantId, IReadOnlyList<string> instruments, string defaultLocale,
        Guid actorId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(instruments);
        var timestamp = now.UtcDateTime;
        // PRIVILEGED (no TenantScope): app_tenant has SELECT only on bindings, so a tenant session can never enable an
        // instrument for itself. The audit row shares the transaction.
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);
        var binding = await _db.Bindings
            .FirstOrDefaultAsync(b => b.OrganizationId == organizationId && b.Provider == ProviderNames.TimsAssessments,
                cancellationToken)
            .ConfigureAwait(false);
        if (binding is null)
        {
            binding = new ProviderBindingEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                Provider = ProviderNames.TimsAssessments,
                CreatedAt = timestamp,
            };
            _db.Bindings.Add(binding);
        }

        var previous = binding.EnabledInstruments;
        binding.ProviderTenantId = providerTenantId;
        binding.EnabledInstruments = [.. instruments];
        binding.DefaultLocale = defaultLocale;
        binding.IsActive = true;
        binding.UpdatedAt = timestamp;
        _db.AuditLogs.Add(new AuditLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            UserId = actorId,
            ActorId = actorId,
            Action = "assessment_provider_binding_set",
            Entity = "assessment_provider_binding",
            EntityId = binding.Id.ToString(),
            Changes = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["enabledInstruments"] = new { before = previous, after = instruments },
            }),
            Metadata = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["providerTenantId"] = providerTenantId,
                ["defaultLocale"] = defaultLocale,
            }),
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        return ToRow(binding);
    }

    public async Task<string?> GetActiveOrganizationNameAsync(Guid organizationId, CancellationToken cancellationToken) =>
        await _db.Organizations.AsNoTracking()
            .Where(o => o.Id == organizationId && o.IsActive && o.DeletedAt == null)
            .Select(o => o.Name)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

    // Serializes mapping, result storage and erasure of one provider subject. Always taken BEFORE an attempt lock.
    private Task LockSubjectAsync(Guid providerSubjectId, CancellationToken cancellationToken)
    {
        var key = "assessment-provider-subject:" + providerSubjectId.ToString();
        return _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", cancellationToken);
    }

    // The erasure tombstone: a recorded (signature-verified) subject.erased inbox row for this subject, whatever its
    // processing status. Rows are never deleted by app_tenant. The inbox keeps the payload verbatim and the contract's
    // Uuid is any-case, so the stored id is lower-cased to meet Guid.ToString()'s lowercase form (and the index is on
    // that same expression).
    private Task<bool> IsSubjectErasedAsync(Guid organizationId, Guid providerSubjectId, CancellationToken cancellationToken)
    {
        var subject = providerSubjectId.ToString();
        return _db.Database.SqlQuery<bool>(
                $"""
                 SELECT EXISTS (
                     SELECT 1 FROM assessment_provider_webhook_inbox
                      WHERE organization_id = {organizationId} AND event_type = 'subject.erased'
                        AND lower(data->>'subject_id') = {subject}) AS "Value"
                 """)
            .SingleAsync(cancellationToken);
    }

    // Serializes every lifecycle/result write of one attempt (unordered, possibly concurrent webhook deliveries).
    private Task LockAttemptAsync(Guid attemptId, CancellationToken cancellationToken)
    {
        var key = "assessment-provider-attempt:" + attemptId.ToString();
        return _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", cancellationToken);
    }
}
