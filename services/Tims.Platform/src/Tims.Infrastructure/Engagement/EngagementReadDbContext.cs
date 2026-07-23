using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Engagement;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED engagement tables (efcoreReadOnly in
/// docs/architecture/table-ownership.md): <c>surveys</c>, <c>survey_responses</c>, <c>action_plans</c>,
/// <c>leader_commitments</c>, <c>alerts</c> (+ <c>users</c> for the responsible/leader joins + the getResultsByArea
/// area anchors + the getRotationRisk count). Every query is <c>.AsNoTracking()</c> and <c>SaveChanges</c> is
/// never called. Like the reporting/team-intel/nine-box read contexts it runs exclusively UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so Postgres RLS isolates the org for every
/// query, with an explicit <c>organization_id</c> filter for defense-in-depth.
///
/// No native enums here (surveys.type/.status, action_plans.status, leader_commitments.status, alerts.*  are all
/// plain Strings), so this context needs no NpgsqlDataSource with EnableUnmappedTypes (unlike billing/eval360).
/// Prisma DateTime columns are <c>timestamp(3) without time zone</c> — pinned <c>HasColumnType("timestamp")</c> so
/// Npgsql reads them as Unspecified-kind wall-clock UTC. The jsonb columns (questions, answers, actions, metadata)
/// are pinned <c>jsonb</c> and read as raw JSON text.
/// </summary>
public sealed class EngagementReadDbContext(DbContextOptions<EngagementReadDbContext> options)
    : DbContext(options)
{
    public DbSet<SurveyReadEntity> Surveys => Set<SurveyReadEntity>();

    public DbSet<SurveyResponseReadEntity> SurveyResponses => Set<SurveyResponseReadEntity>();

    public DbSet<ActionPlanReadEntity> ActionPlans => Set<ActionPlanReadEntity>();

    public DbSet<LeaderCommitmentReadEntity> LeaderCommitments => Set<LeaderCommitmentReadEntity>();

    public DbSet<AlertReadEntity> Alerts => Set<AlertReadEntity>();

    public DbSet<EngagementUserReadEntity> Users => Set<EngagementUserReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SurveyReadEntity>(entity =>
        {
            entity.ToTable("surveys");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.Title).HasColumnName("title");
            entity.Property(s => s.Type).HasColumnName("type");
            entity.Property(s => s.Status).HasColumnName("status");
            entity.Property(s => s.Questions).HasColumnName("questions").HasColumnType("jsonb");
            entity.Property(s => s.StartsAt).HasColumnName("starts_at").HasColumnType("timestamp");
            entity.Property(s => s.EndsAt).HasColumnName("ends_at").HasColumnType("timestamp");
            entity.Property(s => s.ResponseCount).HasColumnName("response_count");
            entity.Property(s => s.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(s => s.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<SurveyResponseReadEntity>(entity =>
        {
            entity.ToTable("survey_responses");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.SurveyId).HasColumnName("survey_id");
            entity.Property(r => r.UserId).HasColumnName("user_id");
            entity.Property(r => r.Answers).HasColumnName("answers").HasColumnType("jsonb");
            entity.Property(r => r.SubmittedAt).HasColumnName("submitted_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<ActionPlanReadEntity>(entity =>
        {
            entity.ToTable("action_plans");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.Title).HasColumnName("title");
            entity.Property(a => a.ResponsibleId).HasColumnName("responsible_id");
            entity.Property(a => a.Area).HasColumnName("area");
            entity.Property(a => a.Status).HasColumnName("status");
            entity.Property(a => a.DueDate).HasColumnName("due_date").HasColumnType("timestamp");
            entity.Property(a => a.Actions).HasColumnName("actions").HasColumnType("jsonb");
            entity.Property(a => a.Notes).HasColumnName("notes");
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(a => a.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<LeaderCommitmentReadEntity>(entity =>
        {
            entity.ToTable("leader_commitments");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.LeaderId).HasColumnName("leader_id");
            entity.Property(c => c.Description).HasColumnName("description");
            entity.Property(c => c.Status).HasColumnName("status");
            entity.Property(c => c.DueDate).HasColumnName("due_date").HasColumnType("timestamp");
            entity.Property(c => c.CompletedAt).HasColumnName("completed_at").HasColumnType("timestamp");
            entity.Property(c => c.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(c => c.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<AlertReadEntity>(entity =>
        {
            entity.ToTable("alerts");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.RuleId).HasColumnName("rule_id");
            entity.Property(a => a.Module).HasColumnName("module");
            entity.Property(a => a.Severity).HasColumnName("severity");
            entity.Property(a => a.Title).HasColumnName("title");
            entity.Property(a => a.Message).HasColumnName("message");
            entity.Property(a => a.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
            entity.Property(a => a.Status).HasColumnName("status");
            entity.Property(a => a.DismissedById).HasColumnName("dismissed_by_id");
            entity.Property(a => a.DismissedAt).HasColumnName("dismissed_at").HasColumnType("timestamp");
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<EngagementUserReadEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Avatar).HasColumnName("avatar");
            entity.Property(u => u.CompanyId).HasColumnName("company_id");
            entity.Property(u => u.BusinessUnitId).HasColumnName("business_unit_id");
            entity.Property(u => u.IsActive).HasColumnName("is_active");
        });
    }
}
