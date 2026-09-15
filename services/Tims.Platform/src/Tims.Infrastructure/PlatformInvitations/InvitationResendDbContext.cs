using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.PlatformInvitations;

/// <summary>
/// Privileged platform-owner mutation, intentionally cross-org like invitation reads. Never use this
/// context from a tenant endpoint. Prisma retains DDL; C# resend stays dark until its dedicated cutover.
/// Separate from read DTOs so mapping the token cannot accidentally widen console list responses.
/// </summary>
public sealed class InvitationResendDbContext(DbContextOptions<InvitationResendDbContext> options) : DbContext(options)
{
    public DbSet<InvitationResendEntity> Invitations => Set<InvitationResendEntity>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<InvitationResendEntity>(entity =>
        {
            entity.ToTable("platform_invitations");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Email).HasColumnName("email");
            entity.Property(row => row.Token).HasColumnName("token");
            entity.Property(row => row.Status).HasColumnName("status");
            entity.Property(row => row.OrganizationId).HasColumnName("organization_id");
            entity.Property(row => row.OrganizationName).HasColumnName("organization_name");
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });
    }
}

public sealed class InvitationResendEntity
{
    public Guid Id { get; set; }
    public string Email { get; set; } = "";
    public string Token { get; set; } = "";
    public string Status { get; set; } = "";
    public Guid? OrganizationId { get; set; }
    public string? OrganizationName { get; set; }
    public DateTime UpdatedAt { get; set; }
}
