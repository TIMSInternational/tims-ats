using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure;

/// <summary>
/// Minimal DbContext for Phase 1 Spike A. Maps <see cref="Widget"/> onto the
/// hand-authored "widgets" table (created by test DDL, not EF migrations) using
/// the same snake_case column names the real schema uses.
///
/// This context deliberately does NOT set the tenant role/GUC itself — that is
/// the job of <see cref="TenantScope"/>, which wraps every unit of work in a
/// transaction and issues `SET LOCAL ROLE` + `set_config(...)` before any query
/// runs. Keeping that concern out of the DbContext mirrors the target design
/// (`TenantConnectionInterceptor` in the target architecture, §3): the DbContext
/// is dumb; the scope is what proves the RLS mechanism.
/// </summary>
public sealed class TenantWidgetDbContext(DbContextOptions<TenantWidgetDbContext> options)
    : DbContext(options)
{
    public DbSet<Widget> Widgets => Set<Widget>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Widget>(entity =>
        {
            entity.ToTable("widgets");
            entity.HasKey(w => w.Id);
            entity.Property(w => w.Id).HasColumnName("id");
            entity.Property(w => w.OrganizationId).HasColumnName("organization_id");
            entity.Property(w => w.Name).HasColumnName("name");
        });
    }
}
