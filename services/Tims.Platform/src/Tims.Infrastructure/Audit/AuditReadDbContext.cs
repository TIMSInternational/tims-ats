using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED, <c>efcoreAppendOnly</c> <c>audit_logs</c> table
/// (docs/architecture/table-ownership.md — the existing entry already covers this table; this
/// context adds the READ mapping alongside <see cref="AuditLogDbContext"/>'s WRITE mapping, not a
/// new ownership category).
///
/// UNLIKE every other Phase-5 read context (team-intel, succession, reporting, ...), this one is
/// NEVER wrapped in <see cref="Tims.Infrastructure.TenantScope"/> — no <c>SET LOCAL ROLE
/// app_tenant</c>, no org GUC. It runs on the app's default (privileged) connection, so Postgres
/// RLS does not restrict it: a platform owner is SUPPOSED to see every org's audit trail. Do not
/// "fix" this into a TenantScope-wrapped read — Tims.IntegrationTests.Audit.AuditReadCrossOrgTests
/// pins the cross-org visibility as the intended, tested behavior.
///
/// Reuses <see cref="AuditLogEntity"/> from <see cref="AuditLogDbContext"/> verbatim (same table,
/// same columns) rather than re-declaring the mapping, so the two contexts can never drift apart
/// on column names/types.
/// </summary>
public sealed class AuditReadDbContext(DbContextOptions<AuditReadDbContext> options) : DbContext(options)
{
    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    public DbSet<AuditActorReadEntity> Actors => Set<AuditActorReadEntity>();

    public DbSet<AuditOrganizationReadEntity> Organizations => Set<AuditOrganizationReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Full property mapping (not just the columns the two endpoints return) so this context
        // never half-maps AuditLogEntity — matching AuditLogDbContext's own OnModelCreating exactly,
        // since both contexts map the SAME entity class and must never drift on column names/types.
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
            entity.Property(a => a.Changes).HasColumnName("changes").HasColumnType("jsonb");
            entity.Property(a => a.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
            entity.Property(a => a.IpAddress).HasColumnName("ip_address");
            entity.Property(a => a.UserAgent).HasColumnName("user_agent");
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        // Local, minimal read-only mappings of users/organizations — scoped to THIS context only
        // (no navigation properties on AuditLogEntity; AuditReadRepository LEFT JOINs by id in Task 4,
        // matching the ReportingReadDbContext precedent of context-local read entities).
        modelBuilder.Entity<AuditActorReadEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Email).HasColumnName("email");
            entity.Property(u => u.Avatar).HasColumnName("avatar");
        });

        modelBuilder.Entity<AuditOrganizationReadEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
        });
    }
}

/// <summary>Minimal read-only mapping of `users`, scoped to this context — backs the list
/// endpoint's nested `actor` join and the export endpoint's actor name fields. FirstName/LastName
/// are non-nullable per the real schema (user.prisma:6-7, `String` NOT NULL) — only Avatar is
/// genuinely optional.</summary>
public sealed class AuditActorReadEntity
{
    public Guid Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? Avatar { get; set; }
}

/// <summary>Minimal read-only mapping of `organizations`, scoped to this context — backs the
/// export endpoint's `organization.name` field only.</summary>
public sealed class AuditOrganizationReadEntity
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
}
