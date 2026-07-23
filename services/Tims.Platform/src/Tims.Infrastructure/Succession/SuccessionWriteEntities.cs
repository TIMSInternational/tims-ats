namespace Tims.Infrastructure.Succession;

/// <summary>
/// Write-side EF entities for the Phase-5 Slice-14 succession WRITE surface. Prisma-OWNED
/// (<c>efcoreStranglerWrite</c>): EF INSERTs a critical_roles row (addCriticalRole) + a successors row
/// (addSuccessor), DELETEs a successors row (removeSuccessor), and UPDATEs successors (updateSuccessorReadiness) +
/// critical_roles (updateCriticalRoleBand), all UNDER TenantScope/RLS — Prisma keeps the DDL.
/// <c>criticality</c>/<c>readiness</c>/<c>type</c> are plain Strings (NOT native enums), so the write context needs
/// no NpgsqlDataSource. Prisma DateTime columns are <c>timestamp(3) without time zone</c> (Npgsql Unspecified-kind
/// wall-clock UTC). critical_roles has NO deleted_at (hard delete on successors only).
/// </summary>

/// <summary>critical_roles — the addCriticalRole INSERT row + the updateCriticalRoleBand conditional-update target.</summary>
public sealed class CriticalRoleWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? PositionId { get; set; }
    public Guid? CurrentHolderId { get; set; }
    public Guid? CompanyId { get; set; }
    public Guid? UnitId { get; set; }
    public string Criticality { get; set; } = string.Empty;
    public double? FlightRisk { get; set; }
    public string? TargetBandLevel { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>successors — the addSuccessor INSERT row + the remove/updateReadiness target. The
/// <c>@@unique([criticalRoleId, userId])</c> is enforced by the DB (23505 → CONFLICT at the repository).</summary>
public sealed class SuccessorWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid CriticalRoleId { get; set; }
    public Guid UserId { get; set; }
    public string Readiness { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string? DevelopmentPlan { get; set; }
    public Guid? AddedById { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Only the columns the addSuccessor nested <c>user</c> projection needs (id/firstName/lastName/avatar +
/// organizationId for the explicit org filter). Read-only (never written by this surface). Also the authoritative
/// org-membership check for addSuccessor's target userId + addCriticalRole's currentHolderId (Codex H1/H2).</summary>
public sealed class SuccessionUserWriteEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Avatar { get; set; }
}

/// <summary>companies id + organizationId — read-only, ONLY the org-membership existence check for
/// addCriticalRole's optional <c>companyId</c> (Codex H2: reject a cross-org company reference). Under TenantScope,
/// RLS already filters to the caller's org; the explicit filter is defense-in-depth.</summary>
public sealed class SuccessionCompanyWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
}

/// <summary>business_units id + organizationId — read-only, ONLY the org-membership existence check for
/// addCriticalRole's optional <c>unitId</c> (Codex H2: reject a cross-org business-unit reference).</summary>
public sealed class SuccessionBusinessUnitWriteEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
}
