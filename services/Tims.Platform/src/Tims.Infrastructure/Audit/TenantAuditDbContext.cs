using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Audit;

/// <summary>Tenant-scoped reader, separate from the privileged cross-organization audit context.</summary>
public sealed class TenantAuditDbContext(DbContextOptions<TenantAuditDbContext> options) : DbContext(options)
{
    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    public DbSet<TenantAuditUser> Users => Set<TenantAuditUser>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ConfigureAuditLogs();
        modelBuilder.Entity<TenantAuditUser>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.OrganizationId).HasColumnName("organization_id");
            entity.Property(row => row.FirstName).HasColumnName("first_name");
            entity.Property(row => row.LastName).HasColumnName("last_name");
            entity.Property(row => row.Avatar).HasColumnName("avatar");
            entity.Property(row => row.Email).HasColumnName("email");
        });
    }
}

public sealed class TenantAuditUser
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Avatar { get; set; }
    public string Email { get; set; } = string.Empty;
}
