using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// EF repository for the provider connector. Assignment, launch and results (this file); webhook lifecycle, DSAR and
/// bindings (<c>AssessmentProviderRepository.Events.cs</c>).
///
/// <para><b>Tenancy, twice.</b> Every org-scoped method opens a <see cref="TenantScope"/> (app_tenant + org GUC, so the
/// tables' FORCE RLS <c>tenant_isolation</c> policy applies) AND filters <c>organization_id</c> explicitly. The two
/// pre-tenant lookups (<see cref="FindAttemptOwnerAsync"/>, <see cref="FindOrganizationByProviderTenantAsync"/>) run on
/// the privileged connection and return only the org to scope the next call to.</para>
///
/// <para><b>#312.</b> The withdrawn-consent predicate is the FIT engine's (a <c>recruitment_data_processing</c>
/// <c>data_consents</c> row with <c>withdrawn_at</c> set, on the candidate OR on a same-org candidate with the same
/// <c>lower(btrim(email))</c>), and reserving attempts takes the SAME per-candidate advisory lock a withdrawal takes, so
/// a withdrawal can never interleave between the check and the insert.</para>
///
/// <para><b>Audit.</b> Every write to an attempt, a result or a binding appends its <c>audit_logs</c> row in the same
/// transaction: no row, no write. That covers each attempt state change (reserve, created, create failed or refused,
/// launched, every webhook transition, result stored, cancelled, erased). The webhook inbox is not audited row by row:
/// it is itself the delivery record. Audit metadata holds ids, instruments, versions, codes and states only — never
/// scores, tokens, reasons or PII.</para>
/// </summary>
public sealed partial class AssessmentProviderRepository(AssessmentProviderDbContext db) : IAssessmentProviderRepository
{
    private const string RecruitmentConsentType = "recruitment_data_processing";
    private const string AuditEntity = "assessment_provider_attempt";

    private readonly AssessmentProviderDbContext _db = db;

    public async Task<ProviderBindingRow?> GetActiveBindingAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var binding = await _db.Bindings.AsNoTracking()
            .Where(b => b.OrganizationId == organizationId && b.Provider == ProviderNames.TimsAssessments && b.IsActive)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return binding is null ? null : ToRow(binding);
    }

    public async Task<AssignmentContext> LoadAssignmentContextAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var candidate = await _db.Candidates.AsNoTracking()
            .Where(c => c.Id == candidateId && c.OrganizationId == organizationId && c.IsActive && c.DeletedAt == null)
            .Select(c => new { c.FirstName, c.LastName, c.Email })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        var vacancyFound = await _db.Vacancies.AsNoTracking()
            .AnyAsync(v => v.Id == vacancyId && v.OrganizationId == organizationId && v.DeletedAt == null, cancellationToken)
            .ConfigureAwait(false);
        // status = 'active' is a literal on a plain String column (TS assessment.assign parity).
        var hasApplication = await _db.Applications.AsNoTracking()
            .AnyAsync(a => a.OrganizationId == organizationId && a.CandidateId == candidateId && a.VacancyId == vacancyId
                && a.Status == "active", cancellationToken)
            .ConfigureAwait(false);
        var fitRequirements = await _db.JobProfiles.AsNoTracking()
            .Where(j => j.OrganizationId == organizationId && j.VacancyId == vacancyId)
            .Select(j => j.FitRequirements)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        var withdrawn = candidate is not null
            && await IsWithdrawnAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new AssignmentContext(
            candidate is not null, vacancyFound, hasApplication, withdrawn, fitRequirements,
            candidate?.FirstName, candidate?.LastName, candidate?.Email);
    }

    public async Task<ReserveOutcome> ReserveAttemptsAsync(
        Guid organizationId, Guid actorId, ProviderBindingRow binding, Guid candidateId, Guid vacancyId,
        IReadOnlyList<NewAttempt> attempts, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(binding);
        ArgumentNullException.ThrowIfNull(attempts);
        var timestamp = now.UtcDateTime;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();

        // The lock CandidateConsentRepository.WithdrawOneAsync and the FIT upsert take for this candidate.
        var lockKey = candidateId.ToString();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", cancellationToken).ConfigureAwait(false);
        if (await IsWithdrawnAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false))
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new ReserveOutcome(true, []);
        }

        var instruments = attempts.Select(a => a.Instrument).ToList();
        var open = ProviderAttemptStates.Open.ToList();
        var existing = await _db.Attempts
            .Where(a => a.OrganizationId == organizationId && a.CandidateId == candidateId && a.VacancyId == vacancyId
                && instruments.Contains(a.Instrument) && open.Contains(a.State))
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        // All or nothing: an open attempt with other terms (a corrected accommodation, locale or reason) is reported
        // BEFORE anything is inserted, never silently kept as if the request had been applied.
        foreach (var attempt in attempts)
        {
            if (existing.FirstOrDefault(e => e.Instrument == attempt.Instrument) is { } openAttempt
                && !attempt.SameTermsAs(ToRow(openAttempt, isNew: false)))
            {
                await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
                return new ReserveOutcome(false, [], ToRow(openAttempt, isNew: false));
            }
        }

        var rows = new List<AttemptRow>();
        var created = new List<Guid>();
        foreach (var attempt in attempts)
        {
            var found = existing.FirstOrDefault(e => e.Instrument == attempt.Instrument);
            if (found is not null)
            {
                rows.Add(ToRow(found, isNew: false));
                continue;
            }

            var entity = new ProviderAttemptEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                BindingId = binding.Id,
                CandidateId = candidateId,
                VacancyId = vacancyId,
                Instrument = attempt.Instrument,
                State = ProviderAttemptStates.PendingCreate,
                Purpose = "selection",
                JobRelatednessReason = attempt.Reason,
                Locale = attempt.Locale,
                TimeMultiplier = attempt.TimeMultiplier,
                Aids = [.. attempt.Aids],
                RequestedExpiresAt = attempt.ExpiresAt?.UtcDateTime,
                RequiredConsents = [],
                AssignedById = actorId,
                CreatedAt = timestamp,
                UpdatedAt = timestamp,
            };
            _db.Attempts.Add(entity);
            created.Add(entity.Id);
            rows.Add(ToRow(entity, isNew: true));
        }

        if (created.Count > 0)
        {
            AddAudit(organizationId, actorId, "assessment_provider_assigned", created[0], new Dictionary<string, object?>
            {
                ["candidateId"] = candidateId,
                ["vacancyId"] = vacancyId,
                ["instruments"] = instruments,
                ["attemptIds"] = created,
                ["timeMultiplier"] = attempts[0].TimeMultiplier,
                ["aidsCount"] = attempts[0].Aids.Count,
            });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new ReserveOutcome(false, rows);
    }

    public async Task<string?> MarkCreatedAsync(
        Guid organizationId, Guid attemptId, ProviderAssignment assignment, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(assignment);
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // Subject lock, then attempt lock (the order erasure and result storage use too), then a FRESH read: the
        // request's context may still track this attempt from ReserveAttemptsAsync with its pre-lock state.
        await LockSubjectAsync(assignment.SubjectId, cancellationToken).ConfigureAwait(false);
        await LockAttemptAsync(attemptId, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        var attempt = await _db.Attempts
            .FirstOrDefaultAsync(a => a.Id == attemptId && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        if (attempt is not null && attempt.State == ProviderAttemptStates.PendingCreate)
        {
            // A subject.erased for this provider subject was already recorded (its inbox row is the tombstone): the
            // mapping is attached so the attempt stays traceable, but the attempt is erased, never usable.
            var erased = await IsSubjectErasedAsync(organizationId, assignment.SubjectId, cancellationToken).ConfigureAwait(false);
            attempt.State = erased ? ProviderAttemptStates.Erased : ProviderAttemptStates.Created;
            attempt.ProviderSubjectId = assignment.SubjectId;
            attempt.ProviderAssignmentId = assignment.AssignmentId;
            attempt.InstrumentVersion = assignment.InstrumentVersion;
            attempt.ContentVersion = assignment.ContentVersion;
            attempt.RequiredConsents = [.. assignment.RequiredConsents];
            attempt.ExpiresAt = assignment.ExpiresAt.UtcDateTime;
            attempt.LastErrorCode = null;
            attempt.UpdatedAt = now.UtcDateTime;
            AddAudit(organizationId, null,
                erased ? "assessment_provider_attempt_erased_on_create" : "assessment_provider_attempt_created", attempt.Id,
                new Dictionary<string, object?>
                {
                    ["instrument"] = attempt.Instrument,
                    ["providerAssignmentId"] = assignment.AssignmentId,
                    ["instrumentVersion"] = assignment.InstrumentVersion,
                    ["contentVersion"] = assignment.ContentVersion,
                    ["to"] = attempt.State,
                });

            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        else if (attempt is not null && attempt.State == ProviderAttemptStates.Cancelled && attempt.ProviderAssignmentId is null)
        {
            // Staff cancelled the attempt while this create was in flight. The provider now holds an assignment nobody
            // wants: record it durably (ids + the cleanup marker) so the cancel at the provider is retried until it is
            // confirmed, instead of depending on one best-effort call.
            attempt.ProviderSubjectId = assignment.SubjectId;
            attempt.ProviderAssignmentId = assignment.AssignmentId;
            attempt.LastErrorCode = ProviderCleanup.CancelPending;
            attempt.UpdatedAt = now.UtcDateTime;
            AddAudit(organizationId, null, "assessment_provider_orphan_recorded", attempt.Id, new Dictionary<string, object?>
            {
                ["instrument"] = attempt.Instrument,
                ["providerAssignmentId"] = assignment.AssignmentId,
            });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return attempt?.State;
    }

    public async Task MarkProviderCancelledAsync(
        Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await LockAttemptAsync(attemptId, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        var attempt = await _db.Attempts
            .FirstOrDefaultAsync(a => a.Id == attemptId && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        if (attempt is not null && attempt.State == ProviderAttemptStates.Cancelled
            && attempt.LastErrorCode == ProviderCleanup.CancelPending)
        {
            attempt.LastErrorCode = null;
            attempt.UpdatedAt = now.UtcDateTime;
            AddAudit(organizationId, null, "assessment_provider_orphan_cancelled", attempt.Id, new Dictionary<string, object?>
            {
                ["instrument"] = attempt.Instrument,
                ["providerAssignmentId"] = attempt.ProviderAssignmentId,
            });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task MarkCreateFailedAsync(
        Guid organizationId, Guid attemptId, string errorCode, bool cancel, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await LockAttemptAsync(attemptId, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        var attempt = await _db.Attempts
            .FirstOrDefaultAsync(a => a.Id == attemptId && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        if (attempt is not null && attempt.State == ProviderAttemptStates.PendingCreate)
        {
            attempt.LastErrorCode = errorCode.Length <= 64 ? errorCode : errorCode[..64];
            attempt.UpdatedAt = now.UtcDateTime;
            if (cancel)
            {
                attempt.State = ProviderAttemptStates.Cancelled;
            }

            // Refused (cancelled) or still pending for a re-send: either way the failed create is on record.
            AddAudit(organizationId, attempt.AssignedById,
                cancel ? "assessment_provider_assignment_refused" : "assessment_provider_create_failed", attempt.Id,
                new Dictionary<string, object?>
                {
                    ["instrument"] = attempt.Instrument,
                    ["code"] = attempt.LastErrorCode,
                    ["to"] = attempt.State,
                });

            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<string?> MarkCancelledAsync(
        Guid organizationId, Guid attemptId, Guid? expectedProviderAssignmentId, Guid actorId, bool cancelledAtProvider,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // The attempt lock every webhook transition, launch and create mapping takes, then a fresh read: a sitting a
        // webhook finished (or a void) committed first is never overwritten by the cancel.
        await LockAttemptAsync(attemptId, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        var attempt = await _db.Attempts
            .FirstOrDefaultAsync(a => a.Id == attemptId && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        // Mapped to a provider assignment the caller did not cancel (the create was answered meanwhile): leave it, so the
        // caller cancels THAT assignment at the provider first. Never a local cancel over a live provider assignment.
        if (attempt is not null && ProviderAttemptStates.IsCancellable(attempt.State)
            && attempt.ProviderAssignmentId == expectedProviderAssignmentId)
        {
            var from = attempt.State;
            attempt.State = ProviderAttemptStates.Cancelled;
            attempt.UpdatedAt = now.UtcDateTime;
            AddAudit(organizationId, actorId, "assessment_provider_attempt_cancelled", attempt.Id, new Dictionary<string, object?>
            {
                ["instrument"] = attempt.Instrument,
                ["from"] = from,
                ["to"] = attempt.State,
                ["cancelledAtProvider"] = cancelledAtProvider,
            });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return attempt?.State;
    }

    public async Task<(Guid OrganizationId, Guid CandidateId)?> FindAttemptOwnerAsync(
        Guid attemptId, CancellationToken cancellationToken)
    {
        // PRE-TENANT on the privileged connection: only the owner org + candidate leave this query.
        var owner = await _db.Attempts.AsNoTracking()
            .Where(a => a.Id == attemptId)
            .Select(a => new { a.OrganizationId, a.CandidateId })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        return owner is null ? null : (owner.OrganizationId, owner.CandidateId);
    }

    public async Task<AttemptRow?> FindAttemptAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var attempt = await _db.Attempts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == attemptId && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return attempt is null ? null : ToRow(attempt, isNew: false);
    }

    public async Task<LaunchContext?> LoadLaunchContextAsync(
        Guid organizationId, Guid attemptId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var attempt = await _db.Attempts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == attemptId && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        if (attempt is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        var candidate = await _db.Candidates.AsNoTracking()
            .Where(c => c.Id == attempt.CandidateId && c.OrganizationId == organizationId)
            .Select(c => new { c.Email, Active = c.IsActive && c.DeletedAt == null })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        var withdrawn = await IsWithdrawnAsync(organizationId, attempt.CandidateId, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new LaunchContext(ToRow(attempt, isNew: false), candidate?.Email, candidate?.Active == true, withdrawn);
    }

    public async Task AuditConsentCapturedAsync(
        Guid organizationId, Guid auditId, Guid candidateId, Guid attemptId, string purpose, string textVersion,
        string locale, bool recordedAtProvider, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        _db.AuditLogs.Add(new AuditLogEntity
        {
            Id = auditId,
            OrganizationId = organizationId,
            Action = "assessment_consent_captured",
            Entity = AuditEntity,
            EntityId = attemptId.ToString(),
            Metadata = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["candidateId"] = candidateId,
                ["purpose"] = purpose,
                ["textVersion"] = textVersion,
                ["locale"] = locale,
                ["captureMethod"] = "host_ui",
                ["recordedAtProvider"] = recordedAtProvider,
            }),
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task MarkLaunchedAsync(
        Guid organizationId, Guid attemptId, Guid candidateId, string delivery, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await LockAttemptAsync(attemptId, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        var attempt = await _db.Attempts
            .FirstOrDefaultAsync(a => a.Id == attemptId && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        if (attempt is not null)
        {
            // Under the attempt lock every webhook transition also takes, so the state read here is current: a launch
            // never rewinds an attempt a webhook already moved to in_progress, completed or voided.
            if (attempt.State == ProviderAttemptStates.Created)
            {
                attempt.State = ProviderAttemptStates.Launched;
            }

            attempt.LastLaunchedAt = now.UtcDateTime;
            attempt.UpdatedAt = now.UtcDateTime;
            _db.AuditLogs.Add(new AuditLogEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                Action = "assessment_provider_launched",
                Entity = AuditEntity,
                EntityId = attemptId.ToString(),
                Metadata = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["candidateId"] = candidateId,
                    ["instrument"] = attempt.Instrument,
                    ["delivery"] = delivery,
                }),
            });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<ProviderFitRow>> GetFitRowsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var rows = await (
                from a in _db.Attempts.AsNoTracking()
                where a.OrganizationId == organizationId && a.CandidateId == candidateId && a.VacancyId == vacancyId
                join r in _db.Results.AsNoTracking().Where(r => r.OrganizationId == organizationId)
                    on a.LatestResultId equals (Guid?)r.ProviderResultId into results
                from r in results.DefaultIfEmpty()
                select new
                {
                    a.Id,
                    a.Instrument,
                    a.State,
                    a.CompletedAt,
                    a.CreatedAt,
                    a.TimeMultiplier,
                    Applied = r == null ? (decimal?)null : r.TimeMultiplierApplied,
                    ResultId = r == null ? (Guid?)null : r.ProviderResultId,
                    Purpose = r == null ? null : r.Purpose,
                    Validity = r == null ? null : r.ValidityStatus,
                    HumanReview = r != null && r.RequiresHumanReview,
                    ResultCompletedAt = r == null ? (DateTime?)null : r.CompletedAt,
                    Percentile = r == null ? null : r.GlobalPercentile,
                    Cefr = r == null ? null : r.Cefr,
                    Level = r == null ? null : r.Level,
                    Content = r == null ? null : r.ContentVersion,
                    Norm = r == null ? null : r.NormVersion,
                })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows.Select(r => new ProviderFitRow(
            r.Id, r.Instrument, r.State, r.ResultId, r.Purpose, r.Validity, r.HumanReview,
            ToOffset(r.ResultCompletedAt ?? r.CompletedAt), r.Percentile, r.Cefr, r.Level, r.Content, r.Norm,
            ToOffset(r.CreatedAt)!.Value, r.TimeMultiplier, r.Applied)).ToList();
    }

    private async Task<bool> IsWithdrawnAsync(Guid organizationId, Guid candidateId, CancellationToken cancellationToken)
    {
        // (1) Direct: the candidate itself is the withdrawn subject.
        var direct = await _db.DataConsents.AsNoTracking()
            .AnyAsync(dc => dc.OrganizationId == organizationId && dc.ConsentType == RecruitmentConsentType
                && dc.WithdrawnAt != null && dc.SubjectUserId == candidateId, cancellationToken)
            .ConfigureAwait(false);
        if (direct)
        {
            return true;
        }

        // (2) Same person, other row: a same-org candidate with the same non-blank lower(btrim(email)) withdrew.
        return await (
                from target in _db.Candidates.AsNoTracking()
                where target.OrganizationId == organizationId && target.Id == candidateId
                    && target.Email.Trim() != string.Empty
                    && _db.DataConsents.Any(dc => dc.OrganizationId == organizationId
                        && dc.ConsentType == RecruitmentConsentType
                        && dc.WithdrawnAt != null
                        && _db.Candidates.Any(other => other.OrganizationId == organizationId
                            && other.Id == dc.SubjectUserId
                            && other.Email.Trim().ToLower() == target.Email.Trim().ToLower()))
                select target.Id)
            .AnyAsync(cancellationToken).ConfigureAwait(false);
    }

    private void AddAudit(Guid organizationId, Guid? actorId, string action, Guid entityId, Dictionary<string, object?> metadata) =>
        _db.AuditLogs.Add(new AuditLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            UserId = actorId,
            ActorId = actorId,
            Action = action,
            Entity = AuditEntity,
            EntityId = entityId.ToString(),
            Metadata = JsonSerializer.Serialize(metadata),
        });

    private static ProviderBindingRow ToRow(ProviderBindingEntity binding) =>
        new(binding.Id, binding.OrganizationId, binding.ProviderTenantId, binding.EnabledInstruments, binding.DefaultLocale);

    private static AttemptRow ToRow(ProviderAttemptEntity a, bool isNew) =>
        new(a.Id, a.OrganizationId, a.CandidateId, a.VacancyId, a.Instrument, a.State, a.JobRelatednessReason, a.Locale,
            a.TimeMultiplier, a.Aids, ToOffset(a.RequestedExpiresAt), a.ProviderSubjectId, a.ProviderAssignmentId,
            a.InstrumentVersion, a.ContentVersion, a.RequiredConsents, ToOffset(a.ExpiresAt), a.LastErrorCode, isNew);

    private static DateTimeOffset? ToOffset(DateTime? value) =>
        value is { } v ? new DateTimeOffset(DateTime.SpecifyKind(v, DateTimeKind.Utc)) : null;
}
