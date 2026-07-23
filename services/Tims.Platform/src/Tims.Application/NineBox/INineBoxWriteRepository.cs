using Tims.Domain.NineBox;

namespace Tims.Application.NineBox;

/// <summary>
/// Write port for the Phase-5 Slice-15 nine-box calibration WRITE surface — a faithful port of the data steps of the
/// 5 TS <c>ninebox</c> mutations (createCalibration / submitCalibrationVote / addCalibrationMember /
/// removeCalibrationMember / finalizeCalibration). Every method runs UNDER <c>TenantScope</c> (SET LOCAL ROLE
/// app_tenant + org GUC → RLS). This is an <c>efcoreStranglerWrite</c> coexistence writer on
/// <c>calibration_sessions</c> + <c>calibration_members</c> + <c>calibration_votes</c> — Prisma keeps the DDL and TS
/// stays the sole ACTIVE writer until the deploy-gated cutover.
///
/// TENANCY: calibration_members/votes have NO organization_id — the tenant guard is the RLS session-subquery WITH
/// CHECK (EXISTS session WHERE session_id AND org = GUC), not an own org column. The session existence checks + the
/// createCalibration memberIds validation + the vote evaluatedUser check all run under the SAME TenantScope (their
/// <c>users</c>/<c>calibration_sessions</c> lookups are RLS-filtered to the caller's org).
/// </summary>
public interface INineBoxWriteRepository
{
    /// <summary>createCalibration: validate each memberId in-org (→ <see cref="CreateCalibrationOutcome.MemberNotInOrg"/>
    /// on a cross-org/nonexistent id, nothing written) then INSERT the session (status='draft', createdById=caller) +
    /// a nested member (status='invited') per memberId in ONE tx; returns the full session + full member rows.</summary>
    Task<CreateCalibrationResult> CreateCalibrationAsync(
        string organizationId, Guid createdById, CreateCalibrationInput input, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>submitCalibrationVote: (a) session {id, org} exists → else SessionNotFound; (b) the caller is a
    /// calibration_member → else NotMember; (c) evaluatedUser in-org → else EvaluatedNotFound; then the atomic raw
    /// ON-CONFLICT upsert (voter_id = caller, never input) → the full upserted vote row. All in ONE TenantScope tx.</summary>
    Task<SubmitCalibrationVoteResult> SubmitCalibrationVoteAsync(
        string organizationId, Guid voterId, SubmitCalibrationVoteInput input, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>addCalibrationMember: session {id, org} exists → else SessionNotFound; userId in-org → else
    /// UserNotFound; INSERT the member (status='invited'). The <c>@@unique([session_id, user_id])</c> violation
    /// (23505) → <see cref="AddCalibrationMemberOutcome.Conflict"/> (atomic, no duplicate). Returns the <c>{ id }</c>.</summary>
    Task<AddCalibrationMemberResult> AddCalibrationMemberAsync(
        string organizationId, Guid sessionId, Guid userId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>removeCalibrationMember: session {id, org} exists → else SessionNotFound; then the atomic set-based
    /// <c>ExecuteDeleteAsync</c> WHERE session_id + user_id; affected 0 → <see cref="RemoveCalibrationMemberOutcome.MemberNotFound"/>.</summary>
    Task<RemoveCalibrationMemberResult> RemoveCalibrationMemberAsync(
        string organizationId, Guid sessionId, Guid userId, CancellationToken cancellationToken);

    /// <summary>finalizeCalibration: the UNCONDITIONAL (no state-machine guard) conditional <c>ExecuteUpdateAsync</c>
    /// WHERE {id, org} SET status='finalized', completed_at=now, updated_at=now; count 0 → null (→ 404 at the caller,
    /// a documented improvement over the TS update→P2025→500). Returns the full updated session row.</summary>
    Task<CalibrationSessionRow?> FinalizeCalibrationAsync(
        string organizationId, Guid sessionId, DateTimeOffset now, CancellationToken cancellationToken);
}
