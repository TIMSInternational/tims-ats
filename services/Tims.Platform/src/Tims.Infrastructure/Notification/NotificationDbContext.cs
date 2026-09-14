using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Notification;

/// <summary>
/// EF Core context for the notification slice (Phase-5 Slice 25) — <c>notifications</c> +
/// <c>notification_preferences</c>, no navigation properties.
///
/// <para><b>ONE context for both the read and the write side</b>, unlike the fit-engine slice's pair. Two
/// reasons, both specific to this surface: the read and write flags cover the SAME two tables (fit-engine's did
/// not), so a second context would duplicate every map for no isolation gain; and <c>getPreferences</c> is a
/// tRPC <c>query</c> that CREATES its row on a miss, so the "read" path genuinely needs write capability. The
/// route-level flags remain separate, so canary control is unchanged.</para>
///
/// <para>"Dumb" about tenancy: every operation runs UNDER <see cref="TenantScope"/>, and each query additionally
/// carries an explicit <c>user_id</c> predicate, which is the real authorization boundary for a self-service
/// surface. Timestamps are pinned <c>timestamp</c> (TRAP 6/11) and jsonb pinned <c>jsonb</c> as string.</para>
///
/// <para>⚠️ <b>Every INSERT in this slice is raw SQL, and that is deliberate — do not "simplify" one into an
/// EF <c>Add</c>.</b> Prisma omits a column from the INSERT when the caller did not supply it, letting the
/// database default apply. EF's <c>ValueGeneratedOnAdd</c> looks equivalent but decides by SENTINEL: it omits
/// the property when its value equals the CLR default. For <c>email_enabled</c>/<c>push_enabled</c> — NOT NULL,
/// database default <c>true</c> — an explicit <c>false</c> from the caller IS the CLR default, so EF would drop
/// it and Postgres would store <c>true</c>: the exact opposite of what was requested, silently. Raw INSERTs
/// name precisely the columns the caller supplied, which is Prisma's rule stated directly. Only the two
/// genuinely database-generated <c>created_at</c> columns keep <c>ValueGeneratedOnAdd</c>.</para>
/// </summary>
public sealed class NotificationDbContext(DbContextOptions<NotificationDbContext> options) : DbContext(options)
{
    public DbSet<NotificationEntity> Notifications => Set<NotificationEntity>();

    public DbSet<NotificationPreferenceEntity> NotificationPreferences => Set<NotificationPreferenceEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<NotificationEntity>(entity =>
        {
            entity.ToTable("notifications");
            entity.HasKey(n => n.Id);
            entity.Property(n => n.Id).HasColumnName("id").ValueGeneratedNever();
            entity.Property(n => n.OrganizationId).HasColumnName("organization_id");
            entity.Property(n => n.UserId).HasColumnName("user_id");
            entity.Property(n => n.Type).HasColumnName("type");
            entity.Property(n => n.Title).HasColumnName("title");
            entity.Property(n => n.Message).HasColumnName("message");
            entity.Property(n => n.Module).HasColumnName("module");
            entity.Property(n => n.EntityType).HasColumnName("entity_type");
            entity.Property(n => n.EntityId).HasColumnName("entity_id");
            entity.Property(n => n.ActionUrl).HasColumnName("action_url");
            entity.Property(n => n.Read).HasColumnName("read");
            entity.Property(n => n.ReadAt).HasColumnName("read_at").HasColumnType("timestamp");
            entity.Property(n => n.Archived).HasColumnName("archived");
            entity.Property(n => n.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp")
                .ValueGeneratedOnAdd();
        });

        modelBuilder.Entity<NotificationPreferenceEntity>(entity =>
        {
            entity.ToTable("notification_preferences");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id").ValueGeneratedNever();
            entity.Property(p => p.UserId).HasColumnName("user_id");
            entity.Property(p => p.EmailEnabled).HasColumnName("email_enabled");
            entity.Property(p => p.PushEnabled).HasColumnName("push_enabled");
            entity.Property(p => p.Categories).HasColumnName("categories").HasColumnType("jsonb");
            entity.Property(p => p.Modules).HasColumnName("modules").HasColumnType("jsonb");
            entity.Property(p => p.QuietHoursStart).HasColumnName("quiet_hours_start");
            entity.Property(p => p.QuietHoursEnd).HasColumnName("quiet_hours_end");
            entity.Property(p => p.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp")
                .ValueGeneratedOnAdd();
            entity.Property(p => p.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
            entity.HasIndex(p => p.UserId).IsUnique();
        });
    }
}
