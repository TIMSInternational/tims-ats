using Microsoft.EntityFrameworkCore;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Infrastructure;

namespace Tims.Infrastructure.Proctoring;

/// <summary>Tenant-scoped persistence for human proctoring review. No media or AI verdict is stored.</summary>
public sealed partial class StaffProctoringStore(
    ProctoringDbContext db,
    IAnchorLoaderFactory anchorFactory,
    IDataAccessAuditor auditor,
    CandidateProctoringRepository candidateRepository)
{
    private readonly ProctoringDbContext _db = db;
    private readonly IAnchorLoaderFactory _anchors = anchorFactory;
    private readonly IDataAccessAuditor _auditor = auditor;
    private readonly CandidateProctoringRepository _candidateRepository = candidateRepository;

    public async Task<StaffProctoringScope> ResolveScopeAsync(
        Guid organizationId, Guid userId, PrincipalType principalType,
        string action, CancellationToken ct)
    {
        if (principalType == PrincipalType.PlatformOwner)
        {
            // The platform owner still requires an explicit selected tenant. All
            // following assignment queries carry that tenant and use RLS.
            return new StaffProctoringScope(organizationId, userId,
                AccessScope.Organization, [], [],
                [new StaffProctoringRoleGrant(AccessScope.Organization, null, null)]);
        }
        if (principalType != PrincipalType.OrgUser || action is not ("read" or "update"))
            throw new StaffProctoringFailure(403, "proctoring_scope_denied");

        // PermissionService's 5-minute cache and super_admin shortcut do not
        // carry user_roles company/unit scopes or expiry. Re-read the current,
        // role-specific grant for this sensitive surface on every request.
        var now = DateTime.UtcNow;
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var grantRows = await _db.Database.SqlQuery<ActiveStaffGrant>($"""
            SELECT rp.scope AS "Scope", ur.company_scope AS "CompanyScope",
                   ur.unit_scope AS "UnitScope"
              FROM user_roles ur
              JOIN users u ON u.id = ur.user_id
                AND u.organization_id = {organizationId}
                AND u.is_active AND u.deleted_at IS NULL
              JOIN roles r ON r.id = ur.role_id
                AND r.organization_id = {organizationId} AND r.is_active
              JOIN role_permissions rp ON rp.role_id = r.id
              JOIN permissions p ON p.id = rp.permission_id
                AND p.module = 'assessment' AND p.action = {action}
             WHERE ur.user_id = {userId}
               AND ur.assigned_at <= ({now} AT TIME ZONE 'UTC')
               AND (ur.expires_at IS NULL OR ur.expires_at > ({now} AT TIME ZONE 'UTC'))
               AND (r.slug = 'super_admin'
                 OR ({action} = 'read' AND r.slug IN ('hr_admin', 'hrbp')))
            """).ToListAsync(ct);
        await tenant.CommitAsync(ct);

        var grants = new List<StaffProctoringRoleGrant>();
        foreach (var row in grantRows)
        {
            var rawScope = row.Scope == "all" ? "organization" : row.Scope;
            if (AccessScopes.TryParse(rawScope, out var parsed))
                grants.Add(new StaffProctoringRoleGrant(parsed,
                    row.CompanyScope, row.UnitScope));
        }
        if (grants.Count == 0)
            throw new StaffProctoringFailure(403, "proctoring_scope_denied");

        var accessScope = AccessScopes.WidestScope(grants.Select(grant => grant.Scope));
        if (grants.All(grant => grant.Scope is not (AccessScope.Team or AccessScope.Unit)))
            return new StaffProctoringScope(organizationId, userId, accessScope,
                [], [], grants);

        var loader = _anchors.Create(organizationId, userId);
        try
        {
            var teamIds = grants.Any(grant => grant.Scope == AccessScope.Team)
                ? ParseIds(await loader.LedTeamIdsAsync(ct)) : [];
            var unitIds = grants.Any(grant => grant.Scope == AccessScope.Unit)
                ? ParseIds(await loader.UnitIdsAsync(ct)) : [];
            return new StaffProctoringScope(organizationId, userId, accessScope,
                teamIds, unitIds, grants);
        }
        finally
        {
            if (loader is IAsyncDisposable asyncDisposable)
            {
                await asyncDisposable.DisposeAsync();
            }
            else if (loader is IDisposable disposable)
            {
                disposable.Dispose();
            }
        }
    }

    private sealed class ActiveStaffGrant
    {
        public string Scope { get; set; } = string.Empty;
        public Guid? CompanyScope { get; set; }
        public Guid? UnitScope { get; set; }
    }

    private static Guid[] ParseIds(IReadOnlyList<string> values) =>
        values.Select(value => Guid.TryParse(value, out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty).Distinct().ToArray();

    private IQueryable<ProctoringAssignmentRow> ScopedAssignments(StaffProctoringScope scope)
    {
        var assignments = _db.Assignments.Where(row => row.OrganizationId == scope.OrganizationId);
        // Also require the linked vacancy to belong to the tenant at wide scopes.
        // Valid data is unchanged; a malformed cross-tenant foreign key cannot grant access.
        var vacancyIds = _db.Vacancies.Where(scope.VacancyPredicate()).Select(row => row.Id);
        return assignments.Where(row => vacancyIds.Contains(row.VacancyId));
    }

    public Task<bool> CanAccessAssignmentAsync(
        StaffProctoringScope scope, Guid assignmentId, CancellationToken ct) =>
        ScopedAssignments(scope).AnyAsync(row => row.Id == assignmentId, ct);

    private async Task AssertAuthorizedAssignmentAsync(
        StaffProctoringScope scope, Guid assignmentId, CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, scope.OrganizationId, ct);
        var visible = await CanAccessAssignmentAsync(scope, assignmentId, ct);
        await tenant.CommitAsync(ct);
        if (!visible) throw new StaffProctoringFailure(404, "assignment_not_found");
    }

    private async Task ReconcileQueueAsync(StaffProctoringScope scope, CancellationToken ct)
    {
        if (scope.AllowsOrganizationPolicy)
        {
            await _candidateRepository.ReconcileCompletedForOrganizationAsync(
                scope.OrganizationId, null, ct);
            return;
        }

        // Narrow staff may repair only sessions attached to assignments visible through
        // their own/team/unit vacancy anchor. The candidate repository enforces the same
        // 100-ID bound again before performing the idempotent update in one transaction.
        Guid[] assignmentIds;
        await using (var tenant = await TenantScope.BeginAsync(_db, scope.OrganizationId, ct))
        {
            var visibleAssignments = ScopedAssignments(scope);
            assignmentIds = await (
                from session in _db.Sessions
                join assignment in visibleAssignments on session.AssignmentId equals assignment.Id
                where session.OrganizationId == scope.OrganizationId
                    && session.EndedAt == null && assignment.Status == "completed"
                orderby assignment.CompletedAt, assignment.Id
                select assignment.Id).Take(100).ToArrayAsync(ct);
            await tenant.CommitAsync(ct);
        }

        if (assignmentIds.Length > 0)
        {
            await _candidateRepository.ReconcileCompletedForAssignmentsAsync(
                scope.OrganizationId, assignmentIds, ct);
        }
    }

    private static DateTime UtcTimestamp() => DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Unspecified);

    public static bool NeedsAttention(
        ProctoringSessionRow session, ProctoringAssignmentRow assignment, DateTime now) =>
        session.EndedAt is null && assignment.Status == "in_progress"
        && (session.LastHeartbeatAt ?? session.StartedAt) < now.AddMinutes(-3);

    // Prisma stores UTC instants in PostgreSQL timestamp-without-time-zone columns. Npgsql
    // materializes them as Unspecified; mark them UTC for the HTTP JSON contract's trailing Z.
    private static DateTime WireUtc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
    private static DateTime? WireUtc(DateTime? value) => value is { } instant ? WireUtc(instant) : null;
}

public sealed class StaffProctoringFailure(int statusCode, string code) : Exception(code)
{
    public int StatusCode { get; } = statusCode;
    public string Code { get; } = code;
}

public sealed record StaffCandidateSummary(Guid Id, string FirstName, string LastName);
public sealed record StaffAssessmentTypeSummary(string Name);
public sealed record StaffReviewQueueItem(
    Guid SessionId, Guid AssignmentId, StaffCandidateSummary Candidate,
    StaffAssessmentTypeSummary AssessmentType, DateTime? EndedAt, int FlagCount,
    string? Severity, string ReviewStatus, string Status);
public sealed record StaffReviewQueueResponse(IReadOnlyList<StaffReviewQueueItem> Items, Guid? NextCursor);
public sealed record StaffEventSummary(
    Guid Id, string Type, string Severity, DateTime OccurredAt, string Source, DateTime? ClientAt);
public sealed record StaffReviewSummary(string Status, string? Notes, DateTime? ReviewedAt);
public sealed record StaffEvidenceResponse(
    Guid SessionId, Guid AssignmentId, DateTime StartedAt, DateTime? EndedAt,
    DateTime? LastHeartbeatAt, int FlagCount, string? Severity, string Status,
    IReadOnlyList<StaffEventSummary> Events, Guid? NextCursor, StaffReviewSummary Review,
    string EvidenceLevel);
public sealed record StaffPolicyResponse(Guid AssessmentTypeId, bool ProctoringEnabled);
public sealed record StaffReviewResponse(string Status, string? Notes, DateTime ReviewedAt);
