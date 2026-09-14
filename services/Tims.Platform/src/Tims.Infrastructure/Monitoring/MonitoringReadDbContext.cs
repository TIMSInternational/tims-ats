using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Monitoring;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED monitoring tables (Phase-5 Q0b slice 1, issue #100):
/// <c>alerts</c>, <c>alert_rules</c>, <c>action_plans</c>, <c>users</c>, <c>vacancies</c>,
/// <c>salary_adjustments</c>, <c>surveys</c>, <c>survey_responses</c>. Every query is
/// <c>.AsNoTracking()</c> and <c>SaveChanges</c> is never called.
///
/// Like the reporting / team-intel / engagement read contexts it runs exclusively UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so Postgres RLS isolates the org for
/// every query, with an explicit <c>organization_id</c> filter for defense-in-depth.
///
/// No native enums here — <c>alerts.severity/.status/.module</c>, <c>vacancies.status</c>,
/// <c>salary_adjustments.status</c>, <c>surveys.status</c> and <c>action_plans.status</c> are all plain
/// <c>text</c> in the prod baseline (packages/db/baseline/prod-public-schema.sql), so this context needs
/// no <c>NpgsqlDataSource</c> with <c>EnableUnmappedTypes</c> (unlike billing/eval360).
///
/// Prisma DateTime columns are <c>timestamp(3) without time zone</c> — pinned
/// <c>HasColumnType("timestamp")</c> so Npgsql reads them as Unspecified-kind wall-clock UTC, matching
/// the Prisma-owned columns exactly. <c>alert_rules.condition</c> is jsonb, read as raw text.
/// </summary>
public sealed class MonitoringReadDbContext(DbContextOptions<MonitoringReadDbContext> options)
    : DbContext(options)
{
    public DbSet<MonitoringAlertReadEntity> Alerts => Set<MonitoringAlertReadEntity>();

    public DbSet<MonitoringAlertRuleReadEntity> AlertRules => Set<MonitoringAlertRuleReadEntity>();

    public DbSet<MonitoringActionPlanReadEntity> ActionPlans => Set<MonitoringActionPlanReadEntity>();

    public DbSet<MonitoringUserReadEntity> Users => Set<MonitoringUserReadEntity>();

    public DbSet<MonitoringVacancyReadEntity> Vacancies => Set<MonitoringVacancyReadEntity>();

    public DbSet<MonitoringSalaryAdjustmentReadEntity> SalaryAdjustments => Set<MonitoringSalaryAdjustmentReadEntity>();

    public DbSet<MonitoringSurveyReadEntity> Surveys => Set<MonitoringSurveyReadEntity>();

    public DbSet<MonitoringSurveyResponseReadEntity> SurveyResponses => Set<MonitoringSurveyResponseReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MonitoringAlertReadEntity>(entity =>
        {
            entity.ToTable("alerts");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.Module).HasColumnName("module");
            entity.Property(a => a.Severity).HasColumnName("severity");
            entity.Property(a => a.Title).HasColumnName("title");
            entity.Property(a => a.Message).HasColumnName("message");
            entity.Property(a => a.Status).HasColumnName("status");
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<MonitoringAlertRuleReadEntity>(entity =>
        {
            entity.ToTable("alert_rules");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.Module).HasColumnName("module");
            entity.Property(r => r.Condition).HasColumnName("condition").HasColumnType("jsonb");
            entity.Property(r => r.Severity).HasColumnName("severity");
            entity.Property(r => r.Message).HasColumnName("message");
            entity.Property(r => r.IsActive).HasColumnName("is_active");
        });

        modelBuilder.Entity<MonitoringActionPlanReadEntity>(entity =>
        {
            entity.ToTable("action_plans");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.OrganizationId).HasColumnName("organization_id");
            entity.Property(p => p.Title).HasColumnName("title");
            entity.Property(p => p.ResponsibleId).HasColumnName("responsible_id");
            entity.Property(p => p.Area).HasColumnName("area");
            entity.Property(p => p.Status).HasColumnName("status");
            entity.Property(p => p.DueDate).HasColumnName("due_date").HasColumnType("timestamp");
        });

        modelBuilder.Entity<MonitoringUserReadEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Avatar).HasColumnName("avatar");
            entity.Property(u => u.IsActive).HasColumnName("is_active");
            entity.Property(u => u.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<MonitoringVacancyReadEntity>(entity =>
        {
            entity.ToTable("vacancies");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.OrganizationId).HasColumnName("organization_id");
            entity.Property(v => v.Status).HasColumnName("status");
            entity.Property(v => v.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<MonitoringSalaryAdjustmentReadEntity>(entity =>
        {
            entity.ToTable("salary_adjustments");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.Status).HasColumnName("status");
        });

        modelBuilder.Entity<MonitoringSurveyReadEntity>(entity =>
        {
            entity.ToTable("surveys");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.Status).HasColumnName("status");
        });

        modelBuilder.Entity<MonitoringSurveyResponseReadEntity>(entity =>
        {
            entity.ToTable("survey_responses");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.SubmittedAt).HasColumnName("submitted_at").HasColumnType("timestamp");
        });
    }
}
