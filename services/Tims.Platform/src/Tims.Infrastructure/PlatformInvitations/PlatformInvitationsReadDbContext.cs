using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.PlatformInvitations;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-owned <c>platform_invitations</c> table plus the two lookup
/// tables its list projection joins (Phase-5 slice 22, issue #75).
///
/// <para><b>NEVER wrapped in <see cref="TenantScope"/>, and that is the intended design.</b> The TS
/// procedures run on the privileged unscoped <c>db</c> client with no <c>organizationId</c> predicate:
/// a platform owner is supposed to see every tenant's invitations. So there is no <c>SET LOCAL ROLE
/// app_tenant</c> and no org GUC here, Postgres RLS restricts nothing on this path, and
/// <c>PlatformOwnerGate</c> is the entire authorization boundary. Wrapping this in a tenant scope would
/// empty the platform console rather than secure it — the same disposition
/// <see cref="Tims.Infrastructure.Audit.AuditReadDbContext"/> documents.</para>
///
/// <para>All three tables are already registered in the ownership ledger's <c>efcoreReadOnly[]</c>
/// (<c>platform_invitations</c> arrived there in slice 19, which mapped it for a count), so this context
/// adds no ledger entry — but it DOES add a rationale note, because "already listed" and "listed for this
/// reason" are different records and the next reader needs the second one.</para>
/// </summary>
public sealed class PlatformInvitationsReadDbContext(DbContextOptions<PlatformInvitationsReadDbContext> options)
    : DbContext(options)
{
    public DbSet<PlatformInvitationReadEntity> Invitations => Set<PlatformInvitationReadEntity>();

    public DbSet<PlatformInvitationOrganizationEntity> Organizations => Set<PlatformInvitationOrganizationEntity>();

    public DbSet<PlatformInvitationSenderEntity> Senders => Set<PlatformInvitationSenderEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PlatformInvitationReadEntity>(entity =>
        {
            entity.ToTable("platform_invitations");
            entity.HasKey(i => i.Id);
            entity.Property(i => i.Id).HasColumnName("id");
            entity.Property(i => i.Email).HasColumnName("email");
            entity.Property(i => i.Type).HasColumnName("type");
            entity.Property(i => i.OrganizationId).HasColumnName("organization_id");
            entity.Property(i => i.OrganizationName).HasColumnName("organization_name");
            entity.Property(i => i.RoleSlug).HasColumnName("role_slug");
            entity.Property(i => i.Status).HasColumnName("status");
            entity.Property(i => i.InvitedById).HasColumnName("invited_by_id");
            // `timestamp without time zone` on all five, per packages/db/prisma/schema/platform.prisma —
            // stated explicitly so Npgsql yields DateTimeKind.Unspecified and the NodeIso converters on the
            // read models emit the trailing `Z` that superjson's toISOString() always emits. Getting this
            // pair wrong is a guaranteed parity failure on every row (see the read models' docblock).
            entity.Property(i => i.SentAt).HasColumnName("sent_at").HasColumnType("timestamp");
            entity.Property(i => i.ExpiresAt).HasColumnName("expires_at").HasColumnType("timestamp");
            entity.Property(i => i.AcceptedAt).HasColumnName("accepted_at").HasColumnType("timestamp");
            entity.Property(i => i.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<PlatformInvitationOrganizationEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
        });

        modelBuilder.Entity<PlatformInvitationSenderEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
        });
    }
}
