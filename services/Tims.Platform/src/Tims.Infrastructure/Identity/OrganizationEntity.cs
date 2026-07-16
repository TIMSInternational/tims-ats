namespace Tims.Infrastructure.Identity;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED `organizations` table (only the columns the
/// suspended-org lockout needs). Never written by this backend — see <see cref="IdentityDbContext"/>.
/// </summary>
public sealed class OrganizationEntity
{
    public Guid Id { get; set; }

    public bool IsActive { get; set; }

    public DateTime? DeletedAt { get; set; }
}
