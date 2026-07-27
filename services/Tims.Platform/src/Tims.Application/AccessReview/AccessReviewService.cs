using Tims.Domain.AccessReview;

namespace Tims.Application.AccessReview;

/// <summary>
/// Orchestration mirroring `access-review.service.ts` exactly: `BuildReportAsync` (fetch → kernel →
/// shape → summarize), `AttestAsync` (org-exists → rebuild report → refuse-if-truncated → insert).
/// Deliberately carries NO audit-logging concerns (matches the TS file split: the ROUTER calls
/// `logSecurityEvent`/`logPlatformExport`, not the service) — Task 7's endpoints call
/// <see cref="Tims.Application.Audit.ISecurityEventWriter"/> directly, after calling this service.
/// </summary>
public sealed class AccessReviewService(IAccessReviewRepository repository)
{
    public const int DefaultOrgCap = 10000;

    private readonly IAccessReviewRepository _repository = repository;

    public async Task<AccessReviewReport> BuildReportAsync(
        Guid organizationId, DateTime now, CancellationToken cancellationToken, int cap = DefaultOrgCap)
    {
        var users = await _repository.FetchUsersForReviewAsync(organizationId, cap, cancellationToken).ConfigureAwait(false);
        var truncated = users.Count > cap;
        var rows = (truncated ? users.Take(cap) : users).Select(u => ToRow(u, now)).ToList();

        return new AccessReviewReport(
            Rows: rows,
            Summary: Summarize(rows),
            CrossOrgRoleCount: rows.Count(r => r.Flags.CrossOrgRole),
            Truncated: truncated);
    }

    public async Task<AccessReviewAttestOutcome> AttestAsync(
        Guid organizationId, Guid reviewerId, string? notes, DateTime now, CancellationToken cancellationToken, int cap = DefaultOrgCap)
    {
        if (!await _repository.OrgExistsAsync(organizationId, cancellationToken).ConfigureAwait(false))
        {
            return new AccessReviewAttestOutcome.OrgNotFound();
        }

        var report = await BuildReportAsync(organizationId, now, cancellationToken, cap).ConfigureAwait(false);
        if (report.Truncated)
        {
            return new AccessReviewAttestOutcome.Truncated(cap);
        }

        var summary = report.Summary;
        var attestation = await _repository.InsertAttestationAsync(
            new AccessReviewAttestationInsert(
                organizationId, reviewerId, summary.UserCount, summary.PrivilegedCount,
                summary.StaleCount, summary.DeprovisionGapCount, summary.ExpiredGapCount, notes),
            cancellationToken).ConfigureAwait(false);

        return new AccessReviewAttestOutcome.Success(attestation, summary);
    }

    public Task<IReadOnlyList<AccessReviewAttestationHistoryItem>> ListAttestationsAsync(
        Guid organizationId, int limit, CancellationToken cancellationToken) =>
        _repository.ListAttestationsAsync(organizationId, limit, cancellationToken);

    private static AccessReviewRow ToRow(AccessReviewUserRecord u, DateTime now)
    {
        // Defensive fallback (u.OrganizationId is nullable on the User schema, but the repository's
        // own `where organizationId = @orgId` guarantees every fetched row has one) — mirrors TS's
        // `u.organizationId ?? ''` defensive coalesce, never expected to actually trigger.
        var organizationId = u.OrganizationId ?? Guid.Empty;

        var (status, flags) = AccessRiskKernel.AssessUserAccess(new UserAccessInput(
            organizationId, u.IsActive, u.DeletedAt, u.LastLoginAt,
            u.Roles.Select(r => new RoleAssignment(r.Slug, r.RoleOrganizationId, r.ExpiresAt)).ToList(),
            u.IsPlatformOwner, now));

        return new AccessReviewRow(
            u.Id, $"{u.FirstName} {u.LastName}".Trim(), u.Email, organizationId, u.OrgName, status.ToWire(),
            u.IsPlatformOwner, u.LastLoginAt,
            u.Roles.Select(r => new RoleGrantView(
                r.Slug, r.Name, r.RoleActive, r.AssignedAt, r.AssignedBy, r.CompanyScope, r.UnitScope,
                r.ExpiresAt, r.Grants)).ToList(),
            flags);
    }

    private static AccessReviewSummary Summarize(IReadOnlyList<AccessReviewRow> rows) => new(
        UserCount: rows.Count,
        PrivilegedCount: rows.Count(r => r.Flags.Privileged),
        StaleCount: rows.Count(r => r.Flags.Stale),
        DeprovisionGapCount: rows.Count(r => r.Flags.DeprovisionGap),
        ExpiredGapCount: rows.Count(r => r.Flags.ExpiredGrant));
}

/// <summary>Outcome of <see cref="AccessReviewService.AttestAsync"/> — the endpoint (Task 7) pattern-matches
/// this to a status code (200/404/412), matching this codebase's established outcome-type convention
/// (e.g. <c>SuccessionWriteUseCase</c>'s null-return pattern) rather than throwing for expected outcomes.</summary>
public abstract record AccessReviewAttestOutcome
{
    public sealed record Success(AccessReviewAttestation Attestation, AccessReviewSummary Summary) : AccessReviewAttestOutcome;

    public sealed record OrgNotFound : AccessReviewAttestOutcome;

    public sealed record Truncated(int Cap) : AccessReviewAttestOutcome;
}
