using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Evaluation360;

/// <summary>
/// Write-capable EF Core context over the Prisma-OWNED evaluation360 tables (<c>efcoreStranglerWrite</c> in
/// docs/architecture/table-ownership.md): <c>review_cycles</c>, <c>rater_assignments</c>, <c>rater_responses</c>
/// (+ read-only <c>users</c> for the assignRaters org-membership validation). "Dumb" about tenancy: every read/write
/// runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so RLS isolates the org and the
/// WITH-CHECK passes on every INSERT/UPDATE. createCycle INSERTs a tracked <see cref="ReviewCycleWriteEntity"/>;
/// the transitions + the submit claim issue conditional <c>ExecuteUpdateAsync</c>; submitRatings AddRanges the 6
/// <see cref="RaterResponseWriteEntity"/>; assignRaters uses a raw parameterized ON CONFLICT insert.
///
/// The <c>status</c>/<c>relationship</c> columns are NATIVE Prisma enum types, mapped to CLR enums via the Slice-7
/// <see cref="Evaluation360ReadDataSource.MapEnums"/> (the WHERE/SET on those columns needs correctly-typed enum
/// parameters — EnableUnmappedTypes-as-text cannot supply them). Prisma DateTime columns are <c>timestamp(3) without
/// time zone</c> — pinned <c>HasColumnType("timestamp")</c> so Npgsql reads/writes them as Unspecified-kind wall-clock
/// UTC. DISTINCT from the read-only <see cref="Evaluation360ReadDbContext"/> — a strangler-write table may also be read.
/// </summary>
public sealed class Evaluation360WriteDbContext(DbContextOptions<Evaluation360WriteDbContext> options)
    : DbContext(options)
{
    public DbSet<ReviewCycleWriteEntity> ReviewCycles => Set<ReviewCycleWriteEntity>();

    public DbSet<RaterAssignmentWriteEntity> RaterAssignments => Set<RaterAssignmentWriteEntity>();

    public DbSet<RaterResponseWriteEntity> RaterResponses => Set<RaterResponseWriteEntity>();

    public DbSet<UserWriteEntity> Users => Set<UserWriteEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // The native Prisma enum types (review_cycles.status, rater_assignments.relationship/status) are mapped to
        // their CLR enums via Evaluation360ReadDataSource.MapEnums, applied to the EF options at BOTH registration
        // sites (Program.cs DI + the Testcontainers fixture) — that options-level MapEnum teaches EFCore.PG these
        // properties are native enums, so EF emits correctly-typed enum parameters in the WHERE/SET (not `= <integer>`).
        modelBuilder.Entity<ReviewCycleWriteEntity>(entity =>
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
            entity.Property(c => c.CreatedById).HasColumnName("created_by_id");
            entity.Property(c => c.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(c => c.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<RaterAssignmentWriteEntity>(entity =>
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
            entity.Property(a => a.SubmittedAt).HasColumnName("submitted_at").HasColumnType("timestamp");
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(a => a.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<RaterResponseWriteEntity>(entity =>
        {
            entity.ToTable("rater_responses");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.AssignmentId).HasColumnName("assignment_id");
            entity.Property(r => r.CompetencyKey).HasColumnName("competency_key");
            entity.Property(r => r.Rating).HasColumnName("rating");
            entity.Property(r => r.Comment).HasColumnName("comment");
            entity.Property(r => r.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(r => r.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<UserWriteEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
        });
    }
}
