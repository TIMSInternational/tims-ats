using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Compensation;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED compensation tables (efcoreReadOnly in
/// docs/architecture/table-ownership.md): <c>salary_bands</c>, <c>employee_compensations</c>,
/// <c>benefit_plans</c>, <c>benefit_enrollments</c> (+ <c>users</c> for the active-headcount denominator).
/// Every query is <c>.AsNoTracking()</c> and <c>SaveChanges</c> is never called. Like the succession/reporting
/// read contexts it runs exclusively UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so
/// Postgres RLS isolates the org for every query, with an explicit <c>organization_id</c> filter (defense-in-depth).
///
/// No native enums here (salary_adjustments.type/.status + benefit_plans.type are plain Strings), so this
/// context needs no NpgsqlDataSource with EnableUnmappedTypes (unlike billing/evaluation360). Prisma DateTime
/// columns are <c>timestamp(3) without time zone</c> — pinned <c>HasColumnType("timestamp")</c> so Npgsql reads
/// them as Unspecified-kind wall-clock UTC, matching the Prisma-owned columns exactly.
///
/// The field-authed reads (listPendingAdjustments over <c>salary_adjustments</c>; getEmployeeComp/myCompensation
/// over <c>employee_compensations</c> + <c>salary_bands</c>) issue raw parameterized SQL on THIS context's
/// connection (dynamic SELECT column list from selectFor — never select-then-null); they are not modeled as EF
/// entity queries, so no <c>salary_adjustments</c> DbSet exists here.
/// </summary>
public sealed class CompensationReadDbContext(DbContextOptions<CompensationReadDbContext> options)
    : DbContext(options)
{
    public DbSet<SalaryBandCompReadEntity> SalaryBands => Set<SalaryBandCompReadEntity>();

    public DbSet<EmployeeCompensationCompReadEntity> EmployeeCompensations => Set<EmployeeCompensationCompReadEntity>();

    public DbSet<BenefitPlanCompReadEntity> BenefitPlans => Set<BenefitPlanCompReadEntity>();

    public DbSet<BenefitEnrollmentCompReadEntity> BenefitEnrollments => Set<BenefitEnrollmentCompReadEntity>();

    public DbSet<CompensationUserReadEntity> Users => Set<CompensationUserReadEntity>();

    public DbSet<CompanyCompReadEntity> Companies => Set<CompanyCompReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SalaryBandCompReadEntity>(entity =>
        {
            entity.ToTable("salary_bands");
            entity.HasKey(b => b.Id);
            entity.Property(b => b.Id).HasColumnName("id");
            entity.Property(b => b.OrganizationId).HasColumnName("organization_id");
            entity.Property(b => b.Level).HasColumnName("level");
            entity.Property(b => b.Title).HasColumnName("title");
            entity.Property(b => b.MinSalary).HasColumnName("min_salary");
            entity.Property(b => b.MidSalary).HasColumnName("mid_salary");
            entity.Property(b => b.MaxSalary).HasColumnName("max_salary");
            entity.Property(b => b.Currency).HasColumnName("currency");
            entity.Property(b => b.IsActive).HasColumnName("is_active");
            entity.Property(b => b.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(b => b.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<EmployeeCompensationCompReadEntity>(entity =>
        {
            entity.ToTable("employee_compensations");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.UserId).HasColumnName("user_id");
            entity.Property(c => c.CurrentSalary).HasColumnName("current_salary");
            entity.Property(c => c.CompaRatio).HasColumnName("compa_ratio");
            entity.Property(c => c.Currency).HasColumnName("currency");
            entity.Property(c => c.VariablePay).HasColumnName("variable_pay");
            entity.Property(c => c.BandId).HasColumnName("band_id");
        });

        modelBuilder.Entity<CompanyCompReadEntity>(entity =>
        {
            entity.ToTable("companies");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.Currency).HasColumnName("currency");
            entity.Property(c => c.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<BenefitPlanCompReadEntity>(entity =>
        {
            entity.ToTable("benefit_plans");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.OrganizationId).HasColumnName("organization_id");
            entity.Property(p => p.Name).HasColumnName("name");
            entity.Property(p => p.Type).HasColumnName("type");
        });

        modelBuilder.Entity<BenefitEnrollmentCompReadEntity>(entity =>
        {
            entity.ToTable("benefit_enrollments");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.BenefitPlanId).HasColumnName("benefit_plan_id");
        });

        modelBuilder.Entity<CompensationUserReadEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.IsActive).HasColumnName("is_active");
        });
    }
}
