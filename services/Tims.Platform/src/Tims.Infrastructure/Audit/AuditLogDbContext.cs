using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// EF Core context over the Prisma-OWNED <c>audit_logs</c> table (the admin/security event ledger, distinct
/// from <c>data_access_logs</c>). INSERT-only (<c>efcoreAppendOnly</c> in docs/architecture/table-ownership.md):
/// the billing self-serve writer only ever APPENDS one row — it never UPDATEs/DELETEs, honoring the CB-1b
/// append-only immutability. Runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so the
/// RLS <c>WITH CHECK</c> passes for the caller's org. Maps the full model; the billing writer sets only
/// organization_id / actor_id / action / entity / metadata (the rest stay null / DB-default).
/// </summary>
public sealed class AuditLogDbContext(DbContextOptions<AuditLogDbContext> options) : DbContext(options)
{
    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AuditLogEntity>(entity =>
        {
            entity.ToTable("audit_logs");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.UserId).HasColumnName("user_id");
            entity.Property(a => a.ActorId).HasColumnName("actor_id");
            entity.Property(a => a.Action).HasColumnName("action");
            entity.Property(a => a.Entity).HasColumnName("entity");
            entity.Property(a => a.EntityId).HasColumnName("entity_id");
            // Prisma `Json?` columns are jsonb; write the pre-serialized JSON text (like the vendor result path).
            entity.Property(a => a.Changes).HasColumnName("changes").HasColumnType("jsonb");
            entity.Property(a => a.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
            entity.Property(a => a.IpAddress).HasColumnName("ip_address");
            entity.Property(a => a.UserAgent).HasColumnName("user_agent");
            // created_at is left to the Postgres DEFAULT now() (Prisma @default(now())): DB-generated on add,
            // never sent by the append-only writer (matching the data_access_logs writer).
            entity.Property(a => a.CreatedAt)
                .HasColumnName("created_at")
                .HasColumnType("timestamp")
                .HasDefaultValueSql("now()")
                .ValueGeneratedOnAdd();
        });
    }
}

/// <summary>
/// EF mapping of the Prisma-OWNED <c>audit_logs</c> row. Only ever INSERTed (append-only). <c>entity_id</c> is
/// Prisma <c>String?</c> (text, NOT uuid); <c>changes</c>/<c>metadata</c> are jsonb carried as raw JSON text.
/// </summary>
public sealed class AuditLogEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid? UserId { get; set; }

    public Guid? ActorId { get; set; }

    public string Action { get; set; } = string.Empty;

    public string Entity { get; set; } = string.Empty;

    public string? EntityId { get; set; }

    public string? Changes { get; set; }

    public string? Metadata { get; set; }

    public string? IpAddress { get; set; }

    public string? UserAgent { get; set; }

    public DateTime CreatedAt { get; set; }
}
