using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Succession;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED succession tables (efcoreReadOnly in
/// docs/architecture/table-ownership.md): <c>critical_roles</c>, <c>successors</c> (+ <c>users</c> for holder/
/// successor/addedBy names, <c>salary_bands</c> + <c>employee_compensations</c> for the comp-gap alert, and
/// <c>nine_box_evaluations</c> for suggested-successors). Every query is <c>.AsNoTracking()</c> and
/// <c>SaveChanges</c> is never called. Like the reporting/team-intel read contexts it runs exclusively UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so Postgres RLS isolates the org for every
/// query, with an explicit <c>organization_id</c> filter for defense-in-depth.
///
/// No native enums here (readiness/criticality/type/quadrant are plain Strings), so this context needs no
/// NpgsqlDataSource with EnableUnmappedTypes (unlike billing/evaluation360). Prisma DateTime columns are
/// <c>timestamp(3) without time zone</c> — pinned <c>HasColumnType("timestamp")</c> so Npgsql reads them as
/// Unspecified-kind wall-clock UTC, matching the Prisma-owned columns exactly.
/// </summary>
public sealed class SuccessionReadDbContext(DbContextOptions<SuccessionReadDbContext> options)
    : DbContext(options)
{
    public DbSet<CriticalRoleReadEntity> CriticalRoles => Set<CriticalRoleReadEntity>();

    public DbSet<SuccessorReadEntity> Successors => Set<SuccessorReadEntity>();

    public DbSet<SuccessionUserReadEntity> Users => Set<SuccessionUserReadEntity>();

    public DbSet<SalaryBandReadEntity> SalaryBands => Set<SalaryBandReadEntity>();

    public DbSet<EmployeeCompensationReadEntity> EmployeeCompensations => Set<EmployeeCompensationReadEntity>();

    public DbSet<NineBoxEvaluationReadEntity> NineBoxEvaluations => Set<NineBoxEvaluationReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CriticalRoleReadEntity>(entity =>
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

        modelBuilder.Entity<SuccessorReadEntity>(entity =>
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

        modelBuilder.Entity<SuccessionUserReadEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Avatar).HasColumnName("avatar");
            entity.Property(u => u.JobTitle).HasColumnName("job_title");
            entity.Property(u => u.Email).HasColumnName("email");
        });

        modelBuilder.Entity<SalaryBandReadEntity>(entity =>
        {
            entity.ToTable("salary_bands");
            entity.HasKey(b => b.Id);
            entity.Property(b => b.Id).HasColumnName("id");
            entity.Property(b => b.OrganizationId).HasColumnName("organization_id");
            entity.Property(b => b.Level).HasColumnName("level");
            entity.Property(b => b.MidSalary).HasColumnName("mid_salary");
        });

        modelBuilder.Entity<EmployeeCompensationReadEntity>(entity =>
        {
            entity.ToTable("employee_compensations");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.UserId).HasColumnName("user_id");
            entity.Property(c => c.CurrentSalary).HasColumnName("current_salary");
            entity.Property(c => c.Currency).HasColumnName("currency");
        });

        modelBuilder.Entity<NineBoxEvaluationReadEntity>(entity =>
        {
            entity.ToTable("nine_box_evaluations");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.Quadrant).HasColumnName("quadrant");
            entity.Property(e => e.PotentialScore).HasColumnName("potential_score");
            entity.Property(e => e.PerformanceScore).HasColumnName("performance_score");
            entity.Property(e => e.EvaluatedAt).HasColumnName("evaluated_at").HasColumnType("timestamp");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });
    }
}
