using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Compensation;

/// <summary>
/// Write-capable EF context over the Prisma-OWNED <c>salary_adjustments</c> + <c>employee_compensations</c>
/// (<c>efcoreStranglerWrite</c> in docs/architecture/table-ownership.md). "Dumb" about tenancy: every read/write
/// runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so RLS isolates the org and the
/// WITH-CHECK passes. createAdjustment INSERTs a tracked <see cref="SalaryAdjustmentWriteEntity"/>;
/// approveAdjustment issues two conditional <c>ExecuteUpdateAsync</c> in ONE transaction. No native enums here
/// (type/status are plain Strings), so no NpgsqlDataSource is needed. Prisma <c>timestamp(3)</c> columns are
/// pinned <c>HasColumnType("timestamp")</c> so Npgsql reads/writes them as Unspecified-kind wall-clock UTC,
/// matching the Prisma-owned columns exactly. This context is DISTINCT from the read-only
/// <see cref="CompensationReadDbContext"/> — a strangler-write table may also be read.
/// </summary>
public sealed class CompensationWriteDbContext(DbContextOptions<CompensationWriteDbContext> options)
    : DbContext(options)
{
    public DbSet<SalaryAdjustmentWriteEntity> SalaryAdjustments => Set<SalaryAdjustmentWriteEntity>();

    public DbSet<EmployeeCompensationWriteEntity> EmployeeCompensations => Set<EmployeeCompensationWriteEntity>();

    /// users — read-only membership lookup for the createAdjustment H1 org-membership backstop.
    public DbSet<CompensationUserWriteEntity> Users => Set<CompensationUserWriteEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SalaryAdjustmentWriteEntity>(entity =>
        {
            entity.ToTable("salary_adjustments");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.UserId).HasColumnName("user_id");
            entity.Property(a => a.Type).HasColumnName("type");
            entity.Property(a => a.PreviousSalary).HasColumnName("previous_salary");
            entity.Property(a => a.NewSalary).HasColumnName("new_salary");
            entity.Property(a => a.Currency).HasColumnName("currency");
            entity.Property(a => a.Reason).HasColumnName("reason");
            entity.Property(a => a.Status).HasColumnName("status");
            entity.Property(a => a.ApprovedById).HasColumnName("approved_by_id");
            entity.Property(a => a.EffectiveDate).HasColumnName("effective_date").HasColumnType("timestamp");
            entity.Property(a => a.RequestedById).HasColumnName("requested_by_id");
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(a => a.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<EmployeeCompensationWriteEntity>(entity =>
        {
            entity.ToTable("employee_compensations");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.UserId).HasColumnName("user_id");
            entity.Property(c => c.CurrentSalary).HasColumnName("current_salary");
            entity.Property(c => c.Currency).HasColumnName("currency");
            entity.Property(c => c.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<CompensationUserWriteEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
        });
    }
}
