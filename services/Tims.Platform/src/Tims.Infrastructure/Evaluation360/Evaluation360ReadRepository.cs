using Microsoft.EntityFrameworkCore;
using Tims.Application.Evaluation360;
using Tims.Domain.Access;

namespace Tims.Infrastructure.Evaluation360;

/// <summary>
/// Read-only EF implementation of <see cref="IEvaluation360ReadRepository"/> — a faithful port of the read
/// methods of the TS <c>evaluation360.repository.ts</c>. Every query is <c>AsNoTracking()</c> and runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c>
/// filter (defense-in-depth). The self-service queries ADDITIONALLY hard-filter on the caller's own user id
/// (<c>raterUserId</c> for tasks, <c>subjectUserId</c> for the report/report-cycles) — never scope narrowing,
/// so an org-scoped admin can never read on another user's behalf. NEVER logs row content.
///
/// <see cref="FindReportRowsAsync"/> is the MOST sensitive query: its projection NEVER includes
/// <c>rater_user_id</c> (not on the response, not on the nested assignment) — only <c>assignmentId</c> reaches
/// the aggregator, so a rater's identity never leaves the DB (peer/direct_report anonymity depends on it).
/// Prisma <c>timestamp(3)</c> columns are read as Unspecified-kind wall-clock UTC and re-kinded to UTC here; the
/// enum columns are read as CLR enums (mapped data source) and flattened to their DB labels for the wire/kernel.
/// </summary>
public sealed class Evaluation360ReadRepository(Evaluation360ReadDbContext db) : IEvaluation360ReadRepository
{
    private readonly Evaluation360ReadDbContext _db = db;

    public async Task<IReadOnlyList<CycleRow>> ListCyclesAsync(string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rows = await _db.ReviewCycles.AsNoTracking()
            .Where(c => c.OrganizationId == orgId)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Status,
                c.OpensAt,
                c.ClosesAt,
                c.PublishedAt,
                c.CreatedAt,
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(c => new CycleRow(
                c.Id.ToString(),
                c.Name,
                c.Status.Label(),
                ToUtcNullable(c.OpensAt),
                ToUtcNullable(c.ClosesAt),
                ToUtcNullable(c.PublishedAt),
                ToUtc(c.CreatedAt)))
            .ToList();
    }

    public async Task<CycleStatusRow?> GetCycleForOrgAsync(
        string organizationId, string cycleId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var cid = Guid.Parse(cycleId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var row = await _db.ReviewCycles.AsNoTracking()
            .Where(c => c.Id == cid && c.OrganizationId == orgId)
            .Select(c => new { c.Id, c.Status })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        return row is null ? null : new CycleStatusRow(row.Id.ToString(), row.Status.Label());
    }

    public async Task<IReadOnlyList<ProgressCountRow>> GetProgressCountsAsync(
        string organizationId, string cycleId, string excludeSubjectUserId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var cid = Guid.Parse(cycleId);
        var excludeSubject = Guid.Parse(excludeSubjectUserId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Per-(relationship, status) counts, EXCLUDING the caller's own subject-assignments (so an admin who is
        // also a subject cannot difference their own suppressed peer/direct_report bucket size from the totals).
        var grouped = await _db.RaterAssignments.AsNoTracking()
            .Where(a => a.OrganizationId == orgId && a.CycleId == cid && a.SubjectUserId != excludeSubject)
            .GroupBy(a => new { a.Relationship, a.Status })
            .Select(g => new { g.Key.Relationship, g.Key.Status, Count = g.Count() })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return grouped
            .Select(g => new ProgressCountRow(g.Relationship.Label(), g.Status.Label(), g.Count))
            .ToList();
    }

    public async Task<IReadOnlyList<RaterTaskRow>> FindRaterTasksAsync(
        string organizationId, string raterUserId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var rater = Guid.Parse(raterUserId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Hard-filtered on the CALLER's rater id: pending assignments in OPEN cycles, newest cycle first.
        var rows = await _db.RaterAssignments.AsNoTracking()
            .Where(a =>
                a.RaterUserId == rater &&
                a.OrganizationId == orgId &&
                a.Status == RaterAssignmentStatusPg.Pending &&
                a.Cycle.Status == ReviewCycleStatusPg.Open)
            .OrderByDescending(a => a.Cycle.CreatedAt)
            .Select(a => new
            {
                a.Id,
                a.CycleId,
                CycleName = a.Cycle.Name,
                a.Relationship,
                a.Subject.FirstName,
                a.Subject.LastName,
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(a => new RaterTaskRow(
                a.Id.ToString(),
                a.CycleId.ToString(),
                a.CycleName,
                a.Relationship.Label(),
                a.FirstName,
                a.LastName))
            .ToList();
    }

    public async Task<PublishedCycleRow?> FindPublishedCycleAsync(
        string organizationId, string cycleId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var cid = Guid.Parse(cycleId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var row = await _db.ReviewCycles.AsNoTracking()
            .Where(c => c.Id == cid && c.OrganizationId == orgId && c.Status == ReviewCycleStatusPg.Published)
            .Select(c => new { c.Id, c.Name })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        return row is null ? null : new PublishedCycleRow(row.Id.ToString(), row.Name);
    }

    public async Task<bool> SubjectHasAssignmentInCycleAsync(
        string organizationId, string cycleId, string subjectUserId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var cid = Guid.Parse(cycleId);
        var subject = Guid.Parse(subjectUserId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        return await _db.RaterAssignments.AsNoTracking()
            .AnyAsync(
                a => a.CycleId == cid && a.OrganizationId == orgId && a.SubjectUserId == subject,
                cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<Eval360Aggregate.AggregateInputRow>> FindReportRowsAsync(
        string organizationId, string cycleId, string subjectUserId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var cid = Guid.Parse(cycleId);
        var subject = Guid.Parse(subjectUserId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Every SUBMITTED response for this subject in this cycle, flattened with the assignment's relationship.
        // The projection NEVER reads rater_user_id — only assignmentId identifies the rater (anonymity).
        var rows = await _db.RaterResponses.AsNoTracking()
            .Where(r =>
                r.OrganizationId == orgId &&
                r.Assignment.CycleId == cid &&
                r.Assignment.OrganizationId == orgId &&
                r.Assignment.SubjectUserId == subject &&
                r.Assignment.Status == RaterAssignmentStatusPg.Submitted)
            .Select(r => new
            {
                r.AssignmentId,
                Relationship = r.Assignment.Relationship,
                r.CompetencyKey,
                r.Rating,
                r.Comment,
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(r => new Eval360Aggregate.AggregateInputRow(
                r.AssignmentId.ToString(),
                r.Relationship.Label(),
                r.CompetencyKey,
                r.Rating,
                r.Comment))
            .ToList();
    }

    public async Task<IReadOnlyList<ReportCycleRow>> FindPublishedCyclesForSubjectAsync(
        string organizationId, string subjectUserId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var subject = Guid.Parse(subjectUserId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var rows = await _db.ReviewCycles.AsNoTracking()
            .Where(c =>
                c.OrganizationId == orgId &&
                c.Status == ReviewCycleStatusPg.Published &&
                c.Assignments.Any(a => a.SubjectUserId == subject))
            .OrderByDescending(c => c.PublishedAt)
            .Select(c => new { c.Id, c.Name, c.PublishedAt })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(c => new ReportCycleRow(c.Id.ToString(), c.Name, ToUtcNullable(c.PublishedAt)))
            .ToList();
    }

    // Prisma `timestamp(3)` columns store UTC wall-clock (Npgsql reads them Kind=Unspecified); re-kind to UTC so
    // the shared Node-ISO converter emits the same `…fffZ` wire form Node's Date.toISOString() produces.
    private static DateTimeOffset ToUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static DateTimeOffset? ToUtcNullable(DateTime? value) =>
        value is null ? null : ToUtc(value.Value);
}
