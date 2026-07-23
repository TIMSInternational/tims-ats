using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.NineBox;

/// <summary>
/// Write-side models for the Phase-5 Slice-15 nine-box calibration WRITE surface — faithful ports of the
/// inputs/outputs of the 5 mutation bodies of the TS <c>ninebox</c> router (createCalibration /
/// submitCalibrationVote / addCalibrationMember / removeCalibrationMember / finalizeCalibration; all inline
/// <c>prisma.*</c> — there is no TS service/repo). <c>status</c>/<c>quadrant</c> are PLAIN STRINGS in the DB (no
/// native enums), stored verbatim (server-side: <c>'draft'</c> on session create, <c>'invited'</c> on member,
/// <c>'finalized'</c> on finalize). createdAt/updatedAt/scheduledAt/completedAt serialize via
/// <see cref="NodeIsoDateTimeOffsetConverter"/> / <see cref="NodeIsoNullableDateTimeOffsetConverter"/> so the wire
/// is Node <c>Date.toISOString()</c> (<c>…fffZ</c>, NOT STJ <c>+00:00</c>).
///
/// TENANCY (differs from succession): <c>calibration_members</c>/<c>calibration_votes</c> have NO
/// <c>organization_id</c> — tenancy is via the session FK (RLS session-subquery policy). Only the session carries
/// <c>organization_id</c>; the member/vote result rows carry no org column.
/// </summary>

// ── inputs ──────────────────────────────────────────────────────────────────────

/// <summary>
/// The validated createCalibration input (Zod-parity, ninebox.schemas.ts:35-39). <see cref="ScheduledAt"/> is
/// <c>null</c> when absent (Prisma leaves the column NULL). <see cref="MemberIds"/> is EMPTY when absent (no nested
/// insert). Each memberId is validated in-org BEFORE the nested insert (the cross-tenant hardening).
/// </summary>
public sealed record CreateCalibrationInput(
    string Period,
    DateTimeOffset? ScheduledAt,
    IReadOnlyList<Guid> MemberIds);

/// <summary>The validated submitCalibrationVote input (Zod-parity, ninebox.schemas.ts:43-48). <see cref="SessionId"/>
/// is the route param (authoritative); <see cref="Justification"/> is <c>null</c> when absent.</summary>
public sealed record SubmitCalibrationVoteInput(
    Guid SessionId,
    Guid EvaluatedUserId,
    string Quadrant,
    string? Justification);

// ── result rows ─────────────────────────────────────────────────────────────────

/// <summary>A full calibration_members row (TS createCalibration <c>include: { members: true }</c> = full member
/// rows). NO organization_id column (tenancy via the session FK); createdAt only (no updatedAt).</summary>
public sealed record CalibrationMemberResultRow(
    string Id,
    string SessionId,
    string UserId,
    string Status,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt);

/// <summary>
/// The createCalibration return — the full created calibration_sessions row + the full nested member rows (TS
/// <c>include: { members: true }</c>). <see cref="Status"/> is always <c>'draft'</c> on create; <see cref="CompletedAt"/>
/// is always null (never set on create). createdAt/updatedAt are Node-ISO; scheduledAt/completedAt are nullable Node-ISO.
/// </summary>
public sealed record CalibrationSessionWithMembers(
    string Id,
    string OrganizationId,
    string Period,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? ScheduledAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? CompletedAt,
    string CreatedById,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    IReadOnlyList<CalibrationMemberResultRow> Members);

/// <summary>The full calibration_sessions scalar row (finalizeCalibration returns the row with NO Prisma
/// <c>include</c>/<c>select</c>). Byte-identical to <see cref="CalibrationSessionWithMembers"/> minus the members.</summary>
public sealed record CalibrationSessionRow(
    string Id,
    string OrganizationId,
    string Period,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? ScheduledAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))] DateTimeOffset? CompletedAt,
    string CreatedById,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt);

/// <summary>
/// The submitCalibrationVote return — the full upserted calibration_votes row (TS <c>upsert</c> returns the raw row,
/// no nested users). NO organization_id column; createdAt only. On a conflict-UPDATE the EXISTING row's id + createdAt
/// are returned (RETURNING), quadrant/justification are the new values.
/// </summary>
public sealed record CalibrationVoteResultRow(
    string Id,
    string SessionId,
    string EvaluatedUserId,
    string VoterId,
    string Quadrant,
    string? Justification,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt);

/// <summary>The addCalibrationMember return — the narrowed <c>{ id }</c> (TS <c>select: { id: true }</c>).</summary>
public sealed record CalibrationMemberIdResult(string Id);

/// <summary>The removeCalibrationMember return — <c>{ success: true }</c> (TS shape).</summary>
public sealed record CalibrationRemoveResult(bool Success);

// ── outcomes ────────────────────────────────────────────────────────────────────

/// <summary>The outcome of a createCalibration attempt (the memberIds cross-tenant hardening).</summary>
public enum CreateCalibrationOutcome
{
    /// <summary>The session (+ any members) INSERTed → 200, the full session + member rows.</summary>
    Created,

    /// <summary>
    /// A provided <c>memberId</c> is NOT a user in the caller's org (a cross-tenant / nonexistent id) → 400, NO
    /// session/members written (atomic). RLS only guards the SESSION linkage, NOT the member <c>user_id</c>, so an
    /// org-scoped creator could otherwise seed a cross-tenant member — the repository validates every memberId in-org
    /// under TenantScope (RLS-filtered <c>users</c> lookup) BEFORE the nested insert. Fixed in BOTH stacks (ninebox.ts).
    /// </summary>
    MemberNotInOrg,
}

/// <summary>Result of a createCalibration attempt: the outcome + (when Created) the full session + members.</summary>
public sealed record CreateCalibrationResult(CreateCalibrationOutcome Outcome, CalibrationSessionWithMembers? Session);

/// <summary>The outcome of a submitCalibrationVote attempt (membership + identity anchored).</summary>
public enum SubmitCalibrationVoteOutcome
{
    /// <summary>The vote was INSERTed or UPDATEd in place (upsert) → 200, the full vote row.</summary>
    Upserted,

    /// <summary>The session {id, org} does NOT exist → 404 (does not confirm the id to outsiders).</summary>
    SessionNotFound,

    /// <summary>The VOTER (caller, NEVER input) is NOT a <c>calibration_member</c> of the session → 403. An
    /// org-admin/non-member cannot forge or overwrite another member's vote (voter_id is always the caller).</summary>
    NotMember,

    /// <summary>The <c>evaluatedUserId</c> is NOT a user in the caller's org → 404 (a preserved Codex hardening;
    /// deliberately NOT subject-scoped — committee panels calibrate across teams, MEMBERSHIP is the authority).</summary>
    EvaluatedNotFound,
}

/// <summary>Result of a submitCalibrationVote attempt: the outcome + (when Upserted) the full vote row.</summary>
public sealed record SubmitCalibrationVoteResult(SubmitCalibrationVoteOutcome Outcome, CalibrationVoteResultRow? Vote);

/// <summary>The outcome of an addCalibrationMember attempt.</summary>
public enum AddCalibrationMemberOutcome
{
    /// <summary>The member was INSERTed → 200, the <c>{ id }</c>.</summary>
    Created,

    /// <summary>The session {id, org} does NOT exist → 404 "Sesion de calibracion no encontrada".</summary>
    SessionNotFound,

    /// <summary>The <c>userId</c> is NOT a user in the caller's org → 404 "Usuario no encontrado".</summary>
    UserNotFound,

    /// <summary>The <c>@@unique([session_id, user_id])</c> was violated (23505) → 409 "El usuario ya es miembro de
    /// este comite" (FAITHFUL — TS catches P2002 → CONFLICT). No duplicate row (atomic rollback).</summary>
    Conflict,
}

/// <summary>Result of an addCalibrationMember attempt: the outcome + (when Created) the new member id.</summary>
public sealed record AddCalibrationMemberResult(AddCalibrationMemberOutcome Outcome, string? MemberId);

/// <summary>The outcome of a removeCalibrationMember attempt.</summary>
public enum RemoveCalibrationMemberOutcome
{
    /// <summary>The member row was DELETEd → 200, <c>{ success: true }</c>.</summary>
    Deleted,

    /// <summary>The session {id, org} does NOT exist → 404 "Sesion de calibracion no encontrada".</summary>
    SessionNotFound,

    /// <summary>The delete affected 0 rows (no such member) → 404 "Miembro no encontrado".</summary>
    MemberNotFound,
}

/// <summary>Result of a removeCalibrationMember attempt: the outcome (no payload beyond success).</summary>
public sealed record RemoveCalibrationMemberResult(RemoveCalibrationMemberOutcome Outcome);
