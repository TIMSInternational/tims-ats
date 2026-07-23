using Tims.Domain.Evaluation360;

namespace Tims.Application.Evaluation360;

/// <summary>
/// The evaluation360 WRITE use case — infra-free orchestration, a faithful port of the write methods of the TS
/// <c>evaluation360.service.ts</c>. Each transition maps the repo's <c>count === 0</c> to a CONFLICT-signalling
/// result (the endpoint returns 409); assignRaters maps the repo's cycleNotOpen/missingUserIds to
/// <see cref="AssignRatersOutcome"/>; submitRatings runs the ownership pre-fetch (null ⇒ NotFound) BEFORE the atomic
/// claim (claimed=false ⇒ Conflict). The <c>raterUserId</c> passed to the self-service methods is ALWAYS the resolved
/// caller (the endpoint never accepts a caller-supplied rater id).
/// </summary>
public sealed class Evaluation360WriteUseCase(IEvaluation360WriteRepository repository)
{
    // The TS service always passes ['draft', 'open'] as assignRaters' expected statuses (both allowed — the cycle
    // must be in draft or open to assign raters; closed/published → cycleNotOpen).
    private static readonly IReadOnlyList<string> AssignExpectedStatuses = new[] { "draft", "open" };

    private const string OpenStatus = "open";
    private const string ClosedStatus = "closed";
    private const string PublishedStatus = "published";

    private readonly IEvaluation360WriteRepository _repository = repository;

    public Task<CreateCycleResult> CreateCycleAsync(
        string organizationId, Guid createdById, string name, DateTimeOffset now, CancellationToken cancellationToken) =>
        _repository.CreateCycleAsync(organizationId, createdById, name, now, cancellationToken);

    public async Task<CycleTransitionResult> OpenCycleAsync(
        string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var transitioned = await _repository.OpenCycleAsync(organizationId, cycleId, now, cancellationToken).ConfigureAwait(false);
        return new CycleTransitionResult(transitioned, OpenStatus);
    }

    public async Task<CycleTransitionResult> CloseCycleAsync(
        string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var transitioned = await _repository.CloseCycleAsync(organizationId, cycleId, now, cancellationToken).ConfigureAwait(false);
        return new CycleTransitionResult(transitioned, ClosedStatus);
    }

    public async Task<CycleTransitionResult> PublishCycleAsync(
        string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var transitioned = await _repository.PublishCycleAsync(organizationId, cycleId, now, cancellationToken).ConfigureAwait(false);
        return new CycleTransitionResult(transitioned, PublishedStatus);
    }

    /// <summary>
    /// assignRaters: the repo does the status re-check + org-membership validation + createMany in ONE transaction;
    /// this maps cycleNotOpen → <see cref="AssignRatersOutcome.CycleNotOpen"/> (409) and any missingUserIds →
    /// <see cref="AssignRatersOutcome.MissingUsers"/> (400), else the created count.
    /// </summary>
    public async Task<AssignRatersResult> AssignRatersAsync(
        string organizationId,
        Guid cycleId,
        IReadOnlyList<RaterAssignmentInput> assignments,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var result = await _repository
            .AssignRatersAsync(organizationId, cycleId, assignments, AssignExpectedStatuses, now, cancellationToken)
            .ConfigureAwait(false);

        if (result.CycleNotOpen)
        {
            return new AssignRatersResult(AssignRatersOutcome.CycleNotOpen, 0);
        }

        if (result.MissingUserIds.Count > 0)
        {
            return new AssignRatersResult(AssignRatersOutcome.MissingUsers, 0);
        }

        return new AssignRatersResult(AssignRatersOutcome.Created, result.Created);
    }

    /// <summary>
    /// submitRatings: the ownership pre-fetch is anchored on (id, org, raterUserId = caller) so a mismatch on ANY of
    /// the three is indistinguishable — NotFound either way (never leaking which condition failed). Only then does the
    /// atomic claim + response insert run (claimed=false ⇒ Conflict). IDENTITY-anchored: <paramref name="raterUserId"/>
    /// is ALWAYS the caller.
    /// </summary>
    public async Task<SubmitRatingsResult> SubmitRatingsAsync(
        string organizationId,
        Guid raterUserId,
        Guid assignmentId,
        IReadOnlyList<RatingSubmissionInput> ratings,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var belongs = await _repository
            .AssignmentBelongsToRaterAsync(organizationId, raterUserId, assignmentId, cancellationToken)
            .ConfigureAwait(false);
        if (!belongs)
        {
            return new SubmitRatingsResult(SubmitRatingsOutcome.NotFound);
        }

        var claimed = await _repository
            .SubmitRatingsAsync(organizationId, raterUserId, assignmentId, ratings, now, cancellationToken)
            .ConfigureAwait(false);
        return new SubmitRatingsResult(claimed ? SubmitRatingsOutcome.Submitted : SubmitRatingsOutcome.Conflict);
    }
}
