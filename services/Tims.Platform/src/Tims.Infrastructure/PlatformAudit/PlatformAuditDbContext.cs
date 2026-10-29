using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.PlatformAudit;

/// <summary>
/// The dedicated EF context that OWNS the DDL of <c>platform_audit_events</c> (WP-03 PR-5a, migration
/// <c>*_platform_audit_events</c>) and is the only context that maps it. Like <c>FxRateDbContext</c> it is a
/// GLOBAL context: the table has no tenant, so it runs on the plain owner connection with no
/// <see cref="TenantScope"/>. This PR ships the schema only; no runtime registration or writer exists yet.
/// </summary>
public sealed class PlatformAuditDbContext(DbContextOptions<PlatformAuditDbContext> options) : DbContext(options)
{
    public DbSet<PlatformAuditEventEntity> PlatformAuditEvents => Set<PlatformAuditEventEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PlatformAuditEventEntity>(entity =>
        {
            entity.ToTable("platform_audit_events");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();
            entity.Property(e => e.ActorId).HasColumnName("actor_id");
            entity.Property(e => e.Action).HasColumnName("action").HasColumnType("text");
            entity.Property(e => e.Entity).HasColumnName("entity").HasColumnType("text");
            entity.Property(e => e.EntityId).HasColumnName("entity_id").HasColumnType("text");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.Changes).HasColumnName("changes").HasColumnType("jsonb");
            entity.Property(e => e.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
            entity.Property(e => e.IpAddress).HasColumnName("ip_address").HasColumnType("text");
            entity.Property(e => e.UserAgent).HasColumnName("user_agent").HasColumnType("text");
            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasColumnType("timestamp with time zone")
                .HasDefaultValueSql("now()");
            entity.HasIndex(e => e.CreatedAt)
                .HasDatabaseName("ix_platform_audit_events_created_at")
                .IsDescending();
            entity.HasIndex(e => new { e.Action, e.CreatedAt })
                .HasDatabaseName("ix_platform_audit_events_action_created_at")
                .IsDescending(false, true);
        });
    }
}
