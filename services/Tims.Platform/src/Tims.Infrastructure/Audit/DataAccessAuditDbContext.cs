using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// The ONE write-capable EF context in the C# platform, mapping the Prisma-OWNED,
/// <b>append-only</b> <c>data_access_logs</c> table (docs/architecture/table-ownership.md
/// <c>efcoreAppendOnly</c>). Unlike <see cref="Identity.IdentityDbContext"/> (read-only) it DOES call
/// <c>SaveChanges</c>, but exclusively to INSERT audit rows — never UPDATE/DELETE, and never any other
/// table. Prisma still owns the DDL/migrations; EF only appends.
///
/// It maps only the columns the audit writer needs. Like <see cref="TenantWidgetDbContext"/>, the
/// context is dumb about tenancy: the org role/GUC is issued by <see cref="TenantScope"/>, which wraps
/// the write in a transaction so the RLS <c>WITH CHECK</c> passes for the caller's org.
///
/// <c>created_at</c> is left to the Postgres <c>DEFAULT now()</c> (Prisma <c>@default(now())</c>), so it is
/// store-generated and never written by EF. <c>id</c> is supplied by the writer (Prisma's <c>uuid()</c>
/// default is client-side, so the column has no DB default).
/// </summary>
public sealed class DataAccessAuditDbContext(DbContextOptions<DataAccessAuditDbContext> options)
    : DbContext(options)
{
    public DbSet<DataAccessLogEntity> DataAccessLogs => Set<DataAccessLogEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DataAccessLogEntity>(entity =>
        {
            entity.ToTable("data_access_logs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.ActorId).HasColumnName("actor_id");
            entity.Property(e => e.DataType).HasColumnName("data_type");
            entity.Property(e => e.RecordId).HasColumnName("record_id");
            entity.Property(e => e.Action).HasColumnName("action");
            entity.Property(e => e.IpAddress).HasColumnName("ip_address");
            entity.Property(e => e.UserAgent).HasColumnName("user_agent");
            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasDefaultValueSql("now()")
                .ValueGeneratedOnAdd();
        });
    }
}
