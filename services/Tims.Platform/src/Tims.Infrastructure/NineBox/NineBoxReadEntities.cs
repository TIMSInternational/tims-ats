namespace Tims.Infrastructure.NineBox;

/// <summary>
/// Minimal read-only EF entities for the nine-box READ surface. Only the columns the 11 reads touch are
/// mapped (never full HR rows). All are Prisma-OWNED (efcoreReadOnly); EF SELECTs only (AsNoTracking,
/// SaveChanges never called). No native enums here (quadrant / calibration status are plain Strings), so the
/// context needs no NpgsqlDataSource with EnableUnmappedTypes. Prisma <c>timestamp(3)</c> columns are read as
/// Unspecified-kind wall-clock UTC and re-kinded to UTC in the repository. <c>axis_breakdown</c> is a jsonb
/// column read as its raw JSON text (mapped as string, parsed to a JsonNode passthrough in the repository).
/// </summary>
public sealed class NineBoxEvaluationReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public string Period { get; set; } = string.Empty;
    public double PotentialScore { get; set; }
    public double PerformanceScore { get; set; }
    public string Quadrant { get; set; } = string.Empty;
    public double Confidence { get; set; }
    public string AxisBreakdown { get; set; } = "null";
    public DateTime EvaluatedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>users columns the grid/detail/creator/member/voter selects need.</summary>
public sealed class NineBoxUserReadEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Avatar { get; set; }
    public string? JobTitle { get; set; }
    public string Email { get; set; } = string.Empty;
    public Guid? CompanyId { get; set; }
}

/// <summary>user_teams — the getGrid teamId/unitId → userId intersect filter (no organization_id column;
/// RLS'd through its teams join, like the succession read fixture).</summary>
public sealed class NineBoxUserTeamReadEntity
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid TeamId { get; set; }
}

/// <summary>teams — only business_unit_id for the getGrid unitId → team → userId intersect filter.</summary>
public sealed class NineBoxTeamReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid BusinessUnitId { get; set; }
}

/// <summary>calibration_sessions — the calibration reads (#6/#7/#8/#11).</summary>
public sealed class CalibrationSessionReadEntity
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

/// <summary>calibration_members — the session committee (#6/#7/#8 counts + #7 include).</summary>
public sealed class CalibrationMemberReadEntity
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public Guid UserId { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

/// <summary>calibration_votes — the session votes (#7 include + #8 count).</summary>
public sealed class CalibrationVoteReadEntity
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public Guid EvaluatedUserId { get; set; }
    public Guid VoterId { get; set; }
    public string Quadrant { get; set; } = string.Empty;
    public string? Justification { get; set; }
    public DateTime CreatedAt { get; set; }
}
