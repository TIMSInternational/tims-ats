using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.PlatformOrganizations;

/// <summary>
/// The write context for the platform-owner organizations surface (Phase-5 slice 20, issue #76).
///
/// <para><b>It maps <c>organizations</c> AND <c>audit_logs</c> for one specific reason.</b> Federico's
/// decision on #76 is that the C# audit write ships FAIL-CLOSED, diverging from the TS
/// <c>.catch(() =&gt; {})</c>. A fail-closed audit only means something if the audit INSERT and the org
/// UPDATE commit or roll back together — throwing after the UPDATE has committed leaves exactly the state
/// the decision forbids (an organization modified with no audit row). EF Core cannot span two contexts in
/// one transaction, so reusing <see cref="AuditLogDbContext"/> here would silently give up the guarantee
/// while looking like reuse. The audit COLUMN MAP is still shared —
/// <see cref="AuditLogModelConfiguration.ConfigureAuditLogs"/> — so only the transaction boundary
/// differs.</para>
///
/// <para><b>TWO scoping regimes, deliberately.</b> The update+audit unit of work runs UNDER
/// <see cref="TenantScope"/>: the target organization id is known, so RLS can stay engaged rather than
/// resting on the prod role being BYPASSRLS (<c>organizations</c>' policy is <c>id = current_org_id</c>,
/// <c>audit_logs</c>' is <c>organization_id = current_org_id</c>; both pass). The notification fan-out
/// CANNOT be scoped that way — it selects platform owners, who belong to their own organizations — so it
/// runs unscoped and AFTER the transaction commits, matching the TS unscoped <c>db</c>.</para>
///
/// <para>Ownership: <c>organizations</c> moves to <c>efcoreStranglerWrite</c> in
/// docs/architecture/table-ownership.md; <c>audit_logs</c> and <c>notifications</c> are
/// <c>efcoreAppendOnly</c>; <c>users</c> stays <c>efcoreReadOnly</c>. Nothing is transferred — Prisma still
/// owns every DDL — and one-active-writer holds because the routes map only when
/// <c>Platform:PlatformOrganizationsWriteEnabled</c> is true, which defaults false.</para>
/// </summary>
public sealed class PlatformOrganizationsWriteDbContext(DbContextOptions<PlatformOrganizationsWriteDbContext> options)
    : DbContext(options)
{
    public DbSet<PlatformOrganizationWriteEntity> Organizations => Set<PlatformOrganizationWriteEntity>();

    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    public DbSet<PlatformOrganizationOwnerEntity> Users => Set<PlatformOrganizationOwnerEntity>();

    public DbSet<PlatformOrganizationNotificationEntity> Notifications => Set<PlatformOrganizationNotificationEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ConfigureAuditLogs();

        modelBuilder.Entity<PlatformOrganizationWriteEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
            entity.Property(o => o.Slug).HasColumnName("slug");
            entity.Property(o => o.Domain).HasColumnName("domain");
            entity.Property(o => o.Logo).HasColumnName("logo");
            // Native Prisma enum (OrgPlan) — mapped for READING only. See the entity docblock: writes go
            // through an explicit {plan}::"OrgPlan" cast in the update statement.
            entity.Property(o => o.Plan).HasColumnName("plan");
            entity.Property(o => o.Settings).HasColumnName("settings").HasColumnType("jsonb");
            entity.Property(o => o.BillingEmail).HasColumnName("billing_email");
            entity.Property(o => o.IsActive).HasColumnName("is_active");
            // Prisma writes `timestamp(3) without time zone`; pin the store type so Npgsql does not read
            // these back as timestamptz and shift them by the session zone.
            entity.Property(o => o.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(o => o.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
            entity.Property(o => o.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<PlatformOrganizationOwnerEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.IsPlatformOwner).HasColumnName("is_platform_owner");
        });

        modelBuilder.Entity<PlatformOrganizationNotificationEntity>(entity =>
        {
            entity.ToTable("notifications");
            entity.HasKey(n => n.Id);
            entity.Property(n => n.Id).HasColumnName("id");
            entity.Property(n => n.OrganizationId).HasColumnName("organization_id");
            entity.Property(n => n.UserId).HasColumnName("user_id");
            entity.Property(n => n.Type).HasColumnName("type");
            entity.Property(n => n.Title).HasColumnName("title");
            entity.Property(n => n.Message).HasColumnName("message");
            entity.Property(n => n.Module).HasColumnName("module");
            entity.Property(n => n.EntityType).HasColumnName("entity_type");
            entity.Property(n => n.EntityId).HasColumnName("entity_id");
            entity.Property(n => n.ActionUrl).HasColumnName("action_url");
            // `read`/`archived` are never sent (Prisma leaves them to their DB defaults) and are therefore
            // not mapped at all; created_at is DB-generated the same way audit_logs.created_at is.
            entity.Property(n => n.CreatedAt)
                .HasColumnName("created_at")
                .HasColumnType("timestamp")
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .ValueGeneratedOnAdd();
        });
    }
}
