using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Tims.Infrastructure.Rls;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class hris_domain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "hris_connectors",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "text", nullable: false),
                    display_name = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    secret_ref = table.Column<string>(type: "text", nullable: true),
                    subdomain = table.Column<string>(type: "text", nullable: true),
                    field_map = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
                    sync_cursor = table.Column<string>(type: "text", nullable: true),
                    sync_cadence = table.Column<string>(type: "text", nullable: true),
                    last_sync_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    last_synced_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hris_connectors", x => x.id);
                });

            // Org-scoped EF-OWNED table → ship RLS with the table (WP1.7 governance rail): ENABLE +
            // FORCE + fail-closed tenant_isolation policy, and GRANT the tenant role the table privileges
            // RLS needs to engage (mirrors RlsFixture / the live Prisma policy).
            migrationBuilder.EnableTenantRls("hris_connectors");
            migrationBuilder.Sql("GRANT SELECT, INSERT, UPDATE, DELETE ON hris_connectors TO app_tenant;");

            migrationBuilder.CreateTable(
                name: "hris_external_employees",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    connector_id = table.Column<Guid>(type: "uuid", nullable: false),
                    external_id = table.Column<string>(type: "text", nullable: false),
                    first_name = table.Column<string>(type: "text", nullable: false),
                    last_name = table.Column<string>(type: "text", nullable: false),
                    work_email = table.Column<string>(type: "text", nullable: true),
                    job_title = table.Column<string>(type: "text", nullable: true),
                    department = table.Column<string>(type: "text", nullable: true),
                    division = table.Column<string>(type: "text", nullable: true),
                    hire_date = table.Column<DateOnly>(type: "date", nullable: true),
                    employment_status = table.Column<string>(type: "text", nullable: true),
                    supervisor_external_id = table.Column<string>(type: "text", nullable: true),
                    raw_payload = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
                    source_hash = table.Column<string>(type: "text", nullable: false),
                    is_deleted_in_source = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    first_seen_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    last_synced_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    last_sync_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hris_external_employees", x => x.id);
                });

            migrationBuilder.EnableTenantRls("hris_external_employees");
            migrationBuilder.Sql("GRANT SELECT, INSERT, UPDATE, DELETE ON hris_external_employees TO app_tenant;");

            migrationBuilder.CreateTable(
                name: "hris_sync_record_errors",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sync_run_id = table.Column<Guid>(type: "uuid", nullable: false),
                    connector_id = table.Column<Guid>(type: "uuid", nullable: false),
                    external_id = table.Column<string>(type: "text", nullable: true),
                    error_type = table.Column<string>(type: "text", nullable: false),
                    message = table.Column<string>(type: "text", nullable: false),
                    details = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hris_sync_record_errors", x => x.id);
                });

            migrationBuilder.EnableTenantRls("hris_sync_record_errors");
            migrationBuilder.Sql("GRANT SELECT, INSERT, UPDATE, DELETE ON hris_sync_record_errors TO app_tenant;");

            migrationBuilder.CreateTable(
                name: "hris_sync_runs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    connector_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    trigger = table.Column<string>(type: "text", nullable: false),
                    idempotency_key = table.Column<string>(type: "text", nullable: false),
                    cursor_before = table.Column<string>(type: "text", nullable: true),
                    cursor_after = table.Column<string>(type: "text", nullable: true),
                    records_seen = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    records_upserted = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    records_failed = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    error_summary = table.Column<string>(type: "text", nullable: true),
                    started_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    finished_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hris_sync_runs", x => x.id);
                });

            migrationBuilder.EnableTenantRls("hris_sync_runs");
            migrationBuilder.Sql("GRANT SELECT, INSERT, UPDATE, DELETE ON hris_sync_runs TO app_tenant;");

            migrationBuilder.CreateIndex(
                name: "ux_hris_connectors_org_provider",
                table: "hris_connectors",
                columns: new[] { "organization_id", "provider" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_hris_external_employees_connector",
                table: "hris_external_employees",
                column: "connector_id");

            migrationBuilder.CreateIndex(
                name: "ux_hris_external_employees_org_connector_external",
                table: "hris_external_employees",
                columns: new[] { "organization_id", "connector_id", "external_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_hris_sync_record_errors_connector",
                table: "hris_sync_record_errors",
                column: "connector_id");

            migrationBuilder.CreateIndex(
                name: "ix_hris_sync_record_errors_sync_run",
                table: "hris_sync_record_errors",
                column: "sync_run_id");

            migrationBuilder.CreateIndex(
                name: "ix_hris_sync_runs_connector",
                table: "hris_sync_runs",
                column: "connector_id");

            migrationBuilder.CreateIndex(
                name: "ux_hris_sync_runs_org_connector_idempotency",
                table: "hris_sync_runs",
                columns: new[] { "organization_id", "connector_id", "idempotency_key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "hris_connectors");

            migrationBuilder.DropTable(
                name: "hris_external_employees");

            migrationBuilder.DropTable(
                name: "hris_sync_record_errors");

            migrationBuilder.DropTable(
                name: "hris_sync_runs");
        }
    }
}
