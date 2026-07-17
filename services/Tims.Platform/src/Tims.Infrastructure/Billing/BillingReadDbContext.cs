using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED <c>invoices</c> ⋈ <c>subscriptions</c> tables
/// (efcoreReadOnly in docs/architecture/table-ownership.md). Maps the full invoice/subscription models the
/// billing read surface returns and MUST NEVER write them (every query is <c>.AsNoTracking()</c>;
/// <c>SaveChanges</c> is never called).
///
/// Like <see cref="Tims.Infrastructure.ExternalVendor.ExternalAssessmentDbContext"/> it runs exclusively
/// UNDER <see cref="TenantScope"/> — <c>SET LOCAL ROLE app_tenant</c> + org GUC — so Postgres RLS isolates
/// the org for every query. The <c>invoices.status</c> / <c>subscriptions.plan</c> / <c>subscriptions.status</c>
/// columns are native Prisma enums (<c>InvoiceStatus</c>/<c>OrgPlan</c>/<c>SubscriptionStatus</c>); EFCore.PG
/// reads them into the mapped C# <c>string</c> properties (unmapped enum → text).
/// </summary>
public sealed class BillingReadDbContext(DbContextOptions<BillingReadDbContext> options)
    : DbContext(options)
{
    public DbSet<InvoiceReadEntity> Invoices => Set<InvoiceReadEntity>();

    public DbSet<SubscriptionReadEntity> Subscriptions => Set<SubscriptionReadEntity>();

    // getUsage count sources (read-only, minimal columns; run UNDER TenantScope/RLS with an explicit org filter).
    public DbSet<UsageUserCountEntity> UsageUsers => Set<UsageUserCountEntity>();

    public DbSet<UsageVacancyCountEntity> UsageVacancies => Set<UsageVacancyCountEntity>();

    public DbSet<UsageAssignmentCountEntity> UsageAssignments => Set<UsageAssignmentCountEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<InvoiceReadEntity>(entity =>
        {
            entity.ToTable("invoices");
            entity.HasKey(i => i.Id);
            entity.Property(i => i.Id).HasColumnName("id");
            entity.Property(i => i.InvoiceNumber).HasColumnName("invoice_number");
            entity.Property(i => i.OrganizationId).HasColumnName("organization_id");
            entity.Property(i => i.SubscriptionId).HasColumnName("subscription_id");
            entity.Property(i => i.StripeInvoiceId).HasColumnName("stripe_invoice_id");
            entity.Property(i => i.Amount).HasColumnName("amount");
            entity.Property(i => i.Subtotal).HasColumnName("subtotal");
            entity.Property(i => i.TaxRate).HasColumnName("tax_rate");
            entity.Property(i => i.Currency).HasColumnName("currency");
            // Native Prisma enum column (InvoiceStatus); read into a C# string (unmapped enum → text).
            entity.Property(i => i.Status).HasColumnName("status");
            entity.Property(i => i.Description).HasColumnName("description");
            // Prisma DateTime maps to `timestamp(3) without time zone`; pin it so Npgsql reads/writes it
            // as Unspecified-kind DateTime (its default is timestamptz, which rejects the cursor-boundary
            // parameter) — matching the Prisma-owned columns exactly.
            entity.Property(i => i.InvoiceDate).HasColumnName("invoice_date").HasColumnType("timestamp");
            entity.Property(i => i.DueDate).HasColumnName("due_date").HasColumnType("timestamp");
            entity.Property(i => i.PoNumber).HasColumnName("po_number");
            entity.Property(i => i.Notes).HasColumnName("notes");
            entity.Property(i => i.Memo).HasColumnName("memo");
            entity.Property(i => i.EmailTo).HasColumnName("email_to");
            entity.Property(i => i.EmailCc).HasColumnName("email_cc");
            entity.Property(i => i.PaidAt).HasColumnName("paid_at").HasColumnType("timestamp");
            entity.Property(i => i.InvoiceUrl).HasColumnName("invoice_url");
            entity.Property(i => i.PeriodStart).HasColumnName("period_start").HasColumnType("timestamp");
            entity.Property(i => i.PeriodEnd).HasColumnName("period_end").HasColumnType("timestamp");
            entity.Property(i => i.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");

            // Nullable many-to-one subscription (Invoice.subscription is optional in Prisma; the FK
            // subscription_id references subscriptions.id, the PK) → LEFT join when projected.
            entity.HasOne(i => i.Subscription)
                .WithMany()
                .HasForeignKey(i => i.SubscriptionId);
        });

        modelBuilder.Entity<SubscriptionReadEntity>(entity =>
        {
            entity.ToTable("subscriptions");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.StripeCustomerId).HasColumnName("stripe_customer_id");
            entity.Property(s => s.StripeSubscriptionId).HasColumnName("stripe_subscription_id");
            // Native Prisma enum columns (OrgPlan / SubscriptionStatus); read into C# strings.
            entity.Property(s => s.Plan).HasColumnName("plan");
            entity.Property(s => s.Status).HasColumnName("status");
            entity.Property(s => s.CurrentPeriodStart).HasColumnName("current_period_start").HasColumnType("timestamp");
            entity.Property(s => s.CurrentPeriodEnd).HasColumnName("current_period_end").HasColumnType("timestamp");
            entity.Property(s => s.TrialEndsAt).HasColumnName("trial_ends_at").HasColumnType("timestamp");
            entity.Property(s => s.CancelledAt).HasColumnName("cancelled_at").HasColumnType("timestamp");
            entity.Property(s => s.LastStripeEventAt).HasColumnName("last_stripe_event_at").HasColumnType("timestamp");
            entity.Property(s => s.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(s => s.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        // getUsage count sources — minimal read-only maps (only the count-predicate columns).
        modelBuilder.Entity<UsageUserCountEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.IsActive).HasColumnName("is_active");
        });

        modelBuilder.Entity<UsageVacancyCountEntity>(entity =>
        {
            entity.ToTable("vacancies");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.OrganizationId).HasColumnName("organization_id");
            entity.Property(v => v.Status).HasColumnName("status");
            entity.Property(v => v.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<UsageAssignmentCountEntity>(entity =>
        {
            entity.ToTable("assessment_assignments");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.AssignedAt).HasColumnName("assigned_at").HasColumnType("timestamp");
        });
    }
}
