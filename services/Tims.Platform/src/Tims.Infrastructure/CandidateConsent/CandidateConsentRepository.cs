using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tims.Application.CandidateConsent;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.CandidateConsent;

/// <summary>
/// Candidate consent repository (#312, #313).
///
/// <para><b>Tenancy, twice.</b> Every tenant method opens a <see cref="TenantScope"/> for the org (so the
/// <c>tenant_isolation</c> policy's USING + WITH CHECK engage as <c>app_tenant</c>) AND filters
/// <c>organization_id</c> explicitly — a candidate id from another org is simply not found (→ 404). The only
/// pre-tenant read is the active-organization lookup by its public slug.</para>
///
/// <para><b>Concurrency.</b> A withdrawal takes a transaction-scoped advisory lock per candidate before reading
/// its consent row, so two concurrent withdrawals (staff + self-service, or a double click) serialize: the second
/// sees the first's withdrawal and writes nothing — no duplicate status row (the unique index would reject it),
/// no second deletion request, no second audit row.</para>
///
/// <para><b>Audit is fail-closed.</b> Status change, deletion request and <c>audit_logs</c> row are ONE
/// <c>SaveChanges</c> inside the scope's transaction. The reason text is NOT copied into the audit metadata (it
/// may carry personal data); the audit records who, how and whether a reason and a deletion request exist.</para>
/// </summary>
public sealed partial class CandidateConsentRepository(CandidateConsentDbContext db) : ICandidateConsentRepository
{
    private readonly CandidateConsentDbContext _db = db;

    public async Task<CandidateConsentResult> GetAsync(Guid organizationId, Guid candidateId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        if (!await CandidateExistsAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false))
        {
            return CandidateConsentResult.NotFound;
        }

        var view = await BuildViewAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false);
        return CandidateConsentResult.Ok(view);
    }

    public async Task<CandidateConsentResult> WithdrawAsync(
        Guid organizationId, Guid candidateId, WithdrawalActor actor, DateTime now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        if (!await CandidateExistsAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false))
        {
            return CandidateConsentResult.NotFound;
        }

        var (withdrawn, requestId) = await WithdrawOneAsync(organizationId, candidateId, actor, now, cancellationToken)
            .ConfigureAwait(false);
        var changed = withdrawn || requestId is not null;
        DataSubjectRequestNotice? notice = null;
        if (requestId is { } newRequest)
        {
            notice = await StageAdminAlertsAsync(organizationId, [newRequest], now, cancellationToken).ConfigureAwait(false);
        }

        if (changed)
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        var view = await BuildViewAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false);
        if (changed)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        return CandidateConsentResult.Ok(view, notice);
    }

    public async Task<Guid?> FindActiveOrganizationBySlugAsync(string slug, CancellationToken cancellationToken)
    {
        // Pre-tenant (the org is what we are resolving): the public slug of the careers portal, active orgs only.
        var org = await _db.Organizations.AsNoTracking()
            .Where(o => o.Slug == slug && o.IsActive)
            .Select(o => new { o.Id })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
        return org?.Id;
    }

    public async Task<PortalWithdrawalResult> WithdrawByEmailAsync(
        Guid organizationId, string email, WithdrawalActor actor, DateTime now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);

        // Exact, case-insensitive equality (lower(btrim(email)) = @email) — never a LIKE, so `_`/`%` in an address
        // are not wildcards. Soft-deleted candidates are included, mirroring portal.applyToVacancy's check.
        var candidateIds = await _db.Candidates.AsNoTracking()
            .Where(c => c.OrganizationId == organizationId && c.Email.Trim().ToLower() == email)
            .OrderBy(c => c.Id)
            .Select(c => c.Id)
            .Take(20)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var withdrawnCount = 0;
        var requestIds = new List<Guid>();
        foreach (var candidateId in candidateIds)
        {
            var (withdrawn, requestId) = await WithdrawOneAsync(organizationId, candidateId, actor, now, cancellationToken)
                .ConfigureAwait(false);
            withdrawnCount += withdrawn ? 1 : 0;
            if (requestId is { } id)
            {
                requestIds.Add(id);
            }
        }

        DataSubjectRequestNotice? notice = null;
        if (requestIds.Count > 0)
        {
            notice = await StageAdminAlertsAsync(organizationId, requestIds, now, cancellationToken).ConfigureAwait(false);
        }

        if (withdrawnCount > 0 || requestIds.Count > 0)
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        return new PortalWithdrawalResult(true, withdrawnCount, requestIds.Count, notice);
    }

    /// <summary>
    /// Stages (does not save) the withdrawal of one candidate's recruitment consent. Returns whether the consent was
    /// newly withdrawn and the id of the deletion request it newly filed, if any. An already-withdrawn consent is left exactly
    /// as it is; a self-service withdrawal on it still files a deletion request if none is pending.
    /// </summary>
    private async Task<(bool Withdrawn, Guid? RequestId)> WithdrawOneAsync(
        Guid organizationId, Guid candidateId, WithdrawalActor actor, DateTime now, CancellationToken cancellationToken)
    {
        var timestamp = ToStoreTimestamp(now);
        var lockKey = candidateId.ToString();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", cancellationToken).ConfigureAwait(false);

        var consent = await _db.DataConsents
            .FirstOrDefaultAsync(
                c => c.OrganizationId == organizationId && c.SubjectUserId == candidateId
                    && c.ConsentType == CandidateConsentConstants.ConsentType,
                cancellationToken)
            .ConfigureAwait(false);

        var newlyWithdrawn = false;
        var hadConsentRecord = consent is not null;
        if (consent is null)
        {
            _db.DataConsents.Add(new DataConsentEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                SubjectUserId = candidateId,
                ConsentType = CandidateConsentConstants.ConsentType,
                TextVersion = CandidateConsentConstants.WithdrawalOnlyTextVersion,
                AgreedAt = timestamp,
                WithdrawnAt = timestamp,
                WithdrawalChannel = actor.Channel,
                WithdrawalReason = actor.Reason,
                WithdrawnByUserId = actor.StaffUserId,
                CreatedAt = timestamp,
                UpdatedAt = timestamp,
            });
            newlyWithdrawn = true;
        }
        else if (consent.WithdrawnAt is null)
        {
            consent.WithdrawnAt = timestamp;
            consent.WithdrawalChannel = actor.Channel;
            consent.WithdrawalReason = actor.Reason;
            consent.WithdrawnByUserId = actor.StaffUserId;
            consent.UpdatedAt = timestamp;
            newlyWithdrawn = true;
        }

        Guid? requestId = null;
        if (actor.RequestDeletion)
        {
            var pending = await _db.SubjectRequests.AsNoTracking()
                .AnyAsync(
                    r => r.OrganizationId == organizationId && r.CandidateId == candidateId
                        && r.RequestType == CandidateConsentConstants.DeletionRequestType
                        && r.Status == CandidateConsentConstants.PendingStatus,
                    cancellationToken)
                .ConfigureAwait(false);
            if (!pending)
            {
                requestId = Guid.NewGuid();
                _db.SubjectRequests.Add(new DataSubjectRequestEntity
                {
                    Id = requestId.Value,
                    OrganizationId = organizationId,
                    CandidateId = candidateId,
                    RequestType = CandidateConsentConstants.DeletionRequestType,
                    Status = CandidateConsentConstants.PendingStatus,
                    Source = actor.RequestSource,
                    Reason = actor.Reason,
                    RequestedByUserId = actor.StaffUserId,
                    CreatedAt = timestamp,
                    UpdatedAt = timestamp,
                });
            }
        }

        var requested = requestId is not null;
        if (newlyWithdrawn || requested)
        {
            _db.AuditLogs.Add(new AuditLogEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                UserId = actor.StaffUserId,
                ActorId = actor.StaffUserId,
                Action = CandidateConsentConstants.WithdrawnAuditAction,
                Entity = CandidateConsentConstants.AuditEntity,
                EntityId = candidateId.ToString(),
                Metadata = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["channel"] = actor.Channel,
                    ["by"] = actor.StaffUserId is null ? "data_subject" : "staff",
                    ["hasReason"] = actor.Reason is not null,
                    ["consentNewlyWithdrawn"] = newlyWithdrawn,
                    ["hadConsentRecord"] = hadConsentRecord,
                    ["deletionRequested"] = requested,
                }),
            });
        }

        return (newlyWithdrawn, requestId);
    }

    private Task<bool> CandidateExistsAsync(Guid organizationId, Guid candidateId, CancellationToken cancellationToken) =>
        _db.Candidates.AsNoTracking().AnyAsync(
            c => c.Id == candidateId && c.OrganizationId == organizationId, cancellationToken);

    private async Task<CandidateConsentView> BuildViewAsync(
        Guid organizationId, Guid candidateId, CancellationToken cancellationToken)
    {
        var consent = await _db.DataConsents.AsNoTracking()
            .Where(c => c.OrganizationId == organizationId && c.SubjectUserId == candidateId
                && c.ConsentType == CandidateConsentConstants.ConsentType)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        var evidence = await _db.Evidence.AsNoTracking()
            .Where(e => e.OrganizationId == organizationId && e.CandidateId == candidateId
                && e.ConsentType == CandidateConsentConstants.ConsentType)
            .OrderByDescending(e => e.AgreedAt)
            .ThenBy(e => e.Id)
            .Take(CandidateConsentConstants.MaxEvidenceRows)
            .Select(e => new
            {
                e.ApplicationId,
                e.TextVersion,
                e.TextSha256,
                e.Locale,
                e.AgreedAt,
                e.CaptchaVerified,
                HasMetadata = e.IpHash != null || e.UserAgent != null,
                e.IsBackfilled,
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var request = await _db.SubjectRequests.AsNoTracking()
            .Where(r => r.OrganizationId == organizationId && r.CandidateId == candidateId
                && r.RequestType == CandidateConsentConstants.DeletionRequestType)
            .OrderByDescending(r => r.CreatedAt)
            .ThenBy(r => r.Id)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        var status = consent is null
            ? new CandidateConsentStatus("none", null, null, null, null, null, null)
            : new CandidateConsentStatus(
                consent.WithdrawnAt is null ? "granted" : "withdrawn",
                consent.TextVersion,
                // A withdrawal-only marker carries no authorization: never surface its agreed_at as one.
                consent.TextVersion == CandidateConsentConstants.WithdrawalOnlyTextVersion ? null : Format(consent.AgreedAt),
                consent.WithdrawnAt is { } withdrawnAt ? Format(withdrawnAt) : null,
                consent.WithdrawalChannel,
                consent.WithdrawalReason,
                consent.WithdrawnAt is null ? null : consent.WithdrawnByUserId is null ? "candidate" : "staff");

        return new CandidateConsentView(
            candidateId.ToString(),
            status,
            evidence.Select(e => new CandidateConsentEvidenceItem(
                e.ApplicationId.ToString(),
                e.TextVersion,
                e.TextSha256,
                e.Locale,
                Format(e.AgreedAt),
                e.CaptchaVerified,
                e.HasMetadata,
                e.IsBackfilled)).ToList(),
            request is null
                ? null
                : new CandidateDeletionRequest(request.Id.ToString(), request.Status, request.Source, Format(request.CreatedAt)));
    }

    /// <summary>A stored UTC wall-clock (Kind=Unspecified) as ISO-8601 UTC with millisecond precision.</summary>
    private static string Format(DateTime stored) =>
        DateTime.SpecifyKind(stored, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    // TRAP 11: Npgsql rejects Kind=Utc against a mapped `timestamp` column — store the UTC wall-clock as Unspecified.
    private static DateTime ToStoreTimestamp(DateTime utcNow) =>
        DateTime.SpecifyKind(utcNow, DateTimeKind.Unspecified);
}
