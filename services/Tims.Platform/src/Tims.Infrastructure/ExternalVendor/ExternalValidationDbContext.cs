using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.ExternalVendor;

/// <summary>
/// EF Core context over the Prisma-OWNED <c>preemployment_validations</c> table
/// (<c>efcoreStranglerWrite</c> in docs/architecture/table-ownership.md). It is WRITE-CAPABLE, but only
/// for the ONE documented vendor <c>UPDATE</c> (the atomic pending-only submit) — Prisma still owns the
/// DDL/migrations AND the staff <c>updateValidation</c> write, so a deploy flag keeps exactly one ACTIVE
/// runtime writer (TS today; the ownership flip is deferred, see the ledger note).
///
/// Like the tenant/audit contexts it is "dumb" about tenancy: every read/write runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so Postgres RLS isolates the org and
/// the WITH-CHECK passes for the caller's org. It maps only the columns the submit path needs.
/// </summary>
public sealed class ExternalValidationDbContext(DbContextOptions<ExternalValidationDbContext> options)
    : DbContext(options)
{
    public DbSet<ExternalValidationEntity> Validations => Set<ExternalValidationEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ExternalValidationEntity>(entity =>
        {
            entity.ToTable("preemployment_validations");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.OrganizationId).HasColumnName("organization_id");
            entity.Property(v => v.Status).HasColumnName("status");
            // Opaque vendor result JSON: the Prisma `Json?` column is jsonb; write/read it as raw text.
            entity.Property(v => v.Result).HasColumnName("result").HasColumnType("jsonb");
            entity.Property(v => v.Notes).HasColumnName("notes");
            entity.Property(v => v.CompletedById).HasColumnName("completed_by_id");
            entity.Property(v => v.CompletedByApiKeyId).HasColumnName("completed_by_api_key_id");
            // Prisma `DateTime?` maps to `timestamp(3) without time zone`; pin it so Npgsql reads/writes it
            // as Unspecified-kind DateTime (its default is timestamptz) — matching the Prisma-owned column.
            entity.Property(v => v.CompletedAt).HasColumnName("completed_at").HasColumnType("timestamp");
            entity.Property(v => v.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });
    }
}
