using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.People;

/// <summary>
/// READ-ONLY tenant directory context over the Prisma-owned identity tables (users, user_roles, roles,
/// role_permissions, permissions). Every query runs inside <see cref="TenantScope"/>, so the live
/// tenant_isolation policies apply on top of the explicit organization predicates. Never written.
/// </summary>
public sealed class AssignablePeopleDbContext(DbContextOptions<AssignablePeopleDbContext> options) : DbContext(options)
{
    public DbSet<DirectoryUser> Users => Set<DirectoryUser>();

    public DbSet<DirectoryUserRole> UserRoles => Set<DirectoryUserRole>();

    public DbSet<DirectoryRole> Roles => Set<DirectoryRole>();

    public DbSet<DirectoryRolePermission> RolePermissions => Set<DirectoryRolePermission>();

    public DbSet<DirectoryPermission> Permissions => Set<DirectoryPermission>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DirectoryUser>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.OrganizationId).HasColumnName("organization_id");
            entity.Property(row => row.FirstName).HasColumnName("first_name");
            entity.Property(row => row.LastName).HasColumnName("last_name");
            entity.Property(row => row.Email).HasColumnName("email");
            entity.Property(row => row.Avatar).HasColumnName("avatar");
            entity.Property(row => row.IsActive).HasColumnName("is_active");
            entity.Property(row => row.DeletedAt).HasColumnName("deleted_at");
        });
        modelBuilder.Entity<DirectoryUserRole>(entity =>
        {
            entity.ToTable("user_roles");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.UserId).HasColumnName("user_id");
            entity.Property(row => row.RoleId).HasColumnName("role_id");
        });
        modelBuilder.Entity<DirectoryRole>(entity =>
        {
            entity.ToTable("roles");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.OrganizationId).HasColumnName("organization_id");
            entity.Property(row => row.Slug).HasColumnName("slug");
            entity.Property(row => row.IsActive).HasColumnName("is_active");
        });
        modelBuilder.Entity<DirectoryRolePermission>(entity =>
        {
            entity.ToTable("role_permissions");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.RoleId).HasColumnName("role_id");
            entity.Property(row => row.PermissionId).HasColumnName("permission_id");
        });
        modelBuilder.Entity<DirectoryPermission>(entity =>
        {
            entity.ToTable("permissions");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Module).HasColumnName("module");
            entity.Property(row => row.Action).HasColumnName("action");
        });
    }
}

public sealed class DirectoryUser
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? Avatar { get; set; }
    public bool IsActive { get; set; }
    public DateTime? DeletedAt { get; set; }
}

public sealed class DirectoryUserRole
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid RoleId { get; set; }
}

public sealed class DirectoryRole
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Slug { get; set; } = string.Empty;
    public bool IsActive { get; set; }
}

public sealed class DirectoryRolePermission
{
    public Guid Id { get; set; }
    public Guid RoleId { get; set; }
    public Guid PermissionId { get; set; }
}

public sealed class DirectoryPermission
{
    public Guid Id { get; set; }
    public string Module { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
}
