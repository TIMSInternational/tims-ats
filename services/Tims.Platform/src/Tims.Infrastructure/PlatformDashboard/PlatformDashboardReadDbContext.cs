using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// READ-ONLY EF Core context over the three Prisma-owned tables the FX-free dashboard reads touch
/// (Phase-5 slice 23, issue #81, PR 1 of 3): <c>subscriptions</c> (getPlanDistribution),
/// <c>users</c> (getUserGrowth's raw group-by + getRecentActivity) and <c>organizations</c>
/// (getRecentActivity).
///
/// <para><b>NEVER wrapped in <see cref="TenantScope"/>, and that is the intended design.</b> The TS
/// procedures run on the privileged unscoped <c>db</c> client with no <c>organizationId</c> predicate: a
/// platform owner is supposed to see every tenant's subscriptions, orgs and users. So there is no
/// <c>SET LOCAL ROLE app_tenant</c> and no org GUC here, Postgres RLS restricts nothing on this path, and
/// <c>PlatformOwnerGate</c> is the entire authorization boundary. Wrapping this in a tenant scope would
/// empty the platform console rather than secure it — the same disposition
/// <see cref="Tims.Infrastructure.Audit.AuditReadDbContext"/> and the invitations context document.</para>
///
/// <para><b>Ledger: NO table moves and NO array changes.</b> All three tables were already registered —
/// <c>users</c> in <c>efcoreReadOnly[]</c>, <c>organizations</c> and <c>subscriptions</c> in
/// <c>efcoreStranglerWrite[]</c> (slices 20/21 took write ownership of those two; mapping them read-only
/// here adds no writer and moves nothing). A rationale note keyed
/// <c>platform_dashboard_read_slice23</c> records this, because "already listed" and "listed for this
/// reason" are different records.</para>
/// </summary>
public sealed class PlatformDashboardReadDbContext(DbContextOptions<PlatformDashboardReadDbContext> options)
    : DbContext(options)
{
    public DbSet<DashboardSubscriptionEntity> Subscriptions => Set<DashboardSubscriptionEntity>();

    public DbSet<DashboardOrganizationEntity> Organizations => Set<DashboardOrganizationEntity>();

    public DbSet<DashboardUserEntity> Users => Set<DashboardUserEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DashboardSubscriptionEntity>(entity =>
        {
            entity.ToTable("subscriptions");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.Plan).HasColumnName("plan");
        });

        modelBuilder.Entity<DashboardOrganizationEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
            entity.Property(o => o.Plan).HasColumnName("plan");
            // `timestamp without time zone`, per packages/db/prisma/schema — stated explicitly so Npgsql
            // yields DateTimeKind.Unspecified and the NodeIsoDateTimeConverter on RecentActivityItem emits
            // the trailing `Z` that superjson's toISOString() always emits (TRAP 6).
            entity.Property(o => o.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<DashboardUserEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Email).HasColumnName("email");
            entity.Property(u => u.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(u => u.IsPlatformOwner).HasColumnName("is_platform_owner");
        });

        // UserGrowthCountRow is deliberately NOT in the model — it is materialised by
        // Database.SqlQuery<T>() as an unmapped type, so registering it would map a phantom table.
    }
}
