using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Fx;

/// <summary>
/// The GLOBAL EF context for the efcore-OWNED, RLS-EXEMPT <c>fx_rates</c> table (Phase-5 Slice 11c) — it OWNS
/// the DDL (migration <c>20260722000000_fx_rates</c>) and is the ONLY context that maps <c>fx_rates</c>. UNLIKE
/// the tenant read contexts it runs on a PLAIN connection with NO <see cref="TenantScope"/> (no SET LOCAL ROLE,
/// no org GUC): fx_rates is org-agnostic shared data with no RLS policy, so a tenant GUC would be meaningless
/// (and would hide every row). The daily <c>FxRefreshJob</c> WRITES through this context (idempotent upsert on
/// the privileged/owner connection); <c>FxRateProvider</c> READS the latest effective-dated pin through it.
///
/// The FX read is a SUB-query of a tenant-scoped comp read — the comp rows come from the RLS-tenant-scoped
/// CompensationReadDbContext, the fx_rates lookup from THIS global context — composed in the use case. Because
/// the migration GRANTs SELECT to <c>app_tenant</c>, fx_rates is ALSO readable even under a tenant role (no org
/// GUC needed), which the RLS-exempt integration bite proves.
/// </summary>
public sealed class FxRateDbContext(DbContextOptions<FxRateDbContext> options) : DbContext(options)
{
    public DbSet<FxRateEntity> FxRates => Set<FxRateEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FxRateEntity>(entity =>
        {
            entity.ToTable("fx_rates");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.BaseCurrency).HasColumnName("base_currency");
            entity.Property(r => r.QuoteCurrency).HasColumnName("quote_currency");
            entity.Property(r => r.Rate).HasColumnName("rate");
            entity.Property(r => r.AsOf).HasColumnName("as_of").HasColumnType("date");
            entity.Property(r => r.FetchedAt).HasColumnName("fetched_at").HasColumnType("timestamp with time zone");
            entity.Property(r => r.Source).HasColumnName("source");
            entity.HasIndex(r => new { r.BaseCurrency, r.QuoteCurrency, r.AsOf })
                .HasDatabaseName("ux_fx_rates_base_quote_asof")
                .IsUnique();
        });
    }
}
