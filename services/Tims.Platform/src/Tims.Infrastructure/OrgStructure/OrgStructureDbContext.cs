using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.OrgStructure;

/// <summary>
/// Tenant org-structure context over Prisma-OWNED tables (strangler writes, no DDL): companies (read),
/// business_units, teams, user_teams, user_business_units, users (read + business_unit_id update) and the
/// append-only audit_logs. Entities map only the columns this slice reads; writes go through
/// parameterized SQL so Prisma-side defaults (settings, created_at) stay authoritative. Every unit of work
/// runs inside <see cref="TenantScope"/> — RLS applies on top of the explicit organization predicates.
/// </summary>
public sealed class OrgStructureDbContext(DbContextOptions<OrgStructureDbContext> options) : DbContext(options)
{
    public DbSet<OrgCompanyEntity> Companies => Set<OrgCompanyEntity>();

    public DbSet<OrgBusinessUnitEntity> BusinessUnits => Set<OrgBusinessUnitEntity>();

    public DbSet<OrgTeamEntity> Teams => Set<OrgTeamEntity>();

    public DbSet<OrgUserTeamEntity> UserTeams => Set<OrgUserTeamEntity>();

    public DbSet<OrgUserBusinessUnitEntity> UserBusinessUnits => Set<OrgUserBusinessUnitEntity>();

    public DbSet<OrgUserEntity> Users => Set<OrgUserEntity>();

    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<OrgCompanyEntity>(entity =>
        {
            entity.ToTable("companies");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.OrganizationId).HasColumnName("organization_id");
            entity.Property(row => row.Name).HasColumnName("name");
            entity.Property(row => row.IsActive).HasColumnName("is_active");
        });
        modelBuilder.Entity<OrgBusinessUnitEntity>(entity =>
        {
            entity.ToTable("business_units");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.OrganizationId).HasColumnName("organization_id");
            entity.Property(row => row.CompanyId).HasColumnName("company_id");
            entity.Property(row => row.Name).HasColumnName("name");
            entity.Property(row => row.Code).HasColumnName("code");
            entity.Property(row => row.IsActive).HasColumnName("is_active");
        });
        modelBuilder.Entity<OrgTeamEntity>(entity =>
        {
            entity.ToTable("teams");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.OrganizationId).HasColumnName("organization_id");
            entity.Property(row => row.BusinessUnitId).HasColumnName("business_unit_id");
            entity.Property(row => row.Name).HasColumnName("name");
            entity.Property(row => row.LeaderId).HasColumnName("leader_id");
            entity.Property(row => row.IsActive).HasColumnName("is_active");
        });
        modelBuilder.Entity<OrgUserTeamEntity>(entity =>
        {
            entity.ToTable("user_teams");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.UserId).HasColumnName("user_id");
            entity.Property(row => row.TeamId).HasColumnName("team_id");
            entity.Property(row => row.Role).HasColumnName("role");
        });
        modelBuilder.Entity<OrgUserBusinessUnitEntity>(entity =>
        {
            entity.ToTable("user_business_units");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.OrganizationId).HasColumnName("organization_id");
            entity.Property(row => row.UserId).HasColumnName("user_id");
            entity.Property(row => row.BusinessUnitId).HasColumnName("business_unit_id");
        });
        modelBuilder.Entity<OrgUserEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.OrganizationId).HasColumnName("organization_id");
            entity.Property(row => row.FirstName).HasColumnName("first_name");
            entity.Property(row => row.LastName).HasColumnName("last_name");
            entity.Property(row => row.Email).HasColumnName("email");
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.Property(row => row.DeletedAt).HasColumnName("deleted_at");
            entity.Property(row => row.BusinessUnitId).HasColumnName("business_unit_id");
        });
        modelBuilder.ConfigureAuditLogs();
    }
}

public sealed class OrgCompanyEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; }
}

public sealed class OrgBusinessUnitEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Code { get; set; }
    public bool IsActive { get; set; }
}

public sealed class OrgTeamEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid BusinessUnitId { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid? LeaderId { get; set; }
    public bool IsActive { get; set; }
}

public sealed class OrgUserTeamEntity
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid TeamId { get; set; }
    public string Role { get; set; } = string.Empty;
}

public sealed class OrgUserBusinessUnitEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public Guid BusinessUnitId { get; set; }
}

public sealed class OrgUserEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime? DeletedAt { get; set; }
    public Guid? BusinessUnitId { get; set; }
}
