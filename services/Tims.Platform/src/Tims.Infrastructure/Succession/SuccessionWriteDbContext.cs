using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Succession;

/// <summary>
/// Write-capable EF Core context over the Prisma-OWNED succession WRITE tables (<c>efcoreStranglerWrite</c> in
/// docs/architecture/table-ownership.md): <c>critical_roles</c> + <c>successors</c> (+ read-only <c>users</c> for
/// the addSuccessor nested <c>user</c> projection). "Dumb" about tenancy: every read/write runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so RLS isolates the org and the WITH-CHECK passes
/// on every INSERT/UPDATE/DELETE. addCriticalRole/addSuccessor INSERT a tracked entity; removeSuccessor loads +
/// Removes; updateSuccessorReadiness/updateCriticalRoleBand load + mutate the tracked entity — all in ONE
/// transaction. No native enums here (criticality/readiness/type are plain Strings), so no NpgsqlDataSource is
/// needed (unlike evaluation360/billing). Prisma <c>timestamp(3)</c> columns are pinned
/// <c>HasColumnType("timestamp")</c> so Npgsql reads/writes them as Unspecified-kind wall-clock UTC, matching the
/// Prisma-owned columns exactly. This context is DISTINCT from the read-only <see cref="SuccessionReadDbContext"/> —
/// a strangler-write table may also be read.
/// </summary>
public sealed class SuccessionWriteDbContext(DbContextOptions<SuccessionWriteDbContext> options)
    : DbContext(options)
{
    public DbSet<CriticalRoleWriteEntity> CriticalRoles => Set<CriticalRoleWriteEntity>();

    public DbSet<SuccessorWriteEntity> Successors => Set<SuccessorWriteEntity>();

    public DbSet<SuccessionUserWriteEntity> Users => Set<SuccessionUserWriteEntity>();

    public DbSet<SuccessionCompanyWriteEntity> Companies => Set<SuccessionCompanyWriteEntity>();

    public DbSet<SuccessionBusinessUnitWriteEntity> BusinessUnits => Set<SuccessionBusinessUnitWriteEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CriticalRoleWriteEntity>(entity =>
        {
            entity.ToTable("critical_roles");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.Title).HasColumnName("title");
            entity.Property(r => r.PositionId).HasColumnName("position_id");
            entity.Property(r => r.CurrentHolderId).HasColumnName("current_holder_id");
            entity.Property(r => r.CompanyId).HasColumnName("company_id");
            entity.Property(r => r.UnitId).HasColumnName("unit_id");
            entity.Property(r => r.Criticality).HasColumnName("criticality");
            entity.Property(r => r.FlightRisk).HasColumnName("flight_risk");
            entity.Property(r => r.TargetBandLevel).HasColumnName("target_band_level");
            entity.Property(r => r.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(r => r.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<SuccessorWriteEntity>(entity =>
        {
            entity.ToTable("successors");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.CriticalRoleId).HasColumnName("critical_role_id");
            entity.Property(s => s.UserId).HasColumnName("user_id");
            entity.Property(s => s.Readiness).HasColumnName("readiness");
            entity.Property(s => s.Type).HasColumnName("type");
            entity.Property(s => s.DevelopmentPlan).HasColumnName("development_plan");
            entity.Property(s => s.AddedById).HasColumnName("added_by_id");
            entity.Property(s => s.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(s => s.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<SuccessionUserWriteEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Avatar).HasColumnName("avatar");
        });

        modelBuilder.Entity<SuccessionCompanyWriteEntity>(entity =>
        {
            entity.ToTable("companies");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
        });

        modelBuilder.Entity<SuccessionBusinessUnitWriteEntity>(entity =>
        {
            entity.ToTable("business_units");
            entity.HasKey(b => b.Id);
            entity.Property(b => b.Id).HasColumnName("id");
            entity.Property(b => b.OrganizationId).HasColumnName("organization_id");
        });
    }
}
