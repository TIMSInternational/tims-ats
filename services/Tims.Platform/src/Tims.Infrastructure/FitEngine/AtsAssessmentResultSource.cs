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
/// <item><c>status = 'completed'</c>, a proctoring session that does not hold the result (below) and no question
/// awaiting manual grading → <see cref="ResultIntegrity.Valid"/>;</item>
/// <item>any other status (e.g. a <c>cancelled</c> = voided assignment that still holds a result) →
/// <see cref="ResultIntegrity.NeedsReview"/>;</item>
/// <item>the proctoring session, by its review-completion signal <c>review_status</c> (migration
/// 20261109100000_fit_v2_integrity): <c>clear</c> (a person reviewed it and found no concern) never holds the result,
/// whatever the severity; <c>concern</c>, <c>inconclusive</c> or any other reviewed value always holds it (needs
/// review); <c>unreviewed</c> holds it only when the <c>severity</c> is <c>high</c> or <c>critical</c>. Low/medium
/// flags do not block: they stay visible in the proctoring view.</item>
/// <item>a result whose <c>breakdown.pendingManual</c> is non-empty → <see cref="ResultIntegrity.NeedsReview"/>. The
/// submission completes the assignment and stores <c>normalized_score</c> over the AUTO-scored questions only, so
/// one correct choice plus an ungraded essay reads 100. That is not a final score until a person grades the essay.
/// A <c>pendingManual</c> that is present but not an array fails closed (needs review).</item>
/// </list>
/// <para><b>Several quizzes.</b> Each result carries its quiz (<c>assessment_type_id</c>) as the variant, so FIT v2 judges
/// the most recent result of EACH quiz assigned for the vacancy (<see cref="FitV2Kernels.CombineVariants"/>) instead of
/// letting the latest quiz hide the others.</para>
/// <para>The ATS schema has no content or norm version for a quiz. <c>assessment_results.model_version</c> is
/// classified internal (super_admin / hr_admin / external only) and is deliberately NOT read, because the fit
/// breakdown is readable by every fit_engine reader.</para>
/// </summary>
public sealed class AtsAssessmentResultSource(FitEngineWriteDbContext db) : IAssessmentResultSource
{
    /// <summary>The source tag on every result this adapter returns.</summary>
    public const string SourceName = "ats";

    /// <summary>
    /// Upper bound on the quizzes read per (candidate, vacancy). Only each quiz's most recent result is read (in SQL,
    /// before the bound), so the bound never drops a quiz's latest result in favour of another quiz's older ones. Past
    /// it, the instrument fails closed: every result is reported as needs review.
    /// </summary>
    public const int MaxQuizzes = 50;

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

        // The most recent result of EACH quiz (DISTINCT ON the quiz, in the kernel's recency order: completed_at DESC
        // nulls last, then the assignment id), so no bound can hide a quiz behind another quiz's newer attempts. A
        // FormattableString: every value is a bound parameter.
        var rows = await _db.Database.SqlQuery<QuizResultRow>($"""
                SELECT DISTINCT ON (a.assessment_type_id)
                       a.id AS "Id", a.status AS "Status", a.completed_at AS "CompletedAt",
                       a.assessment_type_id AS "AssessmentTypeId", r.normalized_score AS "NormalizedScore",
                       r.breakdown::text AS "Breakdown", p.severity AS "Severity", p.review_status AS "ReviewStatus"
                FROM assessment_assignments a
                JOIN assessment_results r ON r.assignment_id = a.id AND r.organization_id = {organizationId}
                LEFT JOIN proctoring_sessions p ON p.assignment_id = a.id AND p.organization_id = {organizationId}
                WHERE a.organization_id = {organizationId} AND a.candidate_id = {candidateId}
                  AND a.vacancy_id = {vacancyId}
                ORDER BY a.assessment_type_id, (a.completed_at IS NULL), a.completed_at DESC, a.id
                LIMIT {MaxQuizzes + 1}
                """)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        var overflow = rows.Count > MaxQuizzes;

        if (scope is not null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        return rows
            .Select(row => new InstrumentResult(
                FitInstruments.NativeQuiz,
                row.Id.ToString(),
                SourceName,
                overflow
                    ? ResultIntegrity.NeedsReview
                    : IntegrityOf(row.Status, row.Severity, row.ReviewStatus, HasPendingManualGrading(row.Breakdown)),
                row.CompletedAt is { } completedAt
                    ? new DateTimeOffset(DateTime.SpecifyKind(completedAt, DateTimeKind.Utc))
                    : null,
                row.NormalizedScore,
                GlobalPercentile: null,
                Cefr: null,
                Level: null,
                ContentVersion: null,
                NormVersion: null,
                Variant: row.AssessmentTypeId.ToString()))
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

    /// <summary>One quiz's most recent result, as the adapter's SQL returns it (column aliases match these names).</summary>
    public sealed class QuizResultRow
    {
        public Guid Id { get; init; }

        public string Status { get; init; } = null!;

        public DateTime? CompletedAt { get; init; }

        public Guid AssessmentTypeId { get; init; }

        public double? NormalizedScore { get; init; }

        public string? Breakdown { get; init; }

        public string? Severity { get; init; }

        public string? ReviewStatus { get; init; }
    }

    /// <summary>The review status a session has until a person reviews it.</summary>
    public const string Unreviewed = "unreviewed";

    /// <summary>The one review outcome that releases a session's result.</summary>
    public const string ReviewClear = "clear";

    /// <summary>The integrity rule above, for a session that has not been reviewed (exposed for unit tests).</summary>
    public static ResultIntegrity IntegrityOf(string status, string? severity, bool pendingManualGrading) =>
        IntegrityOf(status, severity, reviewStatus: null, pendingManualGrading);

    /// <summary>
    /// The integrity rule above (exposed for unit tests). <paramref name="reviewStatus"/> null means no session (or a
    /// pre-migration row): the severity alone decides, as for <c>unreviewed</c>.
    /// </summary>
    public static ResultIntegrity IntegrityOf(
        string status, string? severity, string? reviewStatus, bool pendingManualGrading) =>
        string.Equals(status, "completed", StringComparison.Ordinal)
        && !ProctoringHoldsResult(severity, reviewStatus)
        && !pendingManualGrading
            ? ResultIntegrity.Valid
            : ResultIntegrity.NeedsReview;

    private static bool ProctoringHoldsResult(string? severity, string? reviewStatus)
    {
        if (string.Equals(reviewStatus, ReviewClear, StringComparison.Ordinal))
        {
            return false;
        }

        if (reviewStatus is not null && !string.Equals(reviewStatus, Unreviewed, StringComparison.Ordinal))
        {
            // concern, inconclusive, or a value this adapter does not know: fail closed.
            return true;
        }

        return severity is not null && NeedsReviewSeverities.Contains(severity);
    }

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
