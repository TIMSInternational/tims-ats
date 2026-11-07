using Microsoft.EntityFrameworkCore;
using Tims.Application.FitEngine;
using Tims.Domain.FitEngine;

namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// FIT v2 adapter over the EXISTING ATS assessment tables. Every ATS assessment is an org-authored quiz, so every
/// row maps to instrument <c>native_quiz</c> with its <c>normalized_score</c>. Read-only, under
/// <see cref="TenantScope"/>, with an explicit <c>organization_id</c> filter on all three tables.
///
/// <para>Only assignments that HAVE a result row are returned (the v1 join). Integrity, decided here:</para>
/// <list type="bullet">
/// <item><c>status = 'completed'</c> and no high/critical proctoring session → <see cref="ResultIntegrity.Valid"/>;</item>
/// <item>any other status (e.g. a <c>cancelled</c> = voided assignment that still holds a result), or a
/// proctoring session whose <c>severity</c> is <c>high</c> or <c>critical</c> → <see cref="ResultIntegrity.NeedsReview"/>.
/// Low/medium flags do not block: they stay visible in the proctoring view.</item>
/// </list>
/// <para>The ATS schema has no content or norm version for a quiz. <c>assessment_results.model_version</c> is
/// classified internal (super_admin / hr_admin / external only) and is deliberately NOT read, because the fit
/// breakdown is readable by every fit_engine reader.</para>
/// </summary>
public sealed class AtsAssessmentResultSource(FitEngineWriteDbContext db) : IAssessmentResultSource
{
    /// <summary>The source tag on every result this adapter returns.</summary>
    public const string SourceName = "ats";

    /// <summary>Upper bound on rows read per (candidate, vacancy); the most recent are kept.</summary>
    public const int MaxRows = 50;

    private static readonly HashSet<string> NeedsReviewSeverities =
        new(StringComparer.OrdinalIgnoreCase) { "high", "critical" };

    private readonly FitEngineWriteDbContext _db = db;

    public async Task<IReadOnlyList<InstrumentResult>> GetResultsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var rows = await (
                from a in _db.AssessmentAssignments.AsNoTracking()
                join r in _db.AssessmentResults.AsNoTracking() on a.Id equals r.AssignmentId
                join p in _db.ProctoringSessions.AsNoTracking().Where(p => p.OrganizationId == organizationId)
                    on a.Id equals p.AssignmentId into sessions
                from p in sessions.DefaultIfEmpty()
                where a.OrganizationId == organizationId
                    && r.OrganizationId == organizationId
                    && a.CandidateId == candidateId
                    && a.VacancyId == vacancyId
                orderby a.CompletedAt == null, a.CompletedAt descending, a.Id
                select new
                {
                    a.Id,
                    a.Status,
                    a.CompletedAt,
                    r.NormalizedScore,
                    Severity = p != null ? p.Severity : null,
                })
            .Take(MaxRows)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows
            .Select(row => new InstrumentResult(
                FitInstruments.NativeQuiz,
                row.Id.ToString(),
                SourceName,
                IntegrityOf(row.Status, row.Severity),
                row.CompletedAt is { } completedAt
                    ? new DateTimeOffset(DateTime.SpecifyKind(completedAt, DateTimeKind.Utc))
                    : null,
                row.NormalizedScore,
                GlobalPercentile: null,
                Cefr: null,
                Level: null,
                ContentVersion: null,
                NormVersion: null))
            .ToList();
    }

    /// <summary>The integrity rule above, exposed for unit tests.</summary>
    public static ResultIntegrity IntegrityOf(string status, string? severity) =>
        string.Equals(status, "completed", StringComparison.Ordinal)
        && (severity is null || !NeedsReviewSeverities.Contains(severity))
            ? ResultIntegrity.Valid
            : ResultIntegrity.NeedsReview;
}
