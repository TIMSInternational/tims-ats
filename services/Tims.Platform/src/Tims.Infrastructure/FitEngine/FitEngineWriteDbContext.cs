using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// Write-capable EF Core context for <c>computeForVacancy</c> / <c>upsertRoleFamilyWeightProfile</c>. Maps the
/// compute flow's READ tables (candidates, vacancies, job_profiles, assessment_assignments, assessment_results,
/// ai_interview_sessions, applications — all subset maps, no navs) plus <c>role_family_weight_profiles</c> for
/// the profile find. The two upserts run as raw <c>INSERT … ON CONFLICT DO UPDATE</c> on this context's
/// TenantScope connection/transaction, so <c>fit_scores</c> carries NO EF map (it is still registered in the
/// ownership ledger — the strangler writes it). "Dumb" about tenancy: every op runs UNDER
/// <see cref="TenantScope"/>; RLS isolates the org and WITH CHECK passes on every INSERT/UPDATE. No native enums
/// mapped (TRAP 3 N/A); timestamps pinned <c>timestamp</c>; jsonb pinned <c>jsonb</c> as string.
/// </summary>
public sealed class FitEngineWriteDbContext(DbContextOptions<FitEngineWriteDbContext> options)
    : DbContext(options)
{
    public DbSet<FitCandidateWriteEntity> Candidates => Set<FitCandidateWriteEntity>();

    public DbSet<FitVacancyWriteEntity> Vacancies => Set<FitVacancyWriteEntity>();

    public DbSet<FitJobProfileWriteEntity> JobProfiles => Set<FitJobProfileWriteEntity>();

    public DbSet<FitAssessmentAssignmentWriteEntity> AssessmentAssignments => Set<FitAssessmentAssignmentWriteEntity>();

    public DbSet<FitAssessmentResultWriteEntity> AssessmentResults => Set<FitAssessmentResultWriteEntity>();

    public DbSet<FitAiInterviewSessionWriteEntity> AiInterviewSessions => Set<FitAiInterviewSessionWriteEntity>();

    public DbSet<FitApplicationWriteEntity> Applications => Set<FitApplicationWriteEntity>();

    public DbSet<WeightProfileReadEntity> WeightProfiles => Set<WeightProfileReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FitCandidateWriteEntity>(entity =>
        {
            entity.ToTable("candidates");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.YearsExperience).HasColumnName("years_experience");
            entity.Property(c => c.Education).HasColumnName("education").HasColumnType("jsonb");
            entity.Property(c => c.Languages).HasColumnName("languages").HasColumnType("jsonb");
            entity.Property(c => c.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<FitVacancyWriteEntity>(entity =>
        {
            entity.ToTable("vacancies");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.OrganizationId).HasColumnName("organization_id");
            entity.Property(v => v.RoleFamily).HasColumnName("role_family");
            entity.Property(v => v.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<FitJobProfileWriteEntity>(entity =>
        {
            entity.ToTable("job_profiles");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.VacancyId).HasColumnName("vacancy_id");
            entity.Property(p => p.FitRequirements).HasColumnName("fit_requirements").HasColumnType("jsonb");
        });

        modelBuilder.Entity<FitAssessmentAssignmentWriteEntity>(entity =>
        {
            entity.ToTable("assessment_assignments");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.CandidateId).HasColumnName("candidate_id");
            entity.Property(a => a.VacancyId).HasColumnName("vacancy_id");
            entity.Property(a => a.CompletedAt).HasColumnName("completed_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<FitAssessmentResultWriteEntity>(entity =>
        {
            entity.ToTable("assessment_results");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.AssignmentId).HasColumnName("assignment_id");
            entity.Property(r => r.NormalizedScore).HasColumnName("normalized_score");
        });

        modelBuilder.Entity<FitAiInterviewSessionWriteEntity>(entity =>
        {
            entity.ToTable("ai_interview_sessions");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.CandidateId).HasColumnName("candidate_id");
            entity.Property(s => s.VacancyId).HasColumnName("vacancy_id");
            entity.Property(s => s.FitScore).HasColumnName("fit_score");
            entity.Property(s => s.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<FitApplicationWriteEntity>(entity =>
        {
            entity.ToTable("applications");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.CandidateId).HasColumnName("candidate_id");
            entity.Property(a => a.VacancyId).HasColumnName("vacancy_id");
            entity.Property(a => a.Status).HasColumnName("status");
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
