using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Tims.Application.ExternalVendor;
using Tims.Domain.ExternalVendor;

namespace Tims.Infrastructure.ExternalVendor;

/// <summary>
/// Read-only EF implementation of <see cref="IExternalAssessmentRepository"/> — a faithful port of the TS
/// <c>external-assessment.repository.ts</c>. Every query is <c>AsNoTracking()</c> and runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so RLS engages, with an EXPLICIT
/// <c>organizationId</c> on BOTH the result AND the joined assignment (defense-in-depth, INV-E). Only
/// COMPLETED assignments are exposed (INV-A). The projection selects ONLY the external classification
/// ceiling (the eight scored fields, all visible to <c>external</c>) + anchors + <c>scoredAt</c> + the
/// assignment context — never a non-ceiling sensitive column.
/// </summary>
public sealed class ExternalAssessmentRepository(ExternalAssessmentDbContext db) : IExternalAssessmentRepository
{
    private const string CompletedStatus = "completed";

    private readonly ExternalAssessmentDbContext _db = db;

    public async Task<ExternalResultPage> ListAsync(
        string organizationId, int take, string? cursor, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var query = CompletedResults(orgId);

        if (cursor is not null)
        {
            var cursorId = Guid.Parse(cursor);
            // Look up the cursor row's scoredAt within the SAME visible set (org + completed). An
            // unknown/invisible cursor (wrong org, non-completed, or missing) yields no boundary → an
            // empty page, never a leak. Reproduces Prisma's cursor+skip:1 within orderBy
            // [scoredAt desc, assignmentId asc]: return rows strictly AFTER the cursor in that ordering.
            var cursorScoredAt = await query
                .Where(r => r.AssignmentId == cursorId)
                .Select(r => (DateTime?)r.ScoredAt)
                .FirstOrDefaultAsync(cancellationToken)
                .ConfigureAwait(false);
            if (cursorScoredAt is null)
            {
                return new ExternalResultPage([], null);
            }

            var boundary = cursorScoredAt.Value;
            query = query.Where(r =>
                r.ScoredAt < boundary ||
                (r.ScoredAt == boundary && r.AssignmentId.CompareTo(cursorId) > 0));
        }

        var page = await query
            .OrderByDescending(r => r.ScoredAt)
            .ThenBy(r => r.AssignmentId)
            .Select(Projection)
            .Take(take + 1)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var hasMore = page.Count > take;
        var rows = page.Take(take).Select(MapRow).ToList();
        var nextCursor = hasMore ? rows[take - 1].AssignmentId : null;
        return new ExternalResultPage(rows, nextCursor);
    }

    public async Task<ExternalResultRow?> GetOneAsync(
        string organizationId, string assignmentId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var wantedAssignmentId = Guid.Parse(assignmentId);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Same gate as the list: result-gated AND completed-only. A scored result on a non-completed
        // assignment returns null → NOT_FOUND (INV-A leak-fix); a cross-org id also returns null (INV-E/G).
        var row = await CompletedResults(orgId)
            .Where(r => r.AssignmentId == wantedAssignmentId)
            .Select(Projection)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        return row is null ? null : MapRow(row);
    }

    // org filter on BOTH the result AND the joined assignment (defense-in-depth) + completed-only.
    private IQueryable<ExternalAssessmentResultReadEntity> CompletedResults(Guid orgId) =>
        _db.Results.AsNoTracking().Where(r =>
            r.OrganizationId == orgId &&
            r.Assignment.OrganizationId == orgId &&
            r.Assignment.Status == CompletedStatus);

    // Projects ONLY the ceiling columns into a flat row (no non-ceiling sensitive column is ever selected).
    private static readonly System.Linq.Expressions.Expression<Func<ExternalAssessmentResultReadEntity, ProjectedRow>> Projection =
        r => new ProjectedRow(
            r.Id,
            r.AssignmentId,
            r.RawScore,
            r.NormalizedScore,
            r.Percentile,
            r.Band,
            r.NormSampleSize,
            r.Breakdown,
            r.Interpretation,
            r.ModelVersion,
            r.ScoredAt,
            r.Assignment.CandidateId,
            r.Assignment.VacancyId,
            r.Assignment.Status,
            r.Assignment.AssignedAt,
            r.Assignment.StartedAt,
            r.Assignment.CompletedAt,
            r.Assignment.ExpiresAt,
            r.Assignment.AssessmentType.Name);

    /// <summary>
    /// The LIVE projection expression, exposed read-only (typed as the base <see cref="LambdaExpression"/>
    /// so the private <c>ProjectedRow</c> stays private) SOLELY so the authoritative projection-pin test
    /// (Tims.IntegrationTests) walks the ACTUAL EF projection with an <c>ExpressionVisitor</c> instead of a
    /// hand-maintained mirror list: adding a non-ceiling classified column, or dropping a ceiling column,
    /// fails the classification-kernel pin. No behavior change — read-only accessor over the same field.
    /// </summary>
    internal static System.Linq.Expressions.LambdaExpression ProjectionExpression => Projection;

    private static ExternalResultRow MapRow(ProjectedRow r) => new(
        r.Id.ToString(),
        r.AssignmentId.ToString(),
        r.RawScore,
        r.NormalizedScore,
        r.Percentile,
        r.Band,
        r.NormSampleSize,
        ParseJson(r.Interpretation),
        ParseJson(r.Breakdown),
        r.ModelVersion,
        ToUtc(r.ScoredAt),
        new ExternalAssignmentContext(
            r.CandidateId.ToString(),
            r.VacancyId.ToString(),
            r.Status,
            ToUtc(r.AssignedAt),
            ToUtcNullable(r.StartedAt),
            ToUtcNullable(r.CompletedAt),
            ToUtcNullable(r.ExpiresAt),
            r.AssessmentTypeName));

    private static JsonNode? ParseJson(string? raw) =>
        string.IsNullOrWhiteSpace(raw) ? null : JsonNode.Parse(raw);

    // The Prisma `timestamp` columns store UTC wall-clock (Npgsql reads them Kind=Unspecified); represent
    // the instant explicitly as UTC. The v1 HTTP wire format (Node `.toISOString()` = `…fffZ`) is now
    // PINNED on the DTO via NodeIsoDateTimeOffsetConverter + the shared golden fixture (FIX 4) — no longer
    // a deferred cutover concern.
    private static DateTimeOffset ToUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static DateTimeOffset? ToUtcNullable(DateTime? value) =>
        value is null ? null : ToUtc(value.Value);

    private sealed record ProjectedRow(
        Guid Id,
        Guid AssignmentId,
        double? RawScore,
        double? NormalizedScore,
        double? Percentile,
        string? Band,
        int? NormSampleSize,
        string? Breakdown,
        string? Interpretation,
        string? ModelVersion,
        DateTime ScoredAt,
        Guid CandidateId,
        Guid VacancyId,
        string Status,
        DateTime AssignedAt,
        DateTime? StartedAt,
        DateTime? CompletedAt,
        DateTime? ExpiresAt,
        string AssessmentTypeName);
}
