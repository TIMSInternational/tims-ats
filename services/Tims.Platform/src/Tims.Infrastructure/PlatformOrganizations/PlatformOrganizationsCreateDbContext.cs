using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.OrgProvisioning;

namespace Tims.Infrastructure.PlatformOrganizations;

/// <summary>
/// The create context for the platform-owner organizations surface (Phase-5 slice 21, issue #76) — the
/// seven-table provisioning transaction of <c>createOrganization</c> plus its audit row.
///
/// <para><b>Its OWN context, for the same reason slice 20's is its own.</b> Federico's decision on #76 is
/// that the C# audit write ships FAIL-CLOSED, diverging from the TS <c>.catch(() =&gt; {})</c>. That only
/// means something if the audit INSERT shares the creation transaction — throwing after seven tables have
/// committed leaves exactly the state the decision forbids. EF Core CAN span two contexts in one
/// transaction, but only by sharing a <c>DbConnection</c> and calling <c>Database.UseTransaction</c>, and
/// nothing in this service's DI wiring does that: every context is registered with its own connection. So
/// reusing <see cref="AuditLogDbContext"/> here would have split them and silently given up the guarantee
/// while looking like reuse. The audit COLUMN MAP is still shared
/// (<see cref="AuditLogModelConfiguration.ConfigureAuditLogs"/>), as is the provisioning map
/// (<see cref="OrgProvisioningModelConfiguration.ConfigureOrgProvisioning"/>, which #75 will also use), so
/// only the transaction boundary differs.</para>
///
/// <para><b>It re-maps EXISTING CLR types rather than declaring new ones.</b>
/// <see cref="PlatformOrganizationWriteEntity"/>, <see cref="PlatformOrganizationOwnerEntity"/> and
/// <see cref="PlatformOrganizationNotificationEntity"/> come from slice 20 and
/// <see cref="AuditLogEntity"/> from the audit plane. CLR types are shared across contexts freely, and the
/// ownership checker builds a <c>Set</c>, so a second <c>ToTable("organizations")</c> is not a duplicate
/// violation.</para>
///
/// <para><b>It MUST be registered on <c>PlatformOrganizationsDataSourceHolder</c>, not a bare connection
/// string.</b> There is one holder per domain, shared by read, write and create. The create path both
/// WRITES native Postgres enum columns (<c>organizations.plan</c>, <c>subscriptions.plan</c>/<c>status</c>)
/// — which is solved by explicit <c>::"OrgPlan"</c> casts, NOT by the data source — and READS the
/// organization row back for the response, which is solved only by
/// <c>EnableUnmappedTypes</c>. Without it that read-back throws <c>InvalidCastException</c> on the first
/// materialised row: green unit tests, 500 in production.</para>
///
/// <para><b>TWO scoping regimes, deliberately.</b> The seven-table create + the audit row run UNDER
/// <see cref="TenantScope"/> opened on the NEW organization id, generated client-side before the first
/// statement: <c>organizations</c>' policy is <c>id = current_org_id</c> and the other six are
/// <c>organization_id = current_org_id</c>, so every <c>WITH CHECK</c> passes for the rows being inserted.
/// The notification fan-out CANNOT be scoped that way — it selects platform owners, who belong to their own
/// organizations — so it runs unscoped and AFTER the transaction commits, matching the TS unscoped
/// <c>db</c>.</para>
///
/// <para>Ownership: see <c>docs/architecture/table-ownership.md</c>, note
/// <c>platform_organizations_create_slice21</c>. Nothing is transferred — Prisma still owns every DDL — and
/// one-active-writer rests entirely on <c>Platform:PlatformOrganizationsCreateEnabled</c> defaulting false.
/// Unlike slice 20 this surface can NEVER become an ownership flip: self-serve signup
/// (<c>apps/web/app/auth/callback/route.ts</c>) creates the same seven tables — FOUR of them
/// (<c>companies</c>, <c>business_units</c>, <c>teams</c>, <c>org_entitlements</c>) through the same shared
/// helpers at <c>:92-93</c>, and <c>organizations</c>/<c>roles</c>/<c>subscriptions</c> INLINE at
/// <c>:80</c>, <c>:96</c> and <c>:122</c>. COUNT THE SET before repeating this: the shared helper pair
/// writes FOUR tables, not six and not seven.</para>
/// </summary>
public sealed class PlatformOrganizationsCreateDbContext(DbContextOptions<PlatformOrganizationsCreateDbContext> options)
    : DbContext(options)
{
    public DbSet<PlatformOrganizationWriteEntity> Organizations => Set<PlatformOrganizationWriteEntity>();

    public DbSet<RoleWriteEntity> Roles => Set<RoleWriteEntity>();

    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    public DbSet<PlatformOrganizationOwnerEntity> Users => Set<PlatformOrganizationOwnerEntity>();

    public DbSet<PlatformOrganizationNotificationEntity> Notifications => Set<PlatformOrganizationNotificationEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ConfigureAuditLogs();
        modelBuilder.ConfigureOrgProvisioning();

        modelBuilder.Entity<PlatformOrganizationWriteEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
            entity.Property(o => o.Slug).HasColumnName("slug");
            entity.Property(o => o.Domain).HasColumnName("domain");
            entity.Property(o => o.Logo).HasColumnName("logo");
            // Native Prisma enum (OrgPlan) — mapped for READING the created row back only. The INSERT goes
            // through an explicit {plan}::"OrgPlan" cast in raw SQL; EnableUnmappedTypes covers the read,
            // never the write.
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
            entity.Property(n => n.CreatedAt)
                .HasColumnName("created_at")
                .HasColumnType("timestamp")
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .ValueGeneratedOnAdd();
        });
    }
}
