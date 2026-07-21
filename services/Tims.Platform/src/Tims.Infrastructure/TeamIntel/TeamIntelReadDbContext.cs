using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.TeamIntel;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED team-intel tables (efcoreReadOnly in
/// docs/architecture/table-ownership.md): <c>teams</c>, <c>user_teams</c>, <c>users</c>,
/// <c>business_units</c>, <c>vacancies</c>, <c>okrs</c>. Every query is <c>.AsNoTracking()</c> and
/// <c>SaveChanges</c> is never called. Like the reporting/anchor read contexts it runs exclusively UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so Postgres RLS isolates the org for
/// every query, with an explicit <c>organization_id</c> filter for defense-in-depth.
///
/// No native enums here (the columns read are plain Strings/timestamps), so this context needs no
/// NpgsqlDataSource with EnableUnmappedTypes (unlike billing). Prisma DateTime columns are
/// <c>timestamp(3) without time zone</c> — pinned <c>HasColumnType("timestamp")</c> so Npgsql reads them
/// as Unspecified-kind wall-clock UTC, matching the Prisma-owned columns exactly. <c>teams.settings</c> is
/// jsonb, read as raw text and passed through on the profile read.
/// </summary>
public sealed class TeamIntelReadDbContext(DbContextOptions<TeamIntelReadDbContext> options)
    : DbContext(options)
{
    public DbSet<TeamReadEntity> Teams => Set<TeamReadEntity>();

    public DbSet<UserTeamReadEntity> UserTeams => Set<UserTeamReadEntity>();

    public DbSet<TeamIntelUserReadEntity> Users => Set<TeamIntelUserReadEntity>();

    public DbSet<TeamBusinessUnitReadEntity> BusinessUnits => Set<TeamBusinessUnitReadEntity>();

    public DbSet<TeamVacancyReadEntity> Vacancies => Set<TeamVacancyReadEntity>();

    public DbSet<TeamOkrReadEntity> Okrs => Set<TeamOkrReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TeamReadEntity>(entity =>
        {
            entity.ToTable("teams");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Id).HasColumnName("id");
            entity.Property(t => t.OrganizationId).HasColumnName("organization_id");
            entity.Property(t => t.BusinessUnitId).HasColumnName("business_unit_id");
            entity.Property(t => t.Name).HasColumnName("name");
            entity.Property(t => t.LeaderId).HasColumnName("leader_id");
            entity.Property(t => t.Settings).HasColumnName("settings").HasColumnType("jsonb");
            entity.Property(t => t.IsActive).HasColumnName("is_active");
            entity.Property(t => t.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(t => t.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<UserTeamReadEntity>(entity =>
        {
            entity.ToTable("user_teams");
            entity.HasKey(ut => ut.Id);
            entity.Property(ut => ut.Id).HasColumnName("id");
            entity.Property(ut => ut.UserId).HasColumnName("user_id");
            entity.Property(ut => ut.TeamId).HasColumnName("team_id");
            entity.Property(ut => ut.Role).HasColumnName("role");
            entity.Property(ut => ut.JoinedAt).HasColumnName("joined_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<TeamIntelUserReadEntity>(entity =>
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
            entity.Property(u => u.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(u => u.IsActive).HasColumnName("is_active");
        });

        modelBuilder.Entity<TeamBusinessUnitReadEntity>(entity =>
        {
            entity.ToTable("business_units");
            entity.HasKey(bu => bu.Id);
            entity.Property(bu => bu.Id).HasColumnName("id");
            entity.Property(bu => bu.OrganizationId).HasColumnName("organization_id");
            entity.Property(bu => bu.Name).HasColumnName("name");
            entity.Property(bu => bu.CompanyId).HasColumnName("company_id");
            entity.Property(bu => bu.IsActive).HasColumnName("is_active");
        });

        modelBuilder.Entity<TeamVacancyReadEntity>(entity =>
        {
            entity.ToTable("vacancies");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.OrganizationId).HasColumnName("organization_id");
            entity.Property(v => v.TeamId).HasColumnName("team_id");
        });

        modelBuilder.Entity<TeamOkrReadEntity>(entity =>
        {
            entity.ToTable("okrs");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.OrganizationId).HasColumnName("organization_id");
            entity.Property(o => o.TeamId).HasColumnName("team_id");
        });
    }
}
