using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.PlatformOrganizations;

/// <summary>
/// The privileged, CROSS-ORG read context for the platform-owner organizations surface
/// (Phase-5 slice 19, issue #76).
///
/// <para><b>NEVER wrapped in <see cref="Tims.Infrastructure.TenantScope"/>.</b> A platform owner is not
/// a tenant member, so there is no <c>SET LOCAL ROLE app_tenant</c> + org GUC to wrap — the same
/// disposition as <c>AuditReadDbContext</c>, stated at <c>Program.cs:448</c>. The TS side is identical:
/// <c>routers/platform/organizations.ts</c> imports the unscoped <c>db</c>, never <c>tenantDb</c>.</para>
///
/// <para><b>Consequence worth stating plainly.</b> RLS does not restrict this reader, and on production
/// the connecting role is BYPASSRLS regardless (see the prod-roles reference). So
/// <c>PlatformOwnerGate</c> is the ENTIRE authorization boundary for this surface. There is no second
/// line of defence, which is why the gate is applied per-endpoint rather than assumed.</para>
///
/// <para>All tables are Prisma-OWNED and mapped read-only (<c>efcoreReadOnly</c>): this slice adds no
/// writer and moves nothing in <c>docs/architecture/table-ownership.md</c>.</para>
/// </summary>
public sealed class PlatformOrganizationsReadDbContext(DbContextOptions<PlatformOrganizationsReadDbContext> options)
    : DbContext(options)
{
    public DbSet<PlatformOrganizationEntity> Organizations => Set<PlatformOrganizationEntity>();

    public DbSet<PlatformOrganizationSubscriptionEntity> Subscriptions => Set<PlatformOrganizationSubscriptionEntity>();

    public DbSet<PlatformOrganizationUserEntity> Users => Set<PlatformOrganizationUserEntity>();

    public DbSet<PlatformOrganizationInvoiceEntity> Invoices => Set<PlatformOrganizationInvoiceEntity>();

    public DbSet<PlatformOrganizationVacancyEntity> Vacancies => Set<PlatformOrganizationVacancyEntity>();

    public DbSet<PlatformOrganizationCompanyEntity> Companies => Set<PlatformOrganizationCompanyEntity>();

    public DbSet<PlatformOrganizationBusinessUnitEntity> BusinessUnits => Set<PlatformOrganizationBusinessUnitEntity>();

    public DbSet<PlatformOrganizationTeamEntity> Teams => Set<PlatformOrganizationTeamEntity>();

    public DbSet<PlatformOrganizationFeatureFlagEntity> FeatureFlags => Set<PlatformOrganizationFeatureFlagEntity>();

    public DbSet<PlatformOrganizationBillingProfileEntity> BillingProfiles => Set<PlatformOrganizationBillingProfileEntity>();

    public DbSet<PlatformOrganizationInvitationEntity> Invitations => Set<PlatformOrganizationInvitationEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PlatformOrganizationEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
            entity.Property(o => o.Slug).HasColumnName("slug");
            entity.Property(o => o.Domain).HasColumnName("domain");
            entity.Property(o => o.Logo).HasColumnName("logo");
            entity.Property(o => o.Plan).HasColumnName("plan");
            entity.Property(o => o.Settings).HasColumnName("settings").HasColumnType("jsonb");
            entity.Property(o => o.BillingEmail).HasColumnName("billing_email");
            entity.Property(o => o.IsActive).HasColumnName("is_active");
            entity.Property(o => o.CreatedAt).HasColumnName("created_at");
            entity.Property(o => o.UpdatedAt).HasColumnName("updated_at");
            entity.Property(o => o.DeletedAt).HasColumnName("deleted_at");
        });

        modelBuilder.Entity<PlatformOrganizationSubscriptionEntity>(entity =>
        {
            entity.ToTable("subscriptions");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.StripeCustomerId).HasColumnName("stripe_customer_id");
            entity.Property(s => s.StripeSubscriptionId).HasColumnName("stripe_subscription_id");
            entity.Property(s => s.Plan).HasColumnName("plan");
            entity.Property(s => s.Status).HasColumnName("status");
            entity.Property(s => s.CurrentPeriodStart).HasColumnName("current_period_start");
            entity.Property(s => s.CurrentPeriodEnd).HasColumnName("current_period_end");
            entity.Property(s => s.TrialEndsAt).HasColumnName("trial_ends_at");
            entity.Property(s => s.CancelledAt).HasColumnName("cancelled_at");
            entity.Property(s => s.LastStripeEventAt).HasColumnName("last_stripe_event_at");
            entity.Property(s => s.CreatedAt).HasColumnName("created_at");
            entity.Property(s => s.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<PlatformOrganizationUserEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Email).HasColumnName("email");
            entity.Property(u => u.JobTitle).HasColumnName("job_title");
            entity.Property(u => u.IsActive).HasColumnName("is_active");
            entity.Property(u => u.LastLoginAt).HasColumnName("last_login_at");
            entity.Property(u => u.IsPlatformOwner).HasColumnName("is_platform_owner");
            entity.Property(u => u.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<PlatformOrganizationInvoiceEntity>(entity =>
        {
            entity.ToTable("invoices");
            entity.HasKey(i => i.Id);
            entity.Property(i => i.Id).HasColumnName("id");
            entity.Property(i => i.OrganizationId).HasColumnName("organization_id");
            entity.Property(i => i.Status).HasColumnName("status");
            entity.Property(i => i.DueDate).HasColumnName("due_date");
        });

        modelBuilder.Entity<PlatformOrganizationVacancyEntity>(entity =>
        {
            entity.ToTable("vacancies");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.OrganizationId).HasColumnName("organization_id");
        });

        modelBuilder.Entity<PlatformOrganizationCompanyEntity>(entity =>
        {
            entity.ToTable("companies");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.Name).HasColumnName("name");
            entity.Property(c => c.Country).HasColumnName("country");
            entity.Property(c => c.Currency).HasColumnName("currency");
            entity.Property(c => c.Timezone).HasColumnName("timezone");
            entity.Property(c => c.Language).HasColumnName("language");
            entity.Property(c => c.LegalName).HasColumnName("legal_name");
            entity.Property(c => c.TaxId).HasColumnName("tax_id");
            entity.Property(c => c.Settings).HasColumnName("settings").HasColumnType("jsonb");
            entity.Property(c => c.IsActive).HasColumnName("is_active");
            entity.Property(c => c.CreatedAt).HasColumnName("created_at");
            entity.Property(c => c.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<PlatformOrganizationBusinessUnitEntity>(entity =>
        {
            entity.ToTable("business_units");
            entity.HasKey(b => b.Id);
            entity.Property(b => b.Id).HasColumnName("id");
            entity.Property(b => b.OrganizationId).HasColumnName("organization_id");
            entity.Property(b => b.CompanyId).HasColumnName("company_id");
            entity.Property(b => b.Name).HasColumnName("name");
            entity.Property(b => b.Code).HasColumnName("code");
            entity.Property(b => b.ParentId).HasColumnName("parent_id");
            entity.Property(b => b.Settings).HasColumnName("settings").HasColumnType("jsonb");
            entity.Property(b => b.IsActive).HasColumnName("is_active");
            entity.Property(b => b.CreatedAt).HasColumnName("created_at");
            entity.Property(b => b.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<PlatformOrganizationTeamEntity>(entity =>
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
            entity.Property(t => t.CreatedAt).HasColumnName("created_at");
            entity.Property(t => t.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<PlatformOrganizationFeatureFlagEntity>(entity =>
        {
            entity.ToTable("feature_flags");
            entity.HasKey(f => f.Id);
            entity.Property(f => f.Id).HasColumnName("id");
            entity.Property(f => f.OrganizationId).HasColumnName("organization_id");
            entity.Property(f => f.Key).HasColumnName("key");
            entity.Property(f => f.Enabled).HasColumnName("enabled");
            entity.Property(f => f.Payload).HasColumnName("payload").HasColumnType("jsonb");
            entity.Property(f => f.CreatedAt).HasColumnName("created_at");
            entity.Property(f => f.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<PlatformOrganizationBillingProfileEntity>(entity =>
        {
            entity.ToTable("billing_profiles");
            entity.HasKey(b => b.Id);
            entity.Property(b => b.Id).HasColumnName("id");
            entity.Property(b => b.OrganizationId).HasColumnName("organization_id");
            entity.Property(b => b.CompanyName).HasColumnName("company_name");
            entity.Property(b => b.TaxId).HasColumnName("tax_id");
            entity.Property(b => b.Address).HasColumnName("address");
            entity.Property(b => b.City).HasColumnName("city");
            entity.Property(b => b.State).HasColumnName("state");
            entity.Property(b => b.Country).HasColumnName("country");
            entity.Property(b => b.ZipCode).HasColumnName("zip_code");
            entity.Property(b => b.BillingEmail).HasColumnName("billing_email");
            entity.Property(b => b.BillingPhone).HasColumnName("billing_phone");
            entity.Property(b => b.CreatedAt).HasColumnName("created_at");
            entity.Property(b => b.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<PlatformOrganizationInvitationEntity>(entity =>
        {
            entity.ToTable("platform_invitations");
            entity.HasKey(i => i.Id);
            entity.Property(i => i.Id).HasColumnName("id");
            entity.Property(i => i.OrganizationId).HasColumnName("organization_id");
            entity.Property(i => i.Status).HasColumnName("status");
        });
    }
}
