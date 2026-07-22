using Tims.Domain.Access;
using Tims.Domain.Evaluation360;

namespace Tims.Application.Evaluation360;

/// <summary>
/// The evaluation360 READ use case — infra-free orchestration, a faithful port of the read methods of the TS
/// <c>evaluation360.service.ts</c>. Staff reads (<see cref="ListCyclesAsync"/>, <see cref="GetCycleProgressAsync"/>)
/// take the org id from the resolved staff principal. Self-service reads (<see cref="MyRaterTasksAsync"/>,
/// <see cref="MyReportAsync"/>, <see cref="MyReportCyclesAsync"/>) take BOTH the org id and the caller's user id
/// from the resolved principal — the caller is ALWAYS the rater/subject (there is no id parameter).
///
/// <see cref="MyReportAsync"/> reuses the SHARED pure kernel <see cref="Eval360Aggregate.Aggregate360Report"/>
/// (min-3 suppress-by-omission), gated BEFORE aggregating: the cycle must be published AND the caller must be a
/// subject — else it returns <c>null</c> (the endpoint maps that to NOT_FOUND with the SAME message for both
/// gates, so "not published" is indistinguishable from "not yours").
/// </summary>
public sealed class Evaluation360ReadUseCase(IEvaluation360ReadRepository repository)
{
    // The fixed progress relationship order the TS service emits (self, manager, peer, direct_report), always all four.
    private static readonly IReadOnlyList<string> ProgressRelationships =
        new[] { "self", "manager", "peer", "direct_report" };

    private const string SubmittedStatus = "submitted";

    private readonly IEvaluation360ReadRepository _repository = repository;

    public async Task<IReadOnlyList<CycleSummaryV1>> ListCyclesAsync(string organizationId, CancellationToken cancellationToken)
    {
        var rows = await _repository.ListCyclesAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return rows
            .Select(r => new CycleSummaryV1(r.Id, r.Name, r.Status, r.OpensAt, r.ClosesAt, r.PublishedAt, r.CreatedAt))
            .ToList();
    }

    /// <summary>Returns the per-relationship progress, or <c>null</c> when the cycle does not exist in the org
    /// (the endpoint maps <c>null</c> to NOT_FOUND, matching the TS <c>'Ciclo no encontrado'</c>).</summary>
    public async Task<CycleProgressView?> GetCycleProgressAsync(
        string organizationId, string cycleId, string callerUserId, CancellationToken cancellationToken)
    {
        var cycle = await _repository.GetCycleForOrgAsync(organizationId, cycleId, cancellationToken).ConfigureAwait(false);
        if (cycle is null)
        {
            return null;
        }

        var counts = await _repository
            .GetProgressCountsAsync(organizationId, cycleId, callerUserId, cancellationToken)
            .ConfigureAwait(false);

        var progress = ProgressRelationships
            .Select(relationship =>
            {
                var forRelationship = counts.Where(c => c.Relationship == relationship).ToList();
                var total = forRelationship.Sum(c => c.Count);
                var submitted = forRelationship.Where(c => c.Status == SubmittedStatus).Sum(c => c.Count);
                return new CycleProgressRow(relationship, total, submitted);
            })
            .ToList();

        return new CycleProgressView(cycleId, progress);
    }

    public async Task<IReadOnlyList<RaterTaskV1>> MyRaterTasksAsync(
        string organizationId, string raterUserId, CancellationToken cancellationToken)
    {
        var rows = await _repository.FindRaterTasksAsync(organizationId, raterUserId, cancellationToken).ConfigureAwait(false);
        return rows
            .Select(r => new RaterTaskV1(
                r.AssignmentId,
                r.CycleId,
                r.CycleName,
                r.Relationship,
                new RaterTaskSubject(r.SubjectFirstName, r.SubjectLastName),
                Eval360Competencies.All))
            .ToList();
    }

    /// <summary>Returns the anonymized report, or <c>null</c> when the cycle is not published OR the caller is
    /// not a subject (the endpoint maps BOTH to the SAME NOT_FOUND — never revealing which gate failed).</summary>
    public async Task<MyReportView?> MyReportAsync(
        string organizationId, string subjectUserId, string cycleId, CancellationToken cancellationToken)
    {
        var cycle = await _repository.FindPublishedCycleAsync(organizationId, cycleId, cancellationToken).ConfigureAwait(false);
        if (cycle is null)
        {
            return null;
        }

        var isSubject = await _repository
            .SubjectHasAssignmentInCycleAsync(organizationId, cycleId, subjectUserId, cancellationToken)
            .ConfigureAwait(false);
        if (!isSubject)
        {
            return null;
        }

        var rows = await _repository
            .FindReportRowsAsync(organizationId, cycleId, subjectUserId, cancellationToken)
            .ConfigureAwait(false);
        var buckets = Eval360Aggregate.Aggregate360Report(rows);

        return new MyReportView(cycleId, cycle.Name, buckets);
    }

    public async Task<IReadOnlyList<ReportCycleV1>> MyReportCyclesAsync(
        string organizationId, string subjectUserId, CancellationToken cancellationToken)
    {
        var cycles = await _repository
            .FindPublishedCyclesForSubjectAsync(organizationId, subjectUserId, cancellationToken)
            .ConfigureAwait(false);
        return cycles.Select(c => new ReportCycleV1(c.Id, c.Name, c.PublishedAt)).ToList();
    }
}
