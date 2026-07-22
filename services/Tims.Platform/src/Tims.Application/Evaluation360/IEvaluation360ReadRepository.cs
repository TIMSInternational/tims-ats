using Tims.Domain.Access;

namespace Tims.Application.Evaluation360;

/// <summary>
/// Read port for the evaluation360 surface — a faithful port of
/// <c>packages/api/src/repositories/evaluation360.repository.ts</c> (read methods only; the six writes are NOT
/// ported in this slice). Every method, in the infrastructure implementation, runs <c>AsNoTracking</c> UNDER
/// <c>TenantScope</c> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter
/// (defense-in-depth).
///
/// The self-service methods (<see cref="FindRaterTasksAsync"/>, <see cref="SubjectHasAssignmentInCycleAsync"/>,
/// <see cref="FindReportRowsAsync"/>, <see cref="FindPublishedCyclesForSubjectAsync"/>) additionally HARD-FILTER
/// on the resolved caller's user id — <c>raterUserId</c> for tasks, <c>subjectUserId</c> for the report/report
/// cycles — NOT via scope narrowing. There is NO caller-supplied rater/subject id: it is ALWAYS the resolved
/// principal, so an org-scoped admin can never read on another user's behalf. <see cref="FindReportRowsAsync"/>
/// NEVER selects a rater's user id (anonymity for peer/direct_report depends on it).
/// </summary>
public interface IEvaluation360ReadRepository
{
    /// <summary>listCycles: the org's review cycles, newest first (raw select, no scope narrowing — staff org-gate).</summary>
    Task<IReadOnlyList<CycleRow>> ListCyclesAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>getCycleProgress step 1: existence + status of a cycle in the org (NOT_FOUND gate).</summary>
    Task<CycleStatusRow?> GetCycleForOrgAsync(string organizationId, string cycleId, CancellationToken cancellationToken);

    /// <summary>getCycleProgress step 2: per-(relationship, status) assignment counts, EXCLUDING the caller's own
    /// subject-assignments (an admin who is also a subject must not difference their own suppressed bucket size).</summary>
    Task<IReadOnlyList<ProgressCountRow>> GetProgressCountsAsync(
        string organizationId, string cycleId, string excludeSubjectUserId, CancellationToken cancellationToken);

    /// <summary>myRaterTasks: the caller's PENDING assignments in OPEN cycles (hard-filtered on raterUserId), newest cycle first.</summary>
    Task<IReadOnlyList<RaterTaskRow>> FindRaterTasksAsync(
        string organizationId, string raterUserId, CancellationToken cancellationToken);

    /// <summary>myReport gate 1: the cycle must be PUBLISHED in the org (else NOT_FOUND).</summary>
    Task<PublishedCycleRow?> FindPublishedCycleAsync(string organizationId, string cycleId, CancellationToken cancellationToken);

    /// <summary>myReport gate 2: the caller must be a SUBJECT of at least one assignment in the cycle (else NOT_FOUND).</summary>
    Task<bool> SubjectHasAssignmentInCycleAsync(
        string organizationId, string cycleId, string subjectUserId, CancellationToken cancellationToken);

    /// <summary>myReport aggregator input: every SUBMITTED response for this subject in this cycle, flattened with
    /// the assignment's relationship. NEVER includes a rater's user id (carries only assignmentId).</summary>
    Task<IReadOnlyList<Eval360Aggregate.AggregateInputRow>> FindReportRowsAsync(
        string organizationId, string cycleId, string subjectUserId, CancellationToken cancellationToken);

    /// <summary>myReportCycles: every PUBLISHED cycle the caller is a subject of, newest published first.</summary>
    Task<IReadOnlyList<ReportCycleRow>> FindPublishedCyclesForSubjectAsync(
        string organizationId, string subjectUserId, CancellationToken cancellationToken);
}
