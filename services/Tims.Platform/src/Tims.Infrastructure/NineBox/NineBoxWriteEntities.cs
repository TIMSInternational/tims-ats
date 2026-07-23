namespace Tims.Infrastructure.NineBox;

/// <summary>
/// Write-side EF entities for the Phase-5 Slice-15 nine-box calibration WRITE surface. Prisma-OWNED
/// (<c>efcoreStranglerWrite</c>): EF INSERTs a calibration_sessions row + nested calibration_members
/// (createCalibration), INSERTs a calibration_members row (addCalibrationMember), DELETEs calibration_members
/// (removeCalibrationMember), and conditionally UPDATEs calibration_sessions (finalizeCalibration), all UNDER
/// TenantScope/RLS — Prisma keeps the DDL. The calibration_votes upsert is a raw parameterized ON-CONFLICT INSERT
/// (EF has no native upsert), so it needs no tracked vote entity here.
///
/// TENANCY: calibration_members has NO <c>organization_id</c> — the tenant guard is the RLS session-subquery WITH
/// CHECK (EXISTS session WHERE session_id AND org = GUC), NOT an own org column; only the session carries
/// <c>organization_id</c>. Timestamps: the session has createdAt + updatedAt; the member has createdAt ONLY. Prisma
/// DateTime columns are <c>timestamp(3) without time zone</c> (Npgsql Unspecified-kind wall-clock UTC).
/// status/quadrant are plain Strings (NOT native enums), so the write context needs no NpgsqlDataSource.
/// </summary>

/// <summary>calibration_sessions — the createCalibration INSERT row + the finalizeCalibration conditional-update
/// target. The ONLY calibration table carrying <c>organization_id</c> (standard org RLS).</summary>
public sealed class CalibrationSessionWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Period { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime? ScheduledAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>calibration_members — the createCalibration nested INSERT + the addCalibrationMember INSERT +
/// the removeCalibrationMember set-based delete target. NO organization_id (RLS via the session join); createdAt
/// only. The <c>@@unique([session_id, user_id])</c> is enforced by the DB (23505 → CONFLICT at the repository).</summary>
public sealed class CalibrationMemberWriteEntity
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public Guid UserId { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

/// <summary>Only the columns the in-org checks need (id + organization_id): createCalibration's memberIds validation
/// and submitCalibrationVote's evaluatedUser check. Read-only (never written by this surface); organization_id is
/// nullable to match the users table (a platform-owner row can have a null org).</summary>
public sealed class NineBoxUserWriteEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
}
