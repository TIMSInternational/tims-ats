using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-owned tables the FX-free dashboard reads touch (Phase-5
/// slice 23, issue #81). PR 1 mapped three — <c>subscriptions</c> (getPlanDistribution), <c>users</c>
/// (getUserGrowth's raw group-by + getRecentActivity) and <c>organizations</c> (getRecentActivity). PR 2
/// widens those three (more columns, same tables) and adds four more for the remaining six FX-free reads:
/// <c>invoices</c> (getAttentionItems, getCustomerHealth), <c>platform_invitations</c>
/// (getAttentionItems), and <c>feature_flags</c> + <c>vacancies</c> (getUpsellOpportunities'
/// <c>_count</c>s).
///
/// <para><b>NEVER wrapped in <see cref="TenantScope"/>, and that is the intended design.</b> The TS
/// procedures run on the privileged unscoped <c>db</c> client with no <c>organizationId</c> predicate: a
/// platform owner is supposed to see every tenant's subscriptions, orgs and users. So there is no
/// <c>SET LOCAL ROLE app_tenant</c> and no org GUC here, Postgres RLS restricts nothing on this path, and
/// <c>PlatformOwnerGate</c> is the entire authorization boundary. Wrapping this in a tenant scope would
/// empty the platform console rather than secure it — the same disposition
/// <see cref="Tims.Infrastructure.Audit.AuditReadDbContext"/> and the invitations context document.</para>
///
/// <para><b>Ledger: NO table moves and NO array changes, in PR 1 or PR 2.</b> Every table here was
/// already registered — <c>users</c>, <c>invoices</c>, <c>vacancies</c>, <c>feature_flags</c> and
/// <c>platform_invitations</c> in <c>efcoreReadOnly[]</c>; <c>organizations</c> and <c>subscriptions</c>
/// in <c>efcoreStranglerWrite[]</c> (slices 20/21 took write ownership of those two; mapping them
/// read-only here adds no writer and moves nothing). Rationale notes keyed
/// <c>platform_dashboard_read_slice23</c> and <c>platform_dashboard_read_slice23_pr2</c> record this,
/// because "already listed" and "listed for this reason" are different records. Note the ledger check
/// only fails a <c>ToTable</c> present in NO list, so these four additions would have passed silently —
/// the notes are a record, not a gate.</para>
/// </summary>
public sealed class PlatformDashboardReadDbContext(DbContextOptions<PlatformDashboardReadDbContext> options)
    : DbContext(options)
{
    public DbSet<DashboardSubscriptionEntity> Subscriptions => Set<DashboardSubscriptionEntity>();

    public DbSet<DashboardOrganizationEntity> Organizations => Set<DashboardOrganizationEntity>();

    public DbSet<DashboardUserEntity> Users => Set<DashboardUserEntity>();

    public DbSet<DashboardInvoiceEntity> Invoices => Set<DashboardInvoiceEntity>();

    public DbSet<DashboardInvitationEntity> Invitations => Set<DashboardInvitationEntity>();

    public DbSet<DashboardFeatureFlagEntity> FeatureFlags => Set<DashboardFeatureFlagEntity>();

    public DbSet<DashboardVacancyEntity> Vacancies => Set<DashboardVacancyEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DashboardSubscriptionEntity>(entity =>
        {
            entity.ToTable("subscriptions");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.Plan).HasColumnName("plan");
            entity.Property(s => s.Status).HasColumnName("status");
            entity.Property(s => s.TrialEndsAt).HasColumnName("trial_ends_at").HasColumnType("timestamp");
            entity.Property(s => s.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
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
            //
            // It is ALSO what makes a DateTime filter bindable at all (PR 2): with the store type
            // declared, EF sends the parameter as NpgsqlDbType.Timestamp, and Npgsql then REJECTS a
            // DateTimeKind.Utc value outright ("Cannot write DateTime with Kind=Utc to PostgreSQL type
            // 'timestamp without time zone'"). Every repository below therefore re-kinds its bounds to
            // Unspecified before use — the mapped-column sibling of slice 23's TRAP 10, which was the
            // same clash on a raw-SQL hole.
            entity.Property(o => o.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(o => o.Slug).HasColumnName("slug");
            entity.Property(o => o.Domain).HasColumnName("domain");
            entity.Property(o => o.IsActive).HasColumnName("is_active");
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
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.IsActive).HasColumnName("is_active");
            entity.Property(u => u.LastLoginAt).HasColumnName("last_login_at").HasColumnType("timestamp");
            entity.Property(u => u.Avatar).HasColumnName("avatar");
        });

        modelBuilder.Entity<DashboardInvoiceEntity>(entity =>
        {
            entity.ToTable("invoices");
            entity.HasKey(i => i.Id);
            entity.Property(i => i.Id).HasColumnName("id");
            entity.Property(i => i.OrganizationId).HasColumnName("organization_id");
            entity.Property(i => i.Amount).HasColumnName("amount");
            entity.Property(i => i.Currency).HasColumnName("currency");
            entity.Property(i => i.Status).HasColumnName("status");
            entity.Property(i => i.DueDate).HasColumnName("due_date").HasColumnType("timestamp");
            entity.Property(i => i.PaidAt).HasColumnName("paid_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<DashboardInvitationEntity>(entity =>
        {
            entity.ToTable("platform_invitations");
            entity.HasKey(i => i.Id);
            entity.Property(i => i.Id).HasColumnName("id");
            entity.Property(i => i.Email).HasColumnName("email");
            entity.Property(i => i.Status).HasColumnName("status");
            entity.Property(i => i.OrganizationId).HasColumnName("organization_id");
            entity.Property(i => i.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<DashboardFeatureFlagEntity>(entity =>
        {
            entity.ToTable("feature_flags");
            entity.HasKey(f => f.Id);
            entity.Property(f => f.Id).HasColumnName("id");
            entity.Property(f => f.OrganizationId).HasColumnName("organization_id");
        });

        modelBuilder.Entity<DashboardVacancyEntity>(entity =>
        {
            entity.ToTable("vacancies");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.OrganizationId).HasColumnName("organization_id");
        });

        // UserGrowthCountRow and ActivePlanMonthCountRow are deliberately NOT in the model — they are
        // materialised by Database.SqlQuery<T>() as unmapped types, so registering either would map a
        // phantom table.
    }
}
