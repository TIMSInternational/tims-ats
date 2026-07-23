using Tims.Domain.Evaluation360;

namespace Tims.Application.Evaluation360;

/// <summary>
/// Write port for the Phase-5 Slice 13 evaluation360 WRITE surface — a faithful port of the write methods of the TS
/// <c>evaluation360.repository.ts</c>. Every method, in the infrastructure implementation, runs UNDER
/// <c>TenantScope</c> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter
/// (defense-in-depth). This is an <c>efcoreStranglerWrite</c> coexistence writer on <c>review_cycles</c> +
/// <c>rater_assignments</c> + <c>rater_responses</c> — Prisma keeps the DDL and TS stays the sole ACTIVE writer until
/// cutover.
///
/// <see cref="AssignmentBelongsToRaterAsync"/> + <see cref="SubmitRatingsAsync"/> are IDENTITY-anchored: both
/// HARD-FILTER on <c>raterUserId</c> (= the caller) in ADDITION to <c>organizationId</c> — never scope narrowing. An
/// org-scoped admin can therefore never claim/submit on another rater's assignment (the pre-fetch/claim match 0).
/// </summary>
public interface IEvaluation360WriteRepository
{
    /// <summary>createCycle: INSERT a draft review_cycles row (createdById = caller, status = 'draft'); returns the
    /// repo select { id, name, status, createdAt }.</summary>
    Task<CreateCycleResult> CreateCycleAsync(
        string organizationId, Guid createdById, string name, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>openCycle: guarded transition draft→open (updateMany {id, org, status:'draft'} set status='open',
    /// opensAt=now). Returns true iff a row transitioned (count &gt; 0); false ⇒ CONFLICT at the caller.</summary>
    Task<bool> OpenCycleAsync(string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>closeCycle: guarded transition open→closed (set status='closed', closesAt=now). false ⇒ CONFLICT.</summary>
    Task<bool> CloseCycleAsync(string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>publishCycle: guarded transition closed→published (set status='published', publishedAt=now). false ⇒ CONFLICT.</summary>
    Task<bool> PublishCycleAsync(string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// assignRaters: in ONE transaction — re-check the cycle status ∈ <paramref name="expectedStatuses"/> (INSIDE the
    /// tx, TOCTOU-safe vs a concurrent closeCycle), validate every distinct subject/rater id is a users row in the
    /// org, then createMany the assignments (skipDuplicates on [cycleId, subjectUserId, raterUserId]). Returns
    /// <see cref="AssignRatersDbResult"/> (never throws for the two business gates — the use case maps them).
    /// </summary>
    Task<AssignRatersDbResult> AssignRatersAsync(
        string organizationId,
        Guid cycleId,
        IReadOnlyList<RaterAssignmentInput> assignments,
        IReadOnlyList<string> expectedStatuses,
        DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>submitRatings ownership pre-fetch: does an assignment { id, org, raterUserId = caller } exist? A
    /// mismatch on id, org OR raterUserId ⇒ false ⇒ NOT_FOUND (indistinguishable — never leaks which). IDENTITY-anchored.</summary>
    Task<bool> AssignmentBelongsToRaterAsync(
        string organizationId, Guid raterUserId, Guid assignmentId, CancellationToken cancellationToken);

    /// <summary>
    /// submitRatings claim + insert (ONE transaction): the guarded claim (updateMany {id, org, raterUserId, status:
    /// 'pending', cycle open} set status='submitted', submittedAt=now) THEN, only if it claimed, INSERT the 6
    /// rater_responses — commit/roll-back together. Returns true iff claimed; false ⇒ CONFLICT at the caller.
    /// </summary>
    Task<bool> SubmitRatingsAsync(
        string organizationId,
        Guid raterUserId,
        Guid assignmentId,
        IReadOnlyList<RatingSubmissionInput> ratings,
        DateTimeOffset now,
        CancellationToken cancellationToken);
}
