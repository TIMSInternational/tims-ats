using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.AssessmentTypes;

/// <summary>
/// F13 tenant authoring context: maps the Prisma-OWNED <c>assessment_types</c> table (efcoreStranglerWrite — C#
/// INSERTs/UPDATEs it; Prisma keeps the DDL) alongside <c>audit_logs</c> (efcoreAppendOnly), so the type write and
/// its audit row commit in ONE transaction. No navigation properties. <c>config</c> is deliberately unmapped: this
/// surface never reads or writes it, and INSERT leaves it NULL (the Prisma column is <c>Json?</c>).
/// </summary>
public sealed class AssessmentTypeWriteDbContext(DbContextOptions<AssessmentTypeWriteDbContext> options) : DbContext(options)
{
    public DbSet<AssessmentTypeWriteEntity> AssessmentTypes => Set<AssessmentTypeWriteEntity>();

    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ConfigureAuditLogs();

        modelBuilder.Entity<AssessmentTypeWriteEntity>(entity =>
        {
            entity.ToTable("assessment_types");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Id).HasColumnName("id");
            entity.Property(t => t.OrganizationId).HasColumnName("organization_id");
            entity.Property(t => t.Name).HasColumnName("name");
            entity.Property(t => t.Code).HasColumnName("code");
            entity.Property(t => t.Description).HasColumnName("description");
            entity.Property(t => t.Duration).HasColumnName("duration");
            entity.Property(t => t.IsActive).HasColumnName("is_active");
            // Prisma `timestamp(3) without time zone` holding a UTC wall-clock (TRAP 6/11): pin the store type and
            // write Kind=Unspecified values. updated_at is Prisma @updatedAt (NO DB default) so it is always sent.
            entity.Property(t => t.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(t => t.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });
    }
}

public sealed class AssessmentTypeWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Code { get; set; } = string.Empty;

    public string? Description { get; set; }

    public int? Duration { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
