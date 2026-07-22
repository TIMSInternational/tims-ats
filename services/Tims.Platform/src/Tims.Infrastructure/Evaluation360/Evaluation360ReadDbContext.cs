using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Evaluation360;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED evaluation360 tables (efcoreReadOnly in
/// docs/architecture/table-ownership.md): <c>review_cycles</c>, <c>rater_assignments</c>,
/// <c>rater_responses</c> (+ <c>users</c> for the rater-task subject name). Every query is <c>.AsNoTracking()</c>
/// and <c>SaveChanges</c> is never called. Like the billing/reporting read contexts it runs exclusively UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so Postgres RLS isolates the org for every
/// query, with an explicit <c>organization_id</c> filter for defense-in-depth; the self-service reads ALSO
/// hard-filter on the caller's user id.
///
/// The <c>status</c>/<c>relationship</c> columns are NATIVE Prisma enum types, mapped to CLR enums via
/// <see cref="Evaluation360ReadDataSource"/> (the WHERE/GROUP BY filters need correctly-typed enum parameters,
/// which EnableUnmappedTypes-as-text cannot provide). Prisma DateTime columns are <c>timestamp(3) without time
/// zone</c> — pinned <c>HasColumnType("timestamp")</c> so Npgsql reads them as Unspecified-kind wall-clock UTC.
/// </summary>
public sealed class Evaluation360ReadDbContext(DbContextOptions<Evaluation360ReadDbContext> options)
    : DbContext(options)
{
    public DbSet<ReviewCycleReadEntity> ReviewCycles => Set<ReviewCycleReadEntity>();

    public DbSet<RaterAssignmentReadEntity> RaterAssignments => Set<RaterAssignmentReadEntity>();

    public DbSet<RaterResponseReadEntity> RaterResponses => Set<RaterResponseReadEntity>();

    public DbSet<UserReadEntity> Users => Set<UserReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // The three NATIVE Prisma enum types (review_cycles.status, rater_assignments.relationship/status) are
        // mapped to their CLR enums via Evaluation360ReadDataSource.MapEnums, applied to the EF options at BOTH
        // registration sites (Program.cs DI + the Testcontainers fixture). That options-level MapEnum is what
        // teaches EFCore.PG's type-mapping source these properties are native enums — so EF emits correctly-typed
        // enum parameters in the WHERE/GROUP BY filters (not `= <integer>`, error 42883) and materializes the
        // columns into the CLR enums (not GetInt32 → InvalidCastException). A model-level HasPostgresEnum here
        // would be redundant with (and derive labels differently from) that mapping, so it is intentionally omitted.
        modelBuilder.Entity<ReviewCycleReadEntity>(entity =>
        {
            entity.ToTable("review_cycles");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.Name).HasColumnName("name");
            entity.Property(c => c.Status).HasColumnName("status");
            entity.Property(c => c.OpensAt).HasColumnName("opens_at").HasColumnType("timestamp");
            entity.Property(c => c.ClosesAt).HasColumnName("closes_at").HasColumnType("timestamp");
            entity.Property(c => c.PublishedAt).HasColumnName("published_at").HasColumnType("timestamp");
            entity.Property(c => c.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<RaterAssignmentReadEntity>(entity =>
        {
            entity.ToTable("rater_assignments");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.CycleId).HasColumnName("cycle_id");
            entity.Property(a => a.SubjectUserId).HasColumnName("subject_user_id");
            entity.Property(a => a.RaterUserId).HasColumnName("rater_user_id");
            entity.Property(a => a.Relationship).HasColumnName("relationship");
            entity.Property(a => a.Status).HasColumnName("status");

            entity.HasOne(a => a.Cycle).WithMany(c => c.Assignments).HasForeignKey(a => a.CycleId);
            entity.HasOne(a => a.Subject).WithMany().HasForeignKey(a => a.SubjectUserId);
            entity.HasMany(a => a.Responses).WithOne(r => r.Assignment).HasForeignKey(r => r.AssignmentId);
        });

        modelBuilder.Entity<RaterResponseReadEntity>(entity =>
        {
            entity.ToTable("rater_responses");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.AssignmentId).HasColumnName("assignment_id");
            entity.Property(r => r.CompetencyKey).HasColumnName("competency_key");
            entity.Property(r => r.Rating).HasColumnName("rating");
            entity.Property(r => r.Comment).HasColumnName("comment");
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
