using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Reporting;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED recruitment-analytics tables (efcoreReadOnly in
/// docs/architecture/table-ownership.md): <c>offers</c>, <c>applications</c>, <c>pipeline_stages</c>,
/// <c>stage_movements</c>, <c>vacancies</c>, <c>users</c>. Every query is <c>.AsNoTracking()</c> and
/// <c>SaveChanges</c> is never called. Like the billing/external read contexts it runs exclusively UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so Postgres RLS isolates the org for
/// every query, with an explicit <c>organization_id</c> filter for defense-in-depth.
///
/// The aggregated <c>status</c>/<c>source</c> columns are plain Prisma <c>String</c>s (NOT native enums),
/// so this context needs no NpgsqlDataSource with EnableUnmappedTypes (unlike billing). Prisma DateTime
/// columns are <c>timestamp(3) without time zone</c> — pinned <c>HasColumnType("timestamp")</c> so Npgsql
/// reads/writes them as Unspecified-kind wall-clock UTC, matching the Prisma-owned columns exactly.
/// </summary>
public sealed class ReportingReadDbContext(DbContextOptions<ReportingReadDbContext> options)
    : DbContext(options)
{
    public DbSet<OfferReadEntity> Offers => Set<OfferReadEntity>();

    public DbSet<ApplicationReadEntity> Applications => Set<ApplicationReadEntity>();

    public DbSet<PipelineStageReadEntity> PipelineStages => Set<PipelineStageReadEntity>();

    public DbSet<StageMovementReadEntity> StageMovements => Set<StageMovementReadEntity>();

    public DbSet<VacancyReadEntity> Vacancies => Set<VacancyReadEntity>();

    public DbSet<UserReadEntity> Users => Set<UserReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<OfferReadEntity>(entity =>
        {
            entity.ToTable("offers");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.OrganizationId).HasColumnName("organization_id");
            entity.Property(o => o.VacancyId).HasColumnName("vacancy_id");
            entity.Property(o => o.ApplicationId).HasColumnName("application_id");
            entity.Property(o => o.Status).HasColumnName("status");
            entity.Property(o => o.SentAt).HasColumnName("sent_at").HasColumnType("timestamp");
            entity.Property(o => o.RespondedAt).HasColumnName("responded_at").HasColumnType("timestamp");
            entity.Property(o => o.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");

            entity.HasOne(o => o.Vacancy).WithMany().HasForeignKey(o => o.VacancyId);
            entity.HasOne(o => o.Application).WithMany(a => a.Offers).HasForeignKey(o => o.ApplicationId);
        });

        modelBuilder.Entity<ApplicationReadEntity>(entity =>
        {
            entity.ToTable("applications");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.VacancyId).HasColumnName("vacancy_id");
            entity.Property(a => a.CurrentStageId).HasColumnName("current_stage_id");
            entity.Property(a => a.Source).HasColumnName("source");
            entity.Property(a => a.Status).HasColumnName("status");
            entity.Property(a => a.AppliedAt).HasColumnName("applied_at").HasColumnType("timestamp");
            entity.Property(a => a.RejectedAt).HasColumnName("rejected_at").HasColumnType("timestamp");
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");

            entity.HasOne(a => a.CurrentStage).WithMany().HasForeignKey(a => a.CurrentStageId);
            entity.HasMany(a => a.Movements).WithOne().HasForeignKey(m => m.ApplicationId);
        });

        modelBuilder.Entity<PipelineStageReadEntity>(entity =>
        {
            entity.ToTable("pipeline_stages");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.OrganizationId).HasColumnName("organization_id");
            entity.Property(p => p.VacancyId).HasColumnName("vacancy_id");
            entity.Property(p => p.Name).HasColumnName("name");
            entity.Property(p => p.Order).HasColumnName("order");
            entity.Property(p => p.SlaHours).HasColumnName("sla_hours");
            entity.Property(p => p.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");

            entity.HasOne(p => p.Vacancy).WithMany().HasForeignKey(p => p.VacancyId);
        });

        modelBuilder.Entity<StageMovementReadEntity>(entity =>
        {
            entity.ToTable("stage_movements");
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Id).HasColumnName("id");
            entity.Property(m => m.OrganizationId).HasColumnName("organization_id");
            entity.Property(m => m.ApplicationId).HasColumnName("application_id");
            entity.Property(m => m.MovedAt).HasColumnName("moved_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<VacancyReadEntity>(entity =>
        {
            entity.ToTable("vacancies");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.OrganizationId).HasColumnName("organization_id");
            entity.Property(v => v.Status).HasColumnName("status");
            entity.Property(v => v.AssignedTo).HasColumnName("assigned_to");
            entity.Property(v => v.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(v => v.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");

            entity.HasOne(v => v.Assignee).WithMany().HasForeignKey(v => v.AssignedTo);
        });

        modelBuilder.Entity<UserReadEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
        });
    }
}
