using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// EF Core context over the Prisma-OWNED <c>subscriptions</c> table (<c>efcoreStranglerWrite</c> in
/// docs/architecture/table-ownership.md) for the Stripe webhook state-sync engine. It maps only the columns
/// the read-once DECISION query needs (org resolution + duplicate/stale checks); the upsert + the
/// <c>organizations.plan</c> mirror are issued as parameterized SQL by the repository (a true atomic
/// <c>INSERT … ON CONFLICT</c>, faithful to Prisma's upsert).
///
/// UNLIKE every other product context, it runs on the PRIVILEGED connection and is NEVER wrapped in
/// <see cref="TenantScope"/>: the webhook carries no org GUC (Stripe is not a tenant), so it must resolve and
/// scope every operation by EXPLICIT <c>organization_id</c> and run on a role that bypasses RLS (the same
/// privileged connection the identity reads use). The <c>status</c> enum column reads into a C# string via the
/// EnableUnmappedTypes data source (<see cref="BillingWebhookDataSource"/>).
/// </summary>
public sealed class BillingWebhookDbContext(DbContextOptions<BillingWebhookDbContext> options)
    : DbContext(options)
{
    public DbSet<SubscriptionWebhookEntity> Subscriptions => Set<SubscriptionWebhookEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SubscriptionWebhookEntity>(entity =>
        {
            entity.ToTable("subscriptions");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.StripeCustomerId).HasColumnName("stripe_customer_id");
            entity.Property(s => s.StripeSubscriptionId).HasColumnName("stripe_subscription_id");
            // Native Prisma enum column (SubscriptionStatus); read into a C# string (EnableUnmappedTypes → text).
            entity.Property(s => s.Status).HasColumnName("status");
            // Prisma DateTime? maps to `timestamp(3) without time zone`; pin it so Npgsql reads it as an
            // Unspecified-kind DateTime (its default is timestamptz) — matching the Prisma-owned column.
            entity.Property(s => s.LastStripeEventAt).HasColumnName("last_stripe_event_at").HasColumnType("timestamp");
        });
    }
}

/// <summary>
/// READ-ONLY-for-EF mapping of the columns the webhook DECISION query needs from the Prisma-OWNED
/// <c>subscriptions</c> table. The row is only ever read (<c>AsNoTracking</c>); the write is a parameterized
/// upsert. <c>status</c> is the native <c>SubscriptionStatus</c> enum, read into a string.
/// </summary>
public sealed class SubscriptionWebhookEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string? StripeCustomerId { get; set; }

    public string? StripeSubscriptionId { get; set; }

    public string Status { get; set; } = string.Empty;

    public DateTime? LastStripeEventAt { get; set; }
}
