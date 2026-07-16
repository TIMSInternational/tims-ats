namespace Tims.Infrastructure.Identity;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED `roles` table. Only <see cref="Slug"/> is needed
/// for staff resolution (fed raw into <c>StaffContextResolver</c>, which filters it).
/// </summary>
public sealed class RoleEntity
{
    public Guid Id { get; set; }

    public string Slug { get; set; } = string.Empty;
}
