using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.NineBox;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED nine-box tables (efcoreReadOnly in
/// docs/architecture/table-ownership.md): <c>nine_box_evaluations</c> + the three <c>calibration_*</c> tables
/// (+ <c>users</c> for grid/detail/creator/member/voter names, <c>user_teams</c>/<c>teams</c> for the getGrid
/// team/unit intersect). Every query is <c>.AsNoTracking()</c> and <c>SaveChanges</c> is never called. Like
/// the succession/reporting read contexts it runs exclusively UNDER <see cref="TenantScope"/> (SET LOCAL ROLE
/// app_tenant + org GUC) so Postgres RLS isolates the org for every query, with an explicit
/// <c>organization_id</c> filter for defense-in-depth.
///
/// No native enums here (quadrant / calibration status/member-status/vote-quadrant are plain Strings), so this
/// context needs no NpgsqlDataSource with EnableUnmappedTypes (unlike billing/evaluation360). Prisma DateTime
/// columns are <c>timestamp(3) without time zone</c> — pinned <c>HasColumnType("timestamp")</c> so Npgsql reads
/// them as Unspecified-kind wall-clock UTC, matching the Prisma-owned columns exactly. <c>axis_breakdown</c> is
/// pinned <c>jsonb</c> and read as its raw JSON text.
/// </summary>
public sealed class NineBoxReadDbContext(DbContextOptions<NineBoxReadDbContext> options)
    : DbContext(options)
{
    public DbSet<NineBoxEvaluationReadEntity> NineBoxEvaluations => Set<NineBoxEvaluationReadEntity>();

    public DbSet<NineBoxUserReadEntity> Users => Set<NineBoxUserReadEntity>();

    public DbSet<NineBoxUserTeamReadEntity> UserTeams => Set<NineBoxUserTeamReadEntity>();

    public DbSet<NineBoxTeamReadEntity> Teams => Set<NineBoxTeamReadEntity>();

    public DbSet<CalibrationSessionReadEntity> CalibrationSessions => Set<CalibrationSessionReadEntity>();

    public DbSet<CalibrationMemberReadEntity> CalibrationMembers => Set<CalibrationMemberReadEntity>();

    public DbSet<CalibrationVoteReadEntity> CalibrationVotes => Set<CalibrationVoteReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<NineBoxEvaluationReadEntity>(entity =>
        {
            entity.ToTable("nine_box_evaluations");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.Period).HasColumnName("period");
            entity.Property(e => e.PotentialScore).HasColumnName("potential_score");
            entity.Property(e => e.PerformanceScore).HasColumnName("performance_score");
            entity.Property(e => e.Quadrant).HasColumnName("quadrant");
            entity.Property(e => e.Confidence).HasColumnName("confidence");
            entity.Property(e => e.AxisBreakdown).HasColumnName("axis_breakdown").HasColumnType("jsonb");
            entity.Property(e => e.EvaluatedAt).HasColumnName("evaluated_at").HasColumnType("timestamp");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<NineBoxUserReadEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Avatar).HasColumnName("avatar");
            entity.Property(u => u.JobTitle).HasColumnName("job_title");
            entity.Property(u => u.Email).HasColumnName("email");
            entity.Property(u => u.CompanyId).HasColumnName("company_id");
        });

        modelBuilder.Entity<NineBoxUserTeamReadEntity>(entity =>
        {
            entity.ToTable("user_teams");
            entity.HasKey(ut => ut.Id);
            entity.Property(ut => ut.Id).HasColumnName("id");
            entity.Property(ut => ut.UserId).HasColumnName("user_id");
            entity.Property(ut => ut.TeamId).HasColumnName("team_id");
        });

        modelBuilder.Entity<NineBoxTeamReadEntity>(entity =>
        {
            entity.ToTable("teams");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Id).HasColumnName("id");
            entity.Property(t => t.OrganizationId).HasColumnName("organization_id");
            entity.Property(t => t.BusinessUnitId).HasColumnName("business_unit_id");
        });

        modelBuilder.Entity<CalibrationSessionReadEntity>(entity =>
        {
            entity.ToTable("calibration_sessions");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.Period).HasColumnName("period");
            entity.Property(s => s.Status).HasColumnName("status");
            entity.Property(s => s.ScheduledAt).HasColumnName("scheduled_at").HasColumnType("timestamp");
            entity.Property(s => s.CompletedAt).HasColumnName("completed_at").HasColumnType("timestamp");
            entity.Property(s => s.CreatedById).HasColumnName("created_by_id");
            entity.Property(s => s.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(s => s.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<CalibrationMemberReadEntity>(entity =>
        {
            entity.ToTable("calibration_members");
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Id).HasColumnName("id");
            entity.Property(m => m.SessionId).HasColumnName("session_id");
            entity.Property(m => m.UserId).HasColumnName("user_id");
            entity.Property(m => m.Status).HasColumnName("status");
            entity.Property(m => m.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<CalibrationVoteReadEntity>(entity =>
        {
            entity.ToTable("calibration_votes");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.SessionId).HasColumnName("session_id");
            entity.Property(v => v.EvaluatedUserId).HasColumnName("evaluated_user_id");
            entity.Property(v => v.VoterId).HasColumnName("voter_id");
            entity.Property(v => v.Quadrant).HasColumnName("quadrant");
            entity.Property(v => v.Justification).HasColumnName("justification");
            entity.Property(v => v.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });
    }
}
