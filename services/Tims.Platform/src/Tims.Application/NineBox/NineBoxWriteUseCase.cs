using Tims.Domain.NineBox;

namespace Tims.Application.NineBox;

/// <summary>
/// The nine-box calibration WRITE use case (Phase-5 Slice-15) — faithful ports of the 5 TS <c>ninebox</c> mutation
/// bodies. The mutations are thin (a single INSERT / upsert / DELETE / UPDATE each), so this use case is a straight
/// pass-through to the repository: NO business logic beyond the data step (matching the inline-<c>prisma.*</c> TS
/// router, which has no service layer). The AUTHORIZATION mechanics that are Api concerns —
/// createCalibration/addCalibrationMember/removeCalibrationMember/finalizeCalibration's <c>requireOrgScope</c>, and
/// submitCalibrationVote being membership+identity anchored (voter = caller) — run in the ENDPOINT BEFORE this use
/// case. The session-existence / membership / evaluatedUser / memberIds-in-org checks + the dedup 23505 → Conflict +
/// the delete/update count-0 → NotFound mappings live in the repository (the atomic DB step) and surface here as the
/// outcome/null the endpoint maps to a status code.
/// </summary>
public sealed class NineBoxWriteUseCase(INineBoxWriteRepository repository)
{
    private readonly INineBoxWriteRepository _repository = repository;

    /// <summary>createCalibration: INSERT session + members → Created (full session + members) or MemberNotInOrg (400).</summary>
    public Task<CreateCalibrationResult> CreateCalibrationAsync(
        string organizationId, Guid createdById, CreateCalibrationInput input, DateTimeOffset now,
        CancellationToken cancellationToken) =>
        _repository.CreateCalibrationAsync(organizationId, createdById, input, now, cancellationToken);

    /// <summary>submitCalibrationVote: the a/b/c pre-checks + the atomic upsert (voter = caller) → the full vote row.</summary>
    public Task<SubmitCalibrationVoteResult> SubmitCalibrationVoteAsync(
        string organizationId, Guid voterId, SubmitCalibrationVoteInput input, DateTimeOffset now,
        CancellationToken cancellationToken) =>
        _repository.SubmitCalibrationVoteAsync(organizationId, voterId, input, now, cancellationToken);

    /// <summary>addCalibrationMember: INSERT the member → Created ({id}) / SessionNotFound / UserNotFound / Conflict.</summary>
    public Task<AddCalibrationMemberResult> AddCalibrationMemberAsync(
        string organizationId, Guid sessionId, Guid userId, DateTimeOffset now, CancellationToken cancellationToken) =>
        _repository.AddCalibrationMemberAsync(organizationId, sessionId, userId, now, cancellationToken);

    /// <summary>removeCalibrationMember: DELETE the member → Deleted / SessionNotFound / MemberNotFound.</summary>
    public Task<RemoveCalibrationMemberResult> RemoveCalibrationMemberAsync(
        string organizationId, Guid sessionId, Guid userId, CancellationToken cancellationToken) =>
        _repository.RemoveCalibrationMemberAsync(organizationId, sessionId, userId, cancellationToken);

    /// <summary>finalizeCalibration: UPDATE the session → the full updated row, or null (→ 404 at the endpoint).</summary>
    public Task<CalibrationSessionRow?> FinalizeCalibrationAsync(
        string organizationId, Guid sessionId, DateTimeOffset now, CancellationToken cancellationToken) =>
        _repository.FinalizeCalibrationAsync(organizationId, sessionId, now, cancellationToken);
}
