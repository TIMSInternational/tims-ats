namespace Tims.Infrastructure.Identity;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED `user_roles` join table (User ↔ Role).
/// No expiry column is mapped: staff resolution loads ALL role rows, matching the TS
/// `userRoles: { include: { role: { select: { slug } } } }`.
/// </summary>
public sealed class UserRoleEntity
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public Guid RoleId { get; set; }

    public UserEntity User { get; set; } = null!;

    public RoleEntity Role { get; set; } = null!;
}
