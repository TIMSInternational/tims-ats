namespace Tims.Infrastructure.Identity;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED `candidates` table (only the columns the portal-candidate
/// resolution needs: id, organization_id, email, is_active, deleted_at). Never written by this
/// backend — see <see cref="IdentityDbContext"/>. Resolving WHICH candidate a portal session is, like
/// staff resolution, is a privileged pre-tenant read.
/// </summary>
public sealed class CandidateEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Email { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public DateTime? DeletedAt { get; set; }
}
