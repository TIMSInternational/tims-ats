namespace Tims.Infrastructure.Identity;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED `users` table (only the columns the identity
/// resolution needs). Never written by this backend — see <see cref="IdentityDbContext"/>.
/// </summary>
public sealed class UserEntity
{
    public Guid Id { get; set; }

    public Guid? OrganizationId { get; set; }

    public string SupabaseUserId { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public bool IsPlatformOwner { get; set; }

    public bool IsActive { get; set; }

    public ICollection<UserRoleEntity> UserRoles { get; set; } = new List<UserRoleEntity>();
}
