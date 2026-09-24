using Microsoft.EntityFrameworkCore;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Domain.Access;
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
        Guid organizationId, Guid userId, AccessScope accessScope, CancellationToken ct)
    {
        if (accessScope is AccessScope.Company or AccessScope.Organization)
        {
            return new StaffProctoringScope(organizationId, userId, accessScope, [], []);
        }

        var loader = _anchors.Create(organizationId, userId);
        try
        {
            var teamIds = accessScope == AccessScope.Team
                ? ParseIds(await loader.LedTeamIdsAsync(ct)) : [];
            var unitIds = accessScope == AccessScope.Unit
                ? ParseIds(await loader.UnitIdsAsync(ct)) : [];
            return new StaffProctoringScope(organizationId, userId, accessScope, teamIds, unitIds);
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
        if (scope.Scope is AccessScope.Company or AccessScope.Organization)
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
