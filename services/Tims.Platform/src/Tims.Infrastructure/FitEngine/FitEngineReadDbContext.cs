using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// Read-only EF Core context for the FIT-engine READ endpoints — <c>fit_scores</c> (strangler-write table, read
/// here), <c>candidates</c>/<c>vacancies</c> (efcoreReadOnly, subset maps), <c>role_family_weight_profiles</c>
/// (strangler-write, read here). No navigation properties; every query AsNoTracking under TenantScope. No native
/// enums touched, so no NpgsqlDataSource is needed. Prisma <c>timestamp(3)</c> columns are pinned
/// <c>HasColumnType("timestamp")</c> (TRAP 6/11); jsonb pinned <c>jsonb</c>, read as string.
/// </summary>
public sealed class FitEngineReadDbContext(DbContextOptions<FitEngineReadDbContext> options)
    : DbContext(options)
{
    public DbSet<FitScoreReadEntity> FitScores => Set<FitScoreReadEntity>();

    public DbSet<FitCandidateReadEntity> Candidates => Set<FitCandidateReadEntity>();

    public DbSet<FitVacancyReadEntity> Vacancies => Set<FitVacancyReadEntity>();

    public DbSet<WeightProfileReadEntity> WeightProfiles => Set<WeightProfileReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FitScoreReadEntity>(entity =>
        {
            entity.ToTable("fit_scores");
            entity.HasKey(f => f.Id);
            entity.Property(f => f.Id).HasColumnName("id");
            entity.Property(f => f.OrganizationId).HasColumnName("organization_id");
            entity.Property(f => f.CandidateId).HasColumnName("candidate_id");
            entity.Property(f => f.VacancyId).HasColumnName("vacancy_id");
            entity.Property(f => f.OverallScore).HasColumnName("overall_score");
            entity.Property(f => f.Breakdown).HasColumnName("breakdown").HasColumnType("jsonb");
            entity.Property(f => f.IsPartial).HasColumnName("is_partial");
            entity.Property(f => f.CalculatedAt).HasColumnName("calculated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<FitCandidateReadEntity>(entity =>
        {
            entity.ToTable("candidates");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.FirstName).HasColumnName("first_name");
            entity.Property(c => c.LastName).HasColumnName("last_name");
        });

        modelBuilder.Entity<FitVacancyReadEntity>(entity =>
        {
            entity.ToTable("vacancies");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.Title).HasColumnName("title");
        });

        modelBuilder.Entity<WeightProfileReadEntity>(entity =>
        {
            entity.ToTable("role_family_weight_profiles");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.OrganizationId).HasColumnName("organization_id");
            entity.Property(p => p.Name).HasColumnName("name");
            entity.Property(p => p.Weights).HasColumnName("weights").HasColumnType("jsonb");
        });
    }
}
