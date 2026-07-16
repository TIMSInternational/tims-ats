using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.ExternalVendor;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED <c>assessment_results</c> ⋈
/// <c>assessment_assignments</c> ⋈ <c>assessment_types</c> tables (efcoreReadOnly in
/// docs/architecture/table-ownership.md). Maps only the columns the external read surface needs and
/// MUST NEVER write them (every query is <c>.AsNoTracking()</c>; <c>SaveChanges</c> is never called).
///
/// Like <see cref="Tims.Infrastructure.Access.AnchorDbContext"/> (and unlike the privileged
/// <see cref="Tims.Infrastructure.Identity.IdentityDbContext"/>), this context runs exclusively UNDER
/// <see cref="TenantScope"/> — <c>SET LOCAL ROLE app_tenant</c> + org GUC — so Postgres RLS isolates the
/// org for every query (the superuser bypasses RLS unless that role switch is issued). The context stays
/// "dumb" about tenancy; <see cref="TenantScope"/> owns the role/GUC.
/// </summary>
public sealed class ExternalAssessmentDbContext(DbContextOptions<ExternalAssessmentDbContext> options)
    : DbContext(options)
{
    public DbSet<ExternalAssessmentResultReadEntity> Results => Set<ExternalAssessmentResultReadEntity>();

    public DbSet<ExternalAssessmentAssignmentReadEntity> Assignments => Set<ExternalAssessmentAssignmentReadEntity>();

    public DbSet<ExternalAssessmentTypeReadEntity> AssessmentTypes => Set<ExternalAssessmentTypeReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ExternalAssessmentResultReadEntity>(entity =>
        {
            entity.ToTable("assessment_results");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.AssignmentId).HasColumnName("assignment_id");
            entity.Property(r => r.RawScore).HasColumnName("raw_score");
            entity.Property(r => r.NormalizedScore).HasColumnName("normalized_score");
            entity.Property(r => r.Percentile).HasColumnName("percentile");
            // Opaque psychometric JSON: read the jsonb column as raw text (parsed to JsonNode client-side).
            entity.Property(r => r.Breakdown).HasColumnName("breakdown").HasColumnType("jsonb");
            entity.Property(r => r.Interpretation).HasColumnName("interpretation").HasColumnType("jsonb");
            entity.Property(r => r.ModelVersion).HasColumnName("model_version");
            // Prisma DateTime maps to `timestamp(3) without time zone`; pin it so Npgsql reads/writes it
            // as Unspecified-kind DateTime (its default is timestamptz, which rejects the cursor-boundary
            // parameter) — matching the Prisma-owned column exactly.
            entity.Property(r => r.ScoredAt).HasColumnName("scored_at").HasColumnType("timestamp");

            // Required to-one assignment (AssessmentResult.assignment is non-nullable in Prisma).
            entity.HasOne(r => r.Assignment)
                .WithOne()
                .HasForeignKey<ExternalAssessmentResultReadEntity>(r => r.AssignmentId)
                .HasPrincipalKey<ExternalAssessmentAssignmentReadEntity>(a => a.Id);
        });

        modelBuilder.Entity<ExternalAssessmentAssignmentReadEntity>(entity =>
        {
            entity.ToTable("assessment_assignments");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.CandidateId).HasColumnName("candidate_id");
            entity.Property(a => a.VacancyId).HasColumnName("vacancy_id");
            entity.Property(a => a.AssessmentTypeId).HasColumnName("assessment_type_id");
            entity.Property(a => a.Status).HasColumnName("status");
            // Prisma-owned `timestamp(3) without time zone` columns (see the scored_at note above).
            entity.Property(a => a.AssignedAt).HasColumnName("assigned_at").HasColumnType("timestamp");
            entity.Property(a => a.StartedAt).HasColumnName("started_at").HasColumnType("timestamp");
            entity.Property(a => a.CompletedAt).HasColumnName("completed_at").HasColumnType("timestamp");
            entity.Property(a => a.ExpiresAt).HasColumnName("expires_at").HasColumnType("timestamp");

            // Required to-one assessment type (supplies the v1 type name).
            entity.HasOne(a => a.AssessmentType)
                .WithMany()
                .HasForeignKey(a => a.AssessmentTypeId);
        });

        modelBuilder.Entity<ExternalAssessmentTypeReadEntity>(entity =>
        {
            entity.ToTable("assessment_types");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Id).HasColumnName("id");
            entity.Property(t => t.OrganizationId).HasColumnName("organization_id");
            entity.Property(t => t.Name).HasColumnName("name");
        });
    }
}
