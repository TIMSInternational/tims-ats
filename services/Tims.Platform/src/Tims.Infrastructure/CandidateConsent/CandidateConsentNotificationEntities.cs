namespace Tims.Infrastructure.CandidateConsent;

/// <summary>
/// <c>notifications</c> — INSERT only, the columns a data-subject-request alert sets. <c>read</c>, <c>read_at</c>,
/// <c>archived</c> and <c>created_at</c> are deliberately UNMAPPED so their column defaults (false / NULL / false /
/// CURRENT_TIMESTAMP) apply. The full mapping lives in <c>NotificationDbContext</c>.
/// </summary>
public sealed class ConsentNotificationEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid UserId { get; set; }

    public string Type { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string? Message { get; set; }

    public string? Module { get; set; }

    public string? EntityType { get; set; }

    public Guid? EntityId { get; set; }

    public string? ActionUrl { get; set; }
}

/// <summary><c>users</c> — read only: who may be told about a new data subject request.</summary>
public sealed class ConsentUserEntity
{
    public Guid Id { get; set; }

    public Guid? OrganizationId { get; set; }

    public string Email { get; set; } = string.Empty;

    public string FirstName { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public DateTime? DeletedAt { get; set; }
}

/// <summary><c>roles</c> — read only.</summary>
public sealed class ConsentRoleEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Slug { get; set; } = string.Empty;

    public bool IsActive { get; set; }
}

/// <summary><c>user_roles</c> — read only (a user may hold several roles).</summary>
public sealed class ConsentUserRoleEntity
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public Guid RoleId { get; set; }
}
