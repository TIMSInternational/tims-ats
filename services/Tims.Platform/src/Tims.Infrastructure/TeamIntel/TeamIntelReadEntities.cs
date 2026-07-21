namespace Tims.Infrastructure.TeamIntel;

/// <summary>
/// Minimal read-only EF entities for the team-intel READ surface. Only the columns the seven reads touch
/// are mapped (never full HR rows). All are Prisma-OWNED (efcoreReadOnly); EF SELECTs only (AsNoTracking,
/// SaveChanges never called). Timestamps are the Prisma <c>timestamp(3) without time zone</c> columns
/// (Npgsql Unspecified-kind wall-clock UTC), carried to epoch-ms client-side for the kernels.
/// </summary>
public sealed class TeamReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid BusinessUnitId { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid? LeaderId { get; set; }

    /// <summary>Raw jsonb settings text (object); passed through unchanged on the profile read.</summary>
    public string Settings { get; set; } = "{}";
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class UserTeamReadEntity
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid TeamId { get; set; }
    public string Role { get; set; } = string.Empty;
    public DateTime JoinedAt { get; set; }
}

public sealed class TeamIntelUserReadEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Avatar { get; set; }
    public string? JobTitle { get; set; }
    public string Email { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public bool IsActive { get; set; }
}

public sealed class TeamBusinessUnitReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid CompanyId { get; set; }
    public bool IsActive { get; set; }
}

/// <summary>Minimal vacancy row — only id/org/team for the per-team <c>_count.vacancies</c>.</summary>
public sealed class TeamVacancyReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? TeamId { get; set; }
}

/// <summary>Minimal okr row — only id/org/team for the per-team <c>_count.okrs</c>.</summary>
public sealed class TeamOkrReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? TeamId { get; set; }
}
