namespace Tims.Infrastructure.Identity;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED `roles` table. <see cref="Slug"/> drives staff
/// resolution (fed raw into <c>StaffContextResolver</c>, which filters it); <see cref="OrganizationId"/>
/// scopes the grant fetch (permission check) to the caller's org — a role only grants within its
/// own organization (rbac.prisma: <c>organizationId</c> is NOT NULL, so a plain Guid is correct).
/// </summary>
public sealed class RoleEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Slug { get; set; } = string.Empty;
}
