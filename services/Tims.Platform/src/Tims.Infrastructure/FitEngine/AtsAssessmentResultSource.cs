using System.Text.Json.Nodes;
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
/// <item><c>status = 'completed'</c>, no high/critical proctoring session and no question awaiting manual grading
/// → <see cref="ResultIntegrity.Valid"/>;</item>
/// <item>any other status (e.g. a <c>cancelled</c> = voided assignment that still holds a result), or a
/// proctoring session whose <c>severity</c> is <c>high</c> or <c>critical</c> → <see cref="ResultIntegrity.NeedsReview"/>.
/// Low/medium flags do not block: they stay visible in the proctoring view.</item>
/// <item>a result whose <c>breakdown.pendingManual</c> is non-empty → <see cref="ResultIntegrity.NeedsReview"/>. The
/// submission completes the assignment and stores <c>normalized_score</c> over the AUTO-scored questions only, so
/// one correct choice plus an ungraded essay reads 100. That is not a final score until a person grades the essay.
/// A <c>pendingManual</c> that is present but not an array fails closed (needs review).</item>
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
        // Inside FitEngineWriteRepository.UpsertFitScoreV2Async the read MUST run on the write transaction that holds
        // the FIT v2 lock (same scoped DbContext), so join it instead of opening a second scope (TenantScope does not
        // nest). It is only joined when it is a tenant scope for THIS organization; anything else fails closed.
        TenantScope? scope = null;
        if (_db.Database.CurrentTransaction is null)
        {
            scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            await AssertOpenScopeIsAsync(organizationId, cancellationToken).ConfigureAwait(false);
        }

        await using var ownedScope = scope;

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
                    r.Breakdown,
                    Severity = p != null ? p.Severity : null,
                })
            .Take(MaxRows)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        if (scope is not null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        return rows
            .Select(row => new InstrumentResult(
                FitInstruments.NativeQuiz,
                row.Id.ToString(),
                SourceName,
                IntegrityOf(row.Status, row.Severity, HasPendingManualGrading(row.Breakdown)),
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

    private async Task AssertOpenScopeIsAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        var current = await _db.Database
            .SqlQuery<string>($"SELECT coalesce(current_setting('app.current_org_id', true), '') AS \"Value\"")
            .SingleAsync(cancellationToken)
            .ConfigureAwait(false);
        if (!string.Equals(current, organizationId.ToString(), StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "AtsAssessmentResultSource joined an open transaction that is not a tenant scope for this organization.");
        }
    }

    /// <summary>The integrity rule above, exposed for unit tests.</summary>
    public static ResultIntegrity IntegrityOf(string status, string? severity, bool pendingManualGrading) =>
        string.Equals(status, "completed", StringComparison.Ordinal)
        && (severity is null || !NeedsReviewSeverities.Contains(severity))
        && !pendingManualGrading
            ? ResultIntegrity.Valid
            : ResultIntegrity.NeedsReview;

    /// <summary>
    /// True when <c>breakdown.pendingManual</c> lists at least one question, or is present but not an array (fail
    /// closed). A null breakdown, a non-object breakdown, or one without the key (rows that predate the field) is
    /// false: those carry no manual-grading marker. A JSON null counts as present and not an array. Mirrors the TS <c>hasPendingManualReview</c>, except the
    /// fail-closed branch.
    /// </summary>
    public static bool HasPendingManualGrading(string? breakdownJson)
    {
        if (breakdownJson is null)
        {
            return false;
        }

        if (JsonNode.Parse(breakdownJson) is not JsonObject breakdown
            || !breakdown.TryGetPropertyValue("pendingManual", out var pending))
        {
            return false;
        }

        return pending is not JsonArray list || list.Count > 0;
    }
}
