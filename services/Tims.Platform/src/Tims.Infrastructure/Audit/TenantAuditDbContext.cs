using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Audit;

/// <summary>Tenant-scoped reader, separate from the privileged cross-organization audit context.</summary>
public sealed class TenantAuditDbContext(DbContextOptions<TenantAuditDbContext> options) : DbContext(options)
{
    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) => modelBuilder.ConfigureAuditLogs();
}
