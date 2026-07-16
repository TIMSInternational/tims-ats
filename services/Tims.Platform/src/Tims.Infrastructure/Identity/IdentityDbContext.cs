using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Identity;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED identity tables (`users`, `user_roles`,
/// `roles`, plus `api_keys` + `organizations` for external `tims_` key auth, and `candidates` for
/// the portal-candidate principal; efcoreReadOnly in docs/architecture/table-ownership.md). It maps
/// only the columns the pre-tenant principal resolution needs and MUST NEVER write them — every
/// query goes through
/// <c>.AsNoTracking()</c> and <c>SaveChanges</c> is never called.
///
/// This is the PRIVILEGED / pre-tenant path (resolving WHICH org a user belongs to before any
/// tenant context exists), so it deliberately does NOT use the Phase-1 <c>TenantScope</c> /
/// <c>SET LOCAL ROLE app_tenant</c> RLS mechanism — a plain context on the owner connection is
/// correct. Column mapping mirrors <see cref="TenantWidgetDbContext"/>'s explicit
/// ToTable/HasColumnName/HasKey style (snake_case ↔ PascalCase).
/// </summary>
public sealed class IdentityDbContext(DbContextOptions<IdentityDbContext> options)
    : DbContext(options)
{
    public DbSet<UserEntity> Users => Set<UserEntity>();

    public DbSet<UserRoleEntity> UserRoles => Set<UserRoleEntity>();

    public DbSet<RoleEntity> Roles => Set<RoleEntity>();

    public DbSet<ApiKeyEntity> ApiKeys => Set<ApiKeyEntity>();

    public DbSet<OrganizationEntity> Organizations => Set<OrganizationEntity>();

    public DbSet<PermissionEntity> Permissions => Set<PermissionEntity>();

    public DbSet<RolePermissionEntity> RolePermissions => Set<RolePermissionEntity>();

    public DbSet<CandidateEntity> Candidates => Set<CandidateEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<UserEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.SupabaseUserId).HasColumnName("supabase_user_id");
            entity.Property(u => u.Email).HasColumnName("email");
            entity.Property(u => u.IsPlatformOwner).HasColumnName("is_platform_owner");
            entity.Property(u => u.IsActive).HasColumnName("is_active");

            entity.HasMany(u => u.UserRoles)
                .WithOne(ur => ur.User)
                .HasForeignKey(ur => ur.UserId);
        });

        modelBuilder.Entity<UserRoleEntity>(entity =>
        {
            entity.ToTable("user_roles");
            entity.HasKey(ur => ur.Id);
            entity.Property(ur => ur.Id).HasColumnName("id");
            entity.Property(ur => ur.UserId).HasColumnName("user_id");
            entity.Property(ur => ur.RoleId).HasColumnName("role_id");

            entity.HasOne(ur => ur.Role)
                .WithMany()
                .HasForeignKey(ur => ur.RoleId);
        });

        modelBuilder.Entity<RoleEntity>(entity =>
        {
            entity.ToTable("roles");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.Slug).HasColumnName("slug");
        });

        modelBuilder.Entity<PermissionEntity>(entity =>
        {
            entity.ToTable("permissions");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.Module).HasColumnName("module");
            entity.Property(p => p.Action).HasColumnName("action");
        });

        modelBuilder.Entity<RolePermissionEntity>(entity =>
        {
            entity.ToTable("role_permissions");
            entity.HasKey(rp => rp.Id);
            entity.Property(rp => rp.Id).HasColumnName("id");
            entity.Property(rp => rp.RoleId).HasColumnName("role_id");
            entity.Property(rp => rp.PermissionId).HasColumnName("permission_id");
            entity.Property(rp => rp.Scope).HasColumnName("scope");
        });

        modelBuilder.Entity<ApiKeyEntity>(entity =>
        {
            entity.ToTable("api_keys");
            entity.HasKey(k => k.Id);
            entity.Property(k => k.Id).HasColumnName("id");
            entity.Property(k => k.OrganizationId).HasColumnName("organization_id");
            entity.Property(k => k.KeyHash).HasColumnName("key_hash");
            // Read the jsonb `scopes` column as raw JSON text; parsed fail-closed in the resolver.
            entity.Property(k => k.Scopes).HasColumnName("scopes").HasColumnType("jsonb");
            entity.Property(k => k.RevokedAt).HasColumnName("revoked_at");
            entity.Property(k => k.ExpiresAt).HasColumnName("expires_at");
        });

        modelBuilder.Entity<OrganizationEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.IsActive).HasColumnName("is_active");
            entity.Property(o => o.DeletedAt).HasColumnName("deleted_at");
        });

        modelBuilder.Entity<CandidateEntity>(entity =>
        {
            entity.ToTable("candidates");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.Email).HasColumnName("email");
            entity.Property(c => c.IsActive).HasColumnName("is_active");
            entity.Property(c => c.DeletedAt).HasColumnName("deleted_at");
        });
    }
}
