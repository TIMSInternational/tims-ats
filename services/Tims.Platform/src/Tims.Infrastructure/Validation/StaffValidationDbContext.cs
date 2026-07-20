using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Validation;

/// <summary>
/// EF row for the Prisma-OWNED <c>preemployment_validations</c> table — the FULL-row subset the STAFF
/// <c>updateValidation</c> write reads back and returns (a superset of the external-vendor write's columns,
/// which returns only a minimal v1 contract). Prisma owns the DDL/migrations; this is the SECOND
/// <c>efcoreStranglerWrite</c> writer on the table (the external-vendor submit is the first). A deploy flag
/// keeps exactly one ACTIVE runtime writer (TS today) until the ownership flip at cutover.
/// </summary>
public sealed class StaffValidationEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid OfferId { get; set; }

    public string Type { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public bool IsBlocking { get; set; }

    /// <summary>Raw jsonb payload text (object or null); passed through unchanged on read/write.</summary>
    public string? Result { get; set; }

    public Guid? CompletedById { get; set; }

    public Guid? CompletedByApiKeyId { get; set; }

    public DateTime? CompletedAt { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Write-capable EF context over <c>preemployment_validations</c> for the STAFF update path
/// (<c>efcoreStranglerWrite</c> in docs/architecture/table-ownership.md). "Dumb" about tenancy: every
/// read/write runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so RLS isolates the
/// org and the WITH-CHECK passes. Timestamps are the Prisma <c>timestamp(3) without time zone</c> columns
/// (Npgsql <c>Unspecified</c>-kind), and <c>result</c> is jsonb (raw text).
/// </summary>
public sealed class StaffValidationDbContext(DbContextOptions<StaffValidationDbContext> options)
    : DbContext(options)
{
    public DbSet<StaffValidationEntity> Validations => Set<StaffValidationEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<StaffValidationEntity>(entity =>
        {
            entity.ToTable("preemployment_validations");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.OrganizationId).HasColumnName("organization_id");
            entity.Property(v => v.OfferId).HasColumnName("offer_id");
            entity.Property(v => v.Type).HasColumnName("type");
            entity.Property(v => v.Status).HasColumnName("status");
            entity.Property(v => v.IsBlocking).HasColumnName("is_blocking");
            entity.Property(v => v.Result).HasColumnName("result").HasColumnType("jsonb");
            entity.Property(v => v.CompletedById).HasColumnName("completed_by_id");
            entity.Property(v => v.CompletedByApiKeyId).HasColumnName("completed_by_api_key_id");
            entity.Property(v => v.CompletedAt).HasColumnName("completed_at").HasColumnType("timestamp");
            entity.Property(v => v.Notes).HasColumnName("notes");
            entity.Property(v => v.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(v => v.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });
    }
}
