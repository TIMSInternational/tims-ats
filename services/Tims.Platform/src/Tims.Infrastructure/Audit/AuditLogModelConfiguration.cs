using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// The ONE EF mapping of <see cref="AuditLogEntity"/> onto the Prisma-OWNED <c>audit_logs</c> table.
///
/// <para>Extracted (Phase-5 slice 20, issue #76) because a second context now maps the same table.
/// <see cref="AuditLogDbContext"/> writes it standalone and fail-SOFT for billing; the platform
/// organizations write context maps it alongside <c>organizations</c> so the audit INSERT and the org
/// UPDATE can share ONE transaction — which is the only way its fail-CLOSED contract means anything.</para>
///
/// <para>Two contexts hand-maintaining the same column map is a drift hazard with a nasty failure mode:
/// the mismatch would not be a build error or a test failure, it would be two audit rows that differ in
/// their <c>changes</c>/<c>created_at</c> handling depending on which writer produced them. So the map
/// lives here once and both contexts call it.</para>
/// </summary>
public static class AuditLogModelConfiguration
{
    public static ModelBuilder ConfigureAuditLogs(this ModelBuilder modelBuilder)
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

        return modelBuilder;
    }
}
