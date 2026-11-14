namespace Tims.Application.FitEngine;

/// <summary>
/// Owner default D5 (2026-11-08): a native ATS quiz with an essay awaiting manual grading is needs review in FIT v2
/// until a recruiter grades it. This is the minimal grading store: list the essays still pending on one assignment,
/// and grade one of them atomically. Under TenantScope with explicit organization filters.
/// </summary>
public interface IEssayGradingRepository
{
    /// <summary>The assignment's vacancy (for the caller's scope probe), or null when it is not in this organization.</summary>
    Task<Guid?> GetAssignmentVacancyAsync(Guid organizationId, Guid assignmentId, CancellationToken cancellationToken);

    /// <summary>
    /// The essays still listed in the result's <c>breakdown.pendingManual</c>, in question order; none for a candidate whose
    /// recruitment consent is withdrawn (#312: their answers are not shown for grading).
    /// </summary>
    Task<IReadOnlyList<PendingEssay>> GetPendingEssaysAsync(
        Guid organizationId, Guid assignmentId, CancellationToken cancellationToken);

    /// <summary>
    /// Grades one pending essay in ONE transaction that locks the result row (<c>SELECT … FOR UPDATE</c>): checks the
    /// question is still pending and the points are within 0..its points, writes the response's points, removes the
    /// question from <c>pendingManual</c>, records who graded it, and recomputes <c>raw_score</c> /
    /// <c>normalized_score</c> over every scored response (the TS <c>computeResult</c> rule). Two graders of the same
    /// essay serialize on the lock; the second sees it is no longer pending.
    /// </summary>
    Task<EssayGradeOutcome> GradeEssayAsync(
        Guid organizationId, Guid assignmentId, Guid questionId, double points, Guid gradedBy, DateTimeOffset now,
        CancellationToken cancellationToken);
}

/// <summary>One essay awaiting a grade: the prompt, the candidate's answer and the most points it can get.</summary>
public sealed record PendingEssay(string QuestionId, string Prompt, string Answer, double MaxPoints);

/// <summary>What a grade attempt did.</summary>
public enum EssayGradeStatus
{
    Graded,
    NotFound,
    NotPending,
    PointsOutOfRange,

    /// <summary>An awarded score exceeds its question's current points (edited after submission): not graded.</summary>
    QuestionsChanged,

    /// <summary>
    /// The candidate's recruitment consent is withdrawn (#312): nothing is graded, and no score or norm is produced.
    /// Checked under the withdrawal's candidate lock, so a withdrawal committing concurrently is seen.
    /// </summary>
    ConsentWithdrawn,
}

/// <summary>The outcome, and after a grade the essays still pending and the new normalized score.</summary>
public sealed record EssayGradeOutcome(EssayGradeStatus Status, int RemainingPending, double? NormalizedScore);
