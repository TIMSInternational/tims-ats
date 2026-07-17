using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// Builds the Npgsql data source for <see cref="BillingSelfServeDbContext"/> with UNMAPPED TYPES enabled — the
/// <c>subscriptions.plan</c>/<c>.status</c> columns are native Postgres enums, read into C# strings (same
/// rationale as <see cref="BillingReadDataSource"/>). Isolated behind <see cref="BillingSelfServeDataSourceHolder"/>.
/// </summary>
public static class BillingSelfServeDataSource
{
    public static NpgsqlDataSource Build(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.EnableUnmappedTypes();
        return builder.Build();
    }
}

/// <summary>DI holder isolating the self-serve <see cref="NpgsqlDataSource"/> (EnableUnmappedTypes) from every other context.</summary>
public sealed class BillingSelfServeDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}

/// <summary>
/// EF Core context over the Prisma-OWNED <c>organizations</c> ⋈ <c>subscriptions</c> tables for the tenant
/// self-serve billing flow. READS the org identity + subscription linkage; WRITES only
/// <c>subscriptions.stripe_customer_id</c> (the compare-and-set customer link). Runs UNDER TenantScope
/// (app_tenant + org GUC) so RLS isolates the org — the request (tenant) path, NOT the privileged webhook path.
/// The <c>subscriptions.plan</c>/<c>.status</c> enums read into C# strings via the EnableUnmappedTypes source.
/// </summary>
public sealed class BillingSelfServeDbContext(DbContextOptions<BillingSelfServeDbContext> options) : DbContext(options)
{
    public DbSet<OrgBillingEntity> Organizations => Set<OrgBillingEntity>();

    public DbSet<SubscriptionSelfServeEntity> Subscriptions => Set<SubscriptionSelfServeEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<OrgBillingEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
            entity.Property(o => o.BillingEmail).HasColumnName("billing_email");
        });

        modelBuilder.Entity<SubscriptionSelfServeEntity>(entity =>
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
        });
    }
}

/// <summary>READ-ONLY mapping of the org identity columns the self-serve flow needs (name + billing email for the Stripe Customer).</summary>
public sealed class OrgBillingEntity
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? BillingEmail { get; set; }
}

/// <summary>Mapping of the subscription linkage columns (read) + <c>stripe_customer_id</c> (the only self-serve write).</summary>
public sealed class SubscriptionSelfServeEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string? StripeCustomerId { get; set; }

    public string? StripeSubscriptionId { get; set; }

    public string Plan { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;
}
