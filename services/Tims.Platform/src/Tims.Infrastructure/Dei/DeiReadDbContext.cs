using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Dei;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED DEI-read tables (efcoreReadOnly in
/// docs/architecture/table-ownership.md): <c>employee_demographics</c> (NEW this slice) + <c>users</c>,
/// <c>user_roles</c>, <c>roles</c> (the leadership join) + <c>candidates</c> (hiring funnel) +
/// <c>salary_adjustments</c> (promotion equity) + <c>surveys</c>, <c>survey_responses</c> (inclusion index). Every
/// query is <c>.AsNoTracking()</c> and <c>SaveChanges</c> is never called. Like the billing/eval360 read contexts
/// it runs exclusively UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so Postgres RLS
/// isolates the org for every query, with an explicit <c>organization_id</c> filter for defense-in-depth.
///
/// The <c>gender</c>/<c>ethnicity</c>/<c>disability_status</c> columns are NATIVE Prisma enum types, mapped to CLR
/// enums via <see cref="DeiReadDataSource"/> (the GROUP BY needs correctly-typed enum keys). <c>nationality</c> is
/// a plain String; <c>date_of_birth</c> is <c>date</c> (read as DateOnly). Prisma <c>timestamp(3)</c> columns
/// (candidates/salary_adjustments/surveys) are <c>timestamp without time zone</c> — pinned
/// <c>HasColumnType("timestamp")</c> so Npgsql reads them as Unspecified-kind wall-clock UTC.
/// </summary>
public sealed class DeiReadDbContext(DbContextOptions<DeiReadDbContext> options)
    : DbContext(options)
{
    public DbSet<DeiDemographicsReadEntity> Demographics => Set<DeiDemographicsReadEntity>();

    public DbSet<DeiUserReadEntity> Users => Set<DeiUserReadEntity>();

    public DbSet<DeiUserRoleReadEntity> UserRoles => Set<DeiUserRoleReadEntity>();

    public DbSet<DeiRoleReadEntity> Roles => Set<DeiRoleReadEntity>();

    public DbSet<DeiCandidateReadEntity> Candidates => Set<DeiCandidateReadEntity>();

    public DbSet<DeiSalaryAdjustmentReadEntity> SalaryAdjustments => Set<DeiSalaryAdjustmentReadEntity>();

    public DbSet<DeiSurveyReadEntity> Surveys => Set<DeiSurveyReadEntity>();

    public DbSet<DeiSurveyResponseReadEntity> SurveyResponses => Set<DeiSurveyResponseReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // The three NATIVE Prisma enum types are mapped to their CLR enums via DeiReadDataSource.MapEnums, applied
        // to the EF options at BOTH registration sites (Program.cs DI + the Testcontainers fixture). That
        // options-level MapEnum teaches EFCore.PG's type-mapping source these properties are native enums — so EF
        // materializes the grouped key into the CLR enum (not GetInt32 → InvalidCastException). A model-level
        // HasPostgresEnum here would be redundant with (and derive labels differently from) that mapping, so it is
        // intentionally omitted.
        modelBuilder.Entity<DeiDemographicsReadEntity>(entity =>
        {
            entity.ToTable("employee_demographics");
            entity.HasKey(d => d.Id);
            entity.Property(d => d.Id).HasColumnName("id");
            entity.Property(d => d.OrganizationId).HasColumnName("organization_id");
            entity.Property(d => d.UserId).HasColumnName("user_id");
            entity.Property(d => d.Gender).HasColumnName("gender");
            entity.Property(d => d.Ethnicity).HasColumnName("ethnicity");
            entity.Property(d => d.DisabilityStatus).HasColumnName("disability_status");
            entity.Property(d => d.Nationality).HasColumnName("nationality");
            entity.Property(d => d.DateOfBirth).HasColumnName("date_of_birth").HasColumnType("date");
        });

        modelBuilder.Entity<DeiUserReadEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.IsActive).HasColumnName("is_active");
        });

        modelBuilder.Entity<DeiUserRoleReadEntity>(entity =>
        {
            entity.ToTable("user_roles");
            entity.HasKey(ur => ur.Id);
            entity.Property(ur => ur.Id).HasColumnName("id");
            entity.Property(ur => ur.UserId).HasColumnName("user_id");
            entity.Property(ur => ur.RoleId).HasColumnName("role_id");
        });

        modelBuilder.Entity<DeiRoleReadEntity>(entity =>
        {
            entity.ToTable("roles");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.Slug).HasColumnName("slug");
        });

        modelBuilder.Entity<DeiCandidateReadEntity>(entity =>
        {
            entity.ToTable("candidates");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<DeiSalaryAdjustmentReadEntity>(entity =>
        {
            entity.ToTable("salary_adjustments");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.Type).HasColumnName("type");
            entity.Property(a => a.EffectiveDate).HasColumnName("effective_date").HasColumnType("timestamp");
        });

        modelBuilder.Entity<DeiSurveyReadEntity>(entity =>
        {
            entity.ToTable("surveys");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.Type).HasColumnName("type");
            entity.Property(s => s.Questions).HasColumnName("questions").HasColumnType("jsonb");
            entity.Property(s => s.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<DeiSurveyResponseReadEntity>(entity =>
        {
            entity.ToTable("survey_responses");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.SurveyId).HasColumnName("survey_id");
            entity.Property(r => r.Answers).HasColumnName("answers").HasColumnType("jsonb");
        });
    }
}
