using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.NineBox;

/// <summary>
/// Write-capable EF Core context over the Prisma-OWNED nine-box calibration WRITE tables
/// (<c>efcoreStranglerWrite</c> in docs/architecture/table-ownership.md): <c>calibration_sessions</c> +
/// <c>calibration_members</c> (+ read-only <c>users</c> for the in-org checks). The <c>calibration_votes</c> upsert
/// is a raw parameterized ON-CONFLICT INSERT on this context's connection (EF has no native upsert), so it needs no
/// mapped vote entity here — calibration_votes stays mapped by <c>NineBoxReadEntities</c> (a strangler-write table
/// may be read too). "Dumb" about tenancy: every read/write runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE
/// app_tenant + org GUC) so RLS isolates the org and the session-subquery WITH-CHECK passes on every member/vote
/// INSERT. createCalibration/addCalibrationMember INSERT tracked entities; removeCalibrationMember uses set-based
/// ExecuteDelete; finalizeCalibration uses conditional ExecuteUpdate — all in ONE transaction. status/quadrant are
/// plain Strings (NOT native enums), so no NpgsqlDataSource is needed (unlike evaluation360/billing). Prisma
/// <c>timestamp(3)</c> columns are pinned <c>HasColumnType("timestamp")</c> so Npgsql reads/writes them as
/// Unspecified-kind wall-clock UTC, matching the Prisma-owned columns exactly. DISTINCT from the read-only
/// <see cref="NineBoxReadDbContext"/> — a strangler-write table may also be read.
/// </summary>
public sealed class NineBoxWriteDbContext(DbContextOptions<NineBoxWriteDbContext> options)
    : DbContext(options)
{
    public DbSet<CalibrationSessionWriteEntity> CalibrationSessions => Set<CalibrationSessionWriteEntity>();

    public DbSet<CalibrationMemberWriteEntity> CalibrationMembers => Set<CalibrationMemberWriteEntity>();

    public DbSet<NineBoxUserWriteEntity> Users => Set<NineBoxUserWriteEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CalibrationSessionWriteEntity>(entity =>
        {
            entity.ToTable("calibration_sessions");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.Period).HasColumnName("period");
            entity.Property(s => s.Status).HasColumnName("status");
            entity.Property(s => s.ScheduledAt).HasColumnName("scheduled_at").HasColumnType("timestamp");
            entity.Property(s => s.CompletedAt).HasColumnName("completed_at").HasColumnType("timestamp");
            entity.Property(s => s.CreatedById).HasColumnName("created_by_id");
            entity.Property(s => s.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(s => s.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<CalibrationMemberWriteEntity>(entity =>
        {
            entity.ToTable("calibration_members");
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Id).HasColumnName("id");
            entity.Property(m => m.SessionId).HasColumnName("session_id");
            entity.Property(m => m.UserId).HasColumnName("user_id");
            entity.Property(m => m.Status).HasColumnName("status");
            entity.Property(m => m.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<NineBoxUserWriteEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
        });
    }
}
