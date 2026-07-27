using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.AccessReview;

/// <summary>
/// ONE privileged EF context covering both the access-review REPORT reads (users/roles/user_roles/
/// role_permissions/permissions/organizations — Prisma-owned, `efcoreReadOnly` since Phase 2) and the
/// `access_reviews` read+write (Prisma-owned until this slice ships; moves to `efcoreStranglerWrite`
/// in the table-ownership ledger, Task 8). NEVER wrapped in <see cref="Tims.Infrastructure.TenantScope"/>
/// — a platform owner isn't a tenant member, so there's no `SET LOCAL ROLE app_tenant` + org GUC to
/// wrap either path in (see the Slice-18 design doc's "Why this is a new pattern" section for why one
/// context, not a read/write split, is correct here — unlike other Phase-5 domains, there is no
/// scoping-boundary difference between the two paths to isolate).
///
/// NO navigation properties on the read entities (matches <see cref="Tims.Infrastructure.Audit.AuditReadDbContext"/>'s
/// convention, not <see cref="Tims.Infrastructure.Identity.IdentityDbContext"/>'s) — Task 4's repository
/// does batched lookups (fetch users, then user_roles for those user ids, then roles for those role
/// ids, then role_permissions+permissions for those role ids), never one deep nested query.
///
/// Local entities carry ONLY the columns access-review needs, which is a RICHER column set than
/// <see cref="Tims.Infrastructure.Identity.IdentityDbContext"/>'s minimal principal-resolution
/// mapping (that context is reserved for the hot pre-tenant-resolution path — do not extend it).
/// </summary>
public sealed class AccessReviewDbContext(DbContextOptions<AccessReviewDbContext> options) : DbContext(options)
{
    public DbSet<AccessReviewUserEntity> Users => Set<AccessReviewUserEntity>();

    public DbSet<AccessReviewRoleEntity> Roles => Set<AccessReviewRoleEntity>();

    public DbSet<AccessReviewUserRoleEntity> UserRoles => Set<AccessReviewUserRoleEntity>();

    public DbSet<AccessReviewRolePermissionEntity> RolePermissions => Set<AccessReviewRolePermissionEntity>();

    public DbSet<AccessReviewPermissionEntity> Permissions => Set<AccessReviewPermissionEntity>();

    public DbSet<AccessReviewOrganizationEntity> Organizations => Set<AccessReviewOrganizationEntity>();

    public DbSet<AccessReviewEntity> AccessReviews => Set<AccessReviewEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AccessReviewUserEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Email).HasColumnName("email");
            entity.Property(u => u.IsActive).HasColumnName("is_active");
            entity.Property(u => u.DeletedAt).HasColumnName("deleted_at");
            entity.Property(u => u.LastLoginAt).HasColumnName("last_login_at");
            entity.Property(u => u.IsPlatformOwner).HasColumnName("is_platform_owner");
            entity.Property(u => u.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<AccessReviewRoleEntity>(entity =>
        {
            entity.ToTable("roles");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.Slug).HasColumnName("slug");
            entity.Property(r => r.Name).HasColumnName("name");
            entity.Property(r => r.IsActive).HasColumnName("is_active");
        });

        modelBuilder.Entity<AccessReviewUserRoleEntity>(entity =>
        {
            entity.ToTable("user_roles");
            entity.HasKey(ur => ur.Id);
            entity.Property(ur => ur.Id).HasColumnName("id");
            entity.Property(ur => ur.UserId).HasColumnName("user_id");
            entity.Property(ur => ur.RoleId).HasColumnName("role_id");
            entity.Property(ur => ur.AssignedAt).HasColumnName("assigned_at");
            entity.Property(ur => ur.AssignedBy).HasColumnName("assigned_by");
            entity.Property(ur => ur.CompanyScope).HasColumnName("company_scope");
            entity.Property(ur => ur.UnitScope).HasColumnName("unit_scope");
            entity.Property(ur => ur.ExpiresAt).HasColumnName("expires_at");
        });

        modelBuilder.Entity<AccessReviewRolePermissionEntity>(entity =>
        {
            entity.ToTable("role_permissions");
            entity.HasKey(rp => rp.Id);
            entity.Property(rp => rp.Id).HasColumnName("id");
            entity.Property(rp => rp.RoleId).HasColumnName("role_id");
            entity.Property(rp => rp.PermissionId).HasColumnName("permission_id");
            entity.Property(rp => rp.Scope).HasColumnName("scope");
        });

        modelBuilder.Entity<AccessReviewPermissionEntity>(entity =>
        {
            entity.ToTable("permissions");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.Module).HasColumnName("module");
            entity.Property(p => p.Action).HasColumnName("action");
        });

        modelBuilder.Entity<AccessReviewOrganizationEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
        });

        modelBuilder.Entity<AccessReviewEntity>(entity =>
        {
            entity.ToTable("access_reviews");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.ReviewerId).HasColumnName("reviewer_id");
            entity.Property(a => a.ReviewedAt).HasColumnName("reviewed_at").HasDefaultValueSql("now()").ValueGeneratedOnAdd();
            entity.Property(a => a.UserCount).HasColumnName("user_count");
            entity.Property(a => a.PrivilegedCount).HasColumnName("privileged_count");
            entity.Property(a => a.StaleCount).HasColumnName("stale_count");
            entity.Property(a => a.DeprovisionGapCount).HasColumnName("deprovision_gap_count");
            entity.Property(a => a.ExpiredGapCount).HasColumnName("expired_gap_count");
            entity.Property(a => a.Notes).HasColumnName("notes").HasMaxLength(2000);
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()").ValueGeneratedOnAdd();
        });
    }
}

public sealed class AccessReviewUserEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime? DeletedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public bool IsPlatformOwner { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class AccessReviewRoleEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; }
}

public sealed class AccessReviewUserRoleEntity
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid RoleId { get; set; }
    public DateTime AssignedAt { get; set; }
    public Guid? AssignedBy { get; set; }
    public Guid? CompanyScope { get; set; }
    public Guid? UnitScope { get; set; }
    public DateTime? ExpiresAt { get; set; }
}

public sealed class AccessReviewRolePermissionEntity
{
    public Guid Id { get; set; }
    public Guid RoleId { get; set; }
    public Guid PermissionId { get; set; }
    public string Scope { get; set; } = string.Empty;
}

public sealed class AccessReviewPermissionEntity
{
    public Guid Id { get; set; }
    public string Module { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
}

public sealed class AccessReviewOrganizationEntity
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
}

/// <summary>Full CRUD mapping of `access_reviews` — the ONE table this slice writes to (a history
/// table, no unique constraint: multiple attestations per org over time are expected).</summary>
public sealed class AccessReviewEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid ReviewerId { get; set; }
    public DateTime ReviewedAt { get; set; }
    public int UserCount { get; set; }
    public int PrivilegedCount { get; set; }
    public int StaleCount { get; set; }
    public int DeprovisionGapCount { get; set; }
    public int ExpiredGapCount { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
}
