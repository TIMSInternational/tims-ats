using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.CandidateConsent;

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
        // ON CONFLICT DO NOTHING (not catch-23505): a unique violation would abort the whole transaction. The row is due at
        // once (database clock): committing it is all the request does before its 2xx; the inbox worker applies it.
        var inserted = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO assessment_provider_webhook_inbox
                 (id, organization_id, event_id, event_type, event_version, provider_tenant_id, occurred_at,
                  delivery_attempt, status, processing_attempts, data, received_at, next_attempt_at)
             VALUES ({id}, {organizationId}, {envelope.EventId}, {envelope.EventType}, 1, {envelope.ProviderTenantId},
                     {occurredAt}, CAST({deliveryAttempt} AS integer), 'received', 0, CAST({data} AS jsonb), {receivedAt},
                     clock_timestamp())
             ON CONFLICT (organization_id, event_id) DO NOTHING
             """, cancellationToken).ConfigureAwait(false);
        if (inserted == 1)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return InboxOutcome.New;
        }

        // A redelivery of an event that is not final yet makes it due now (the sender retried, so its cause may be
        // gone). A final one (processed, ignored) is acknowledged as a duplicate; a failed one given up on is re-armed.
        var rearmed = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_webhook_inbox
                SET next_attempt_at = LEAST(COALESCE(next_attempt_at, clock_timestamp()), clock_timestamp())
              WHERE organization_id = {organizationId} AND event_id = {envelope.EventId}
                AND status NOT IN ('processed', 'ignored')
             """, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rearmed > 0 ? InboxOutcome.Retry : InboxOutcome.Done;
    }

    public async Task<IReadOnlyList<Guid>> ListOrganizationsWithDueInboxEventsAsync(int max, CancellationToken cancellationToken)
    {
        // PRE-TENANT on the privileged connection, like the poller's listing: only org ids leave; each is then claimed
        // under its own tenant scope. Served by ix_assessment_provider_webhook_inbox_due.
        return await _db.Database.SqlQuery<Guid>(
                $"""
                 SELECT organization_id AS "Value"
                   FROM assessment_provider_webhook_inbox
                  WHERE next_attempt_at IS NOT NULL AND next_attempt_at <= clock_timestamp()
                    AND (lease_until IS NULL OR lease_until < clock_timestamp())
                  GROUP BY organization_id
                  ORDER BY min(next_attempt_at), organization_id
                  LIMIT {max}
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<ClaimedInboxEvent?> ClaimInboxEventAsync(Guid organizationId, Guid owner, CancellationToken cancellationToken)
    {
        var lease = ProviderInboxProcessing.LeaseDuration.TotalSeconds;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // ONE statement: the subquery locks the row it picks (SKIP LOCKED: a row another worker is claiming right now is
        // skipped, never waited for), and a row another worker claimed and committed meanwhile is re-checked against its
        // new version, whose live lease excludes it. So no event is ever leased to two workers at once.
        var claimed = await _db.Database.SqlQuery<InboxClaimRow>(
                $"""
                 UPDATE assessment_provider_webhook_inbox i
                    SET lease_owner = {owner}, lease_until = clock_timestamp() + make_interval(secs => {lease})
                  WHERE i.organization_id = {organizationId}
                    AND i.id = (
                        SELECT q.id FROM assessment_provider_webhook_inbox q
                         WHERE q.organization_id = {organizationId}
                           AND q.next_attempt_at IS NOT NULL AND q.next_attempt_at <= clock_timestamp()
                           AND (q.lease_until IS NULL OR q.lease_until < clock_timestamp())
                         ORDER BY q.next_attempt_at, q.occurred_at, q.id
                         LIMIT 1
                         FOR UPDATE SKIP LOCKED)
                 RETURNING i.event_id AS "EventId", i.event_type AS "EventType", i.occurred_at AS "OccurredAt",
                           i.provider_tenant_id AS "ProviderTenantId", i.data::text AS "Data",
                           i.processing_attempts AS "ProcessingAttempts", i.received_at AS "ReceivedAt"
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        if (claimed.Count == 0)
        {
            return null;
        }

        var row = claimed[0];
        return new ClaimedInboxEvent(
            new ProviderEventEnvelope(row.EventId, row.EventType, AsUtc(row.OccurredAt), row.ProviderTenantId, row.Data),
            row.ProcessingAttempts, AsUtc(row.ReceivedAt));
    }

    public async Task CompleteInboxAsync(
        Guid organizationId, Guid eventId, Guid owner, string status, string? errorCode, DateTimeOffset? retryAt,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(status);
        var code = errorCode is null ? null : errorCode.Length <= 64 ? errorCode : errorCode[..64];
        var processedAt = status is InboxStatuses.Processed or InboxStatuses.Ignored ? (DateTime?)now.UtcDateTime : null;
        var next = retryAt?.UtcDateTime;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // Conditional on the owner: a worker whose lease expired (and whose row another worker claimed) records nothing.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_webhook_inbox
                SET status = {status}, last_error_code = {code}, processing_attempts = processing_attempts + 1,
                    processed_at = CAST({processedAt} AS timestamptz), next_attempt_at = CAST({next} AS timestamptz),
                    lease_owner = NULL, lease_until = NULL
              WHERE organization_id = {organizationId} AND event_id = {eventId} AND lease_owner = {owner}
             """, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static DateTimeOffset AsUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private sealed class InboxClaimRow
    {
        public Guid EventId { get; init; }

        public string EventType { get; init; } = string.Empty;

        public DateTime OccurredAt { get; init; }

        public Guid ProviderTenantId { get; init; }

        public string Data { get; init; } = "{}";

        public int ProcessingAttempts { get; init; }

        public DateTime ReceivedAt { get; init; }
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
        // A lifecycle void never lands on an attempt that holds a stored result, whatever state it is in (a superseded
        // attempt keeps its expired/voided state with a result attached): result revisions alone decide validity once
        // one exists, and StoreResultAsync applies them under this same lock. Checked on the fresh read, under the lock,
        // so a void racing a result store cannot interleave.
        if (attempt is null || !ProviderAttemptStates.CanTransition(attempt.State, toState)
            || (toState == ProviderAttemptStates.Voided && attempt.LatestResultId is not null))
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
        // The per-candidate lock a #312 withdrawal holds while it stages this attempt (D15): once it is ours, a
        // withdrawal either committed before (and is seen below) or waits until this write commits. Lock order
        // subject -> attempt -> candidate, as everywhere a write takes more than one.
        await CandidateConsentLocks.LockCandidateAndSiblingsAsync(
            _db.Database, organizationId, attempt.CandidateId, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();

        // Checked under the locks erasure and withdrawal also take, on a fresh read, BEFORE anything is inserted: a
        // result fetched before a subject.erased committed must not bring the erased scores back, whether the erasure
        // already reached this attempt (state) or only its tombstone exists (an erasure that ran before the mapping
        // committed); and nothing is stored once the candidate withdrew consent or an erasure was requested.
        var entity = await _db.Attempts
            .FirstOrDefaultAsync(a => a.Id == attempt.Id && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        if (entity is null || entity.State is ProviderAttemptStates.Erased or ProviderAttemptStates.Cancelled
            || entity.WithdrawalState is not null || entity.ProviderErasureRequestedAt is not null
            || await IsWithdrawnAsync(organizationId, entity.CandidateId, cancellationToken).ConfigureAwait(false)
            || await IsSubjectErasedAsync(organizationId, result.SubjectId, cancellationToken).ConfigureAwait(false)
            // Codex r12 P1: the attempt was read BEFORE the fetch; a hide that committed since bumped the generation,
            // so these scores may be ones the tenant has hidden. Not stored; the next read (fresh row) decides again.
            || entity.ResultVisibilityGeneration != attempt.ResultVisibilityGeneration)
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
        // ANY newer attempt that was not cancelled supersedes this one, the same rule FIT uses to pick the current
        // attempt, whether the replacement is still open or has itself expired or been voided. The corrected revision is
        // kept on record, but the attempt is not reopened: reopening would hold the one open slot without being the
        // attempt FIT reads (and, with an open replacement, break ux_assessment_provider_attempts_open and fail the
        // delivery on every retry). The candidate lock is the one the reserve takes, so a re-assignment can never
        // interleave between this check and the update.
        var restored = result.ValidityStatus == ProviderValidity.Voided ? ProviderAttemptStates.Voided : ProviderAttemptStates.ResultReady;
        var superseded = false;
        if (restored == ProviderAttemptStates.ResultReady && !ProviderAttemptStates.IsOpen(entity.State))
        {
            var open = ProviderAttemptStates.Open.ToList();
            superseded = await _db.Attempts.AsNoTracking()
                .AnyAsync(a => a.OrganizationId == organizationId && a.Id != entity.Id && a.CandidateId == entity.CandidateId
                    && a.VacancyId == entity.VacancyId && a.Instrument == entity.Instrument
                    && (open.Contains(a.State)
                        || (a.State != ProviderAttemptStates.Cancelled && a.CreatedAt > entity.CreatedAt)),
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

    public async Task<int> HideResultAsync(
        Guid organizationId, AttemptRow attempt, Guid resultId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(attempt);
        var timestamp = now.UtcDateTime;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // The lock order result storage uses (subject, then attempt): a store of this result in flight either committed
        // first (and is deleted here) or runs after and stores it again only if a later fetch is visible again.
        if (attempt.ProviderSubjectId is { } subjectId)
        {
            await LockSubjectAsync(subjectId, cancellationToken).ConfigureAwait(false);
        }

        await LockAttemptAsync(attempt.Id, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        var entity = await _db.Attempts
            .FirstOrDefaultAsync(a => a.Id == attempt.Id && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        if (entity is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return 0;
        }

        // The DELETE fires fit_v2_provider_result_changed (AFTER ... DELETE), which enqueues this candidate's FIT v2
        // recompute in this transaction: FIT stops counting the result when the drain runs.
        var removed = await _db.Results
            .Where(r => r.OrganizationId == organizationId && r.AttemptId == entity.Id && r.ProviderResultId == resultId)
            .ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        var from = entity.State;
        // Fence every fetch already in flight (Codex r12 P1): it read the attempt under the old generation.
        entity.ResultVisibilityGeneration++;
        // LatestResultId is KEPT (Codex r12 P2): the D17 poller re-reads result_ready attempts by it, so if the tenant
        // makes the result visible again and that webhook is lost, the poll still brings it back. Staff reads and FIT
        // read the stored result rows, which were deleted above.

        // The sitting finished either way: the attempt moves to result_ready when it still may (never backward, never
        // out of a terminal state), exactly as the not-visible answer always did.
        if (ProviderAttemptStates.CanTransition(entity.State, ProviderAttemptStates.ResultReady))
        {
            entity.State = ProviderAttemptStates.ResultReady;
        }

        entity.UpdatedAt = timestamp;
        if (removed > 0 || from != entity.State)
        {
            AddAudit(organizationId, null, "assessment_provider_result_hidden", entity.Id, new Dictionary<string, object?>
            {
                ["instrument"] = entity.Instrument,
                ["resultId"] = resultId,
                ["removed"] = removed,
                ["from"] = from,
                ["to"] = entity.State,
            });
        }

        // Always saved: the generation bump is the fence, even when nothing was stored yet.
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return removed;
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

    public async Task<Guid?> FindActiveOrganizationBySlugAsync(string slug, CancellationToken cancellationToken) =>
        await _db.Organizations.AsNoTracking()
            .Where(o => o.Slug == slug && o.IsActive && o.DeletedAt == null)
            .Select(o => (Guid?)o.Id)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

    public async Task<IReadOnlyList<AttemptRow>> ListCandidateAttemptsByEmailAsync(
        Guid organizationId, string verifiedEmail, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(verifiedEmail);
        var email = verifiedEmail.Trim().ToLowerInvariant();
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var candidates = await _db.Candidates.AsNoTracking()
            .Where(c => c.OrganizationId == organizationId && c.IsActive && c.DeletedAt == null
                && c.Email.Trim().ToLower() == email)
            .Select(c => c.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        List<ProviderAttemptEntity> rows = [];
        if (candidates.Count > 0
            && !await IsWithdrawnAsync(organizationId, candidates[0], cancellationToken).ConfigureAwait(false))
        {
            rows = await _db.Attempts.AsNoTracking()
                .Where(a => a.OrganizationId == organizationId && candidates.Contains(a.CandidateId))
                .OrderByDescending(a => a.CreatedAt).ThenBy(a => a.Id)
                .Take(50)
                .ToListAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(a => ToRow(a, isNew: false)).ToList();
    }

    public async Task<string?> GetActiveOrganizationSlugAsync(Guid organizationId, CancellationToken cancellationToken) =>
        await _db.Organizations.AsNoTracking()
            .Where(o => o.Id == organizationId && o.IsActive && o.DeletedAt == null)
            .Select(o => o.Slug)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

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
