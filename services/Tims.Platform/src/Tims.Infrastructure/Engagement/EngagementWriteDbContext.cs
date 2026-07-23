using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Engagement;

/// <summary>
/// Write-capable EF Core context over the Prisma-OWNED engagement WRITE tables (<c>efcoreStranglerWrite</c> in
/// docs/architecture/table-ownership.md): <c>surveys</c> + <c>survey_responses</c> + <c>action_plans</c> (+ read-only
/// <c>users</c> for the H1 in-org membership check on responsibleId). "Dumb" about tenancy: every read/write runs
/// UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so RLS isolates the org and the WITH-CHECK
/// passes on every INSERT/UPDATE. createSurvey/submitSurveyResponse/createActionPlan INSERT a tracked entity;
/// activateSurvey/updateActionPlan load + mutate the tracked entity — all in ONE transaction. No native enums here
/// (type/status are plain Strings), so no NpgsqlDataSource is needed. Prisma <c>timestamp(3)</c> columns are pinned
/// <c>HasColumnType("timestamp")</c> so Npgsql reads/writes them as Unspecified-kind wall-clock UTC. The jsonb
/// columns are pinned <c>jsonb</c> and bound as string (Npgsql sends the string param as a jsonb parameter). This
/// context is DISTINCT from the read-only <see cref="EngagementReadDbContext"/> — a strangler-write table may also be
/// read (it still is, by the C# read slice AND by the LIVE TS monitoring.ts/dei.ts/alert-cron).
/// </summary>
public sealed class EngagementWriteDbContext(DbContextOptions<EngagementWriteDbContext> options)
    : DbContext(options)
{
    public DbSet<SurveyWriteEntity> Surveys => Set<SurveyWriteEntity>();

    public DbSet<SurveyResponseWriteEntity> SurveyResponses => Set<SurveyResponseWriteEntity>();

    public DbSet<ActionPlanWriteEntity> ActionPlans => Set<ActionPlanWriteEntity>();

    public DbSet<EngagementUserWriteEntity> Users => Set<EngagementUserWriteEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SurveyWriteEntity>(entity =>
        {
            entity.ToTable("surveys");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.Title).HasColumnName("title");
            entity.Property(s => s.Type).HasColumnName("type");
            entity.Property(s => s.Status).HasColumnName("status");
            entity.Property(s => s.Questions).HasColumnName("questions").HasColumnType("jsonb");
            entity.Property(s => s.TargetGroups).HasColumnName("target_groups").HasColumnType("jsonb");
            entity.Property(s => s.StartsAt).HasColumnName("starts_at").HasColumnType("timestamp");
            entity.Property(s => s.EndsAt).HasColumnName("ends_at").HasColumnType("timestamp");
            entity.Property(s => s.ResponseCount).HasColumnName("response_count");
            entity.Property(s => s.CreatedById).HasColumnName("created_by_id");
            entity.Property(s => s.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(s => s.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<SurveyResponseWriteEntity>(entity =>
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

        modelBuilder.Entity<ActionPlanWriteEntity>(entity =>
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

        modelBuilder.Entity<EngagementUserWriteEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
        });
    }
}
