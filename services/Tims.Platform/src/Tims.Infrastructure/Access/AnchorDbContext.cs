using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Access;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED tables the anchor loader + IDOR probe run on
/// (efcoreReadOnly in docs/architecture/table-ownership.md). Maps ONLY the columns the anchor
/// queries need and MUST NEVER write them (every query is <c>.AsNoTracking()</c>; <c>SaveChanges</c>
/// is never called).
///
/// Unlike <see cref="Tims.Infrastructure.Identity.IdentityDbContext"/> (the PRIVILEGED pre-tenant
/// path), this context is used exclusively UNDER <see cref="TenantScope"/> — <c>SET LOCAL ROLE
/// app_tenant</c> + org GUC — so Postgres RLS isolates the org for every anchor/probe query (the
/// container's superuser bypasses RLS unless that role switch is issued). The DbContext stays
/// "dumb" (no role/GUC of its own); <see cref="TenantScope"/> owns that, mirroring
/// <see cref="TenantWidgetDbContext"/>.
/// </summary>
public sealed class AnchorDbContext(DbContextOptions<AnchorDbContext> options)
    : DbContext(options)
{
    public DbSet<AnchorTeamEntity> Teams => Set<AnchorTeamEntity>();

    public DbSet<AnchorUserTeamEntity> UserTeams => Set<AnchorUserTeamEntity>();

    public DbSet<AnchorUserBusinessUnitEntity> UserBusinessUnits => Set<AnchorUserBusinessUnitEntity>();

    public DbSet<AnchorBusinessUnitEntity> BusinessUnits => Set<AnchorBusinessUnitEntity>();

    public DbSet<AnchorInterviewEvaluatorEntity> InterviewEvaluators => Set<AnchorInterviewEvaluatorEntity>();

    public DbSet<AnchorInterviewEntity> Interviews => Set<AnchorInterviewEntity>();

    public DbSet<AnchorUserEntity> Users => Set<AnchorUserEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AnchorTeamEntity>(entity =>
        {
            entity.ToTable("teams");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Id).HasColumnName("id");
            entity.Property(t => t.OrganizationId).HasColumnName("organization_id");
            entity.Property(t => t.BusinessUnitId).HasColumnName("business_unit_id");
            entity.Property(t => t.LeaderId).HasColumnName("leader_id");
            entity.Property(t => t.IsActive).HasColumnName("is_active");
        });

        modelBuilder.Entity<AnchorUserTeamEntity>(entity =>
        {
            entity.ToTable("user_teams");
            entity.HasKey(ut => ut.Id);
            entity.Property(ut => ut.Id).HasColumnName("id");
            entity.Property(ut => ut.UserId).HasColumnName("user_id");
            entity.Property(ut => ut.TeamId).HasColumnName("team_id");
        });

        modelBuilder.Entity<AnchorUserBusinessUnitEntity>(entity =>
        {
            entity.ToTable("user_business_units");
            entity.HasKey(ubu => ubu.Id);
            entity.Property(ubu => ubu.Id).HasColumnName("id");
            entity.Property(ubu => ubu.OrganizationId).HasColumnName("organization_id");
            entity.Property(ubu => ubu.UserId).HasColumnName("user_id");
            entity.Property(ubu => ubu.BusinessUnitId).HasColumnName("business_unit_id");
        });

        modelBuilder.Entity<AnchorBusinessUnitEntity>(entity =>
        {
            entity.ToTable("business_units");
            entity.HasKey(bu => bu.Id);
            entity.Property(bu => bu.Id).HasColumnName("id");
            entity.Property(bu => bu.OrganizationId).HasColumnName("organization_id");
            entity.Property(bu => bu.IsActive).HasColumnName("is_active");
        });

        modelBuilder.Entity<AnchorInterviewEvaluatorEntity>(entity =>
        {
            entity.ToTable("interview_evaluators");
            entity.HasKey(ie => ie.Id);
            entity.Property(ie => ie.Id).HasColumnName("id");
            entity.Property(ie => ie.InterviewId).HasColumnName("interview_id");
            entity.Property(ie => ie.UserId).HasColumnName("user_id");
        });

        modelBuilder.Entity<AnchorInterviewEntity>(entity =>
        {
            entity.ToTable("interviews");
            entity.HasKey(i => i.Id);
            entity.Property(i => i.Id).HasColumnName("id");
            entity.Property(i => i.OrganizationId).HasColumnName("organization_id");
            entity.Property(i => i.VacancyId).HasColumnName("vacancy_id");
        });

        modelBuilder.Entity<AnchorUserEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.BusinessUnitId).HasColumnName("business_unit_id");
        });
    }
}
