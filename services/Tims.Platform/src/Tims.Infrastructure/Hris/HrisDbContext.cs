using Microsoft.EntityFrameworkCore;
using Tims.Domain.Hris;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// The FIRST write-capable, EF-OWNED product context of the C#/.NET migration (Phase 3 HRIS; Phase 2
/// only read Prisma-owned tables). It owns the DDL of the four <c>hris_</c>-prefixed tables
/// (docs/architecture/table-ownership.md <c>efcore</c>) — deliberately prefixed so they never collide
/// with Prisma's live <c>connectors</c>/<c>connector_syncs</c>/<c>sync_errors</c> integration tables.
///
/// Every table is org-scoped and therefore RLS-protected: the EF migration wraps each with
/// <c>EnableTenantRls</c> + a GRANT to <c>app_tenant</c>, and all reads/writes run UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) exactly like the audit context.
///
/// Mapping style mirrors <see cref="Identity.IdentityDbContext"/>: explicit
/// <c>ToTable</c>/<c>HasColumnName</c> (snake_case ↔ PascalCase), no naming-convention dependency.
/// Enum properties cross the DB boundary as their wire strings (text columns) via
/// <c>HasConversion</c>; jsonb columns use <c>HasColumnType("jsonb")</c> over raw JSON text.
/// </summary>
public sealed class HrisDbContext(DbContextOptions<HrisDbContext> options)
    : DbContext(options)
{
    public DbSet<HrisConnectorEntity> Connectors => Set<HrisConnectorEntity>();

    public DbSet<HrisExternalEmployeeEntity> ExternalEmployees => Set<HrisExternalEmployeeEntity>();

    public DbSet<HrisSyncRunEntity> SyncRuns => Set<HrisSyncRunEntity>();

    public DbSet<HrisSyncRecordErrorEntity> SyncRecordErrors => Set<HrisSyncRecordErrorEntity>();

    // DELIBERATE: no DB foreign keys between the hris_* tables (e.g. external_employees.connector_id →
    // connectors.id). Cross-row integrity is APP-enforced under one tenant scope, matching the Prisma-side
    // convention and avoiding FK enforcement that fights per-tenant RLS / partial writes. See
    // docs/architecture/csharp-migration/phase-3-scaffold-followups.md #4.
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<HrisConnectorEntity>(entity =>
        {
            entity.ToTable("hris_connectors");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.Provider)
                .HasColumnName("provider")
                .HasConversion(v => v.ToWire(), v => HrisProviders.FromWire(v));
            entity.Property(c => c.DisplayName).HasColumnName("display_name");
            entity.Property(c => c.Status)
                .HasColumnName("status")
                .HasConversion(v => v.ToWire(), v => ConnectorStatuses.FromWire(v));
            entity.Property(c => c.SecretRef).HasColumnName("secret_ref");
            entity.Property(c => c.Subdomain).HasColumnName("subdomain");
            entity.Property(c => c.FieldMap)
                .HasColumnName("field_map")
                .HasColumnType("jsonb")
                .HasDefaultValueSql("'{}'::jsonb");
            entity.Property(c => c.SyncCursor).HasColumnName("sync_cursor");
            entity.Property(c => c.SyncCadence).HasColumnName("sync_cadence");
            entity.Property(c => c.LastSyncRunId).HasColumnName("last_sync_run_id");
            entity.Property(c => c.LastSyncedAt).HasColumnName("last_synced_at");
            entity.Property(c => c.CreatedAt)
                .HasColumnName("created_at")
                .HasDefaultValueSql("now()")
                .ValueGeneratedOnAdd();
            entity.Property(c => c.UpdatedAt)
                .HasColumnName("updated_at")
                .HasDefaultValueSql("now()")
                .ValueGeneratedOnAdd();

            entity.HasIndex(c => new { c.OrganizationId, c.Provider })
                .IsUnique()
                .HasDatabaseName("ux_hris_connectors_org_provider");
        });

        modelBuilder.Entity<HrisExternalEmployeeEntity>(entity =>
        {
            entity.ToTable("hris_external_employees");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.ConnectorId).HasColumnName("connector_id");
            entity.Property(e => e.ExternalId).HasColumnName("external_id");
            entity.Property(e => e.FirstName).HasColumnName("first_name");
            entity.Property(e => e.LastName).HasColumnName("last_name");
            entity.Property(e => e.WorkEmail).HasColumnName("work_email");
            entity.Property(e => e.JobTitle).HasColumnName("job_title");
            entity.Property(e => e.Department).HasColumnName("department");
            entity.Property(e => e.Division).HasColumnName("division");
            entity.Property(e => e.HireDate).HasColumnName("hire_date").HasColumnType("date");
            entity.Property(e => e.EmploymentStatus).HasColumnName("employment_status");
            entity.Property(e => e.SupervisorExternalId).HasColumnName("supervisor_external_id");
            entity.Property(e => e.RawPayload)
                .HasColumnName("raw_payload")
                .HasColumnType("jsonb")
                .HasDefaultValueSql("'{}'::jsonb");
            entity.Property(e => e.SourceHash).HasColumnName("source_hash");
            entity.Property(e => e.IsDeletedInSource)
                .HasColumnName("is_deleted_in_source")
                .HasDefaultValue(false);
            entity.Property(e => e.FirstSeenAt)
                .HasColumnName("first_seen_at")
                .HasDefaultValueSql("now()")
                .ValueGeneratedOnAdd();
            entity.Property(e => e.LastSyncedAt)
                .HasColumnName("last_synced_at")
                .HasDefaultValueSql("now()")
                .ValueGeneratedOnAdd();
            entity.Property(e => e.LastSyncRunId).HasColumnName("last_sync_run_id");
            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasDefaultValueSql("now()")
                .ValueGeneratedOnAdd();
            entity.Property(e => e.UpdatedAt)
                .HasColumnName("updated_at")
                .HasDefaultValueSql("now()")
                .ValueGeneratedOnAdd();

            entity.HasIndex(e => new { e.OrganizationId, e.ConnectorId, e.ExternalId })
                .IsUnique()
                .HasDatabaseName("ux_hris_external_employees_org_connector_external");
            entity.HasIndex(e => e.ConnectorId)
                .HasDatabaseName("ix_hris_external_employees_connector");
        });

        modelBuilder.Entity<HrisSyncRunEntity>(entity =>
        {
            entity.ToTable("hris_sync_runs");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.ConnectorId).HasColumnName("connector_id");
            entity.Property(r => r.Status)
                .HasColumnName("status")
                .HasConversion(v => v.ToWire(), v => SyncRunStatuses.FromWire(v));
            entity.Property(r => r.Trigger).HasColumnName("trigger");
            entity.Property(r => r.IdempotencyKey).HasColumnName("idempotency_key");
            entity.Property(r => r.CursorBefore).HasColumnName("cursor_before");
            entity.Property(r => r.CursorAfter).HasColumnName("cursor_after");
            entity.Property(r => r.RecordsSeen).HasColumnName("records_seen").HasDefaultValue(0);
            entity.Property(r => r.RecordsUpserted).HasColumnName("records_upserted").HasDefaultValue(0);
            entity.Property(r => r.RecordsFailed).HasColumnName("records_failed").HasDefaultValue(0);
            entity.Property(r => r.ErrorSummary).HasColumnName("error_summary");
            entity.Property(r => r.StartedAt).HasColumnName("started_at");
            entity.Property(r => r.FinishedAt).HasColumnName("finished_at");
            entity.Property(r => r.CreatedAt)
                .HasColumnName("created_at")
                .HasDefaultValueSql("now()")
                .ValueGeneratedOnAdd();

            entity.HasIndex(r => new { r.OrganizationId, r.ConnectorId, r.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName("ux_hris_sync_runs_org_connector_idempotency");
            entity.HasIndex(r => r.ConnectorId)
                .HasDatabaseName("ix_hris_sync_runs_connector");
        });

        modelBuilder.Entity<HrisSyncRecordErrorEntity>(entity =>
        {
            entity.ToTable("hris_sync_record_errors");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.SyncRunId).HasColumnName("sync_run_id");
            entity.Property(e => e.ConnectorId).HasColumnName("connector_id");
            entity.Property(e => e.ExternalId).HasColumnName("external_id");
            entity.Property(e => e.ErrorType).HasColumnName("error_type");
            entity.Property(e => e.Message).HasColumnName("message");
            entity.Property(e => e.Details).HasColumnName("details").HasColumnType("jsonb");
            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasDefaultValueSql("now()")
                .ValueGeneratedOnAdd();

            entity.HasIndex(e => e.SyncRunId)
                .HasDatabaseName("ix_hris_sync_record_errors_sync_run");
            entity.HasIndex(e => e.ConnectorId)
                .HasDatabaseName("ix_hris_sync_record_errors_connector");
        });
    }
}
