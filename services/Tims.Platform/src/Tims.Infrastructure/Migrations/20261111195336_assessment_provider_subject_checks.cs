using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Tims.Infrastructure.Rls;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class assessment_provider_subject_checks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "assessment_provider_subject_checks",
                columns: table => new
                {
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider_subject_id = table.Column<Guid>(type: "uuid", nullable: false),
                    last_checked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assessment_provider_subject_checks", x => new { x.organization_id, x.provider_subject_id });
                });

            // ORG-SCOPED and EF-OWNED (WP1.7 governance rail): ENABLE + FORCE + the fail-closed tenant_isolation policy.
            migrationBuilder.EnableTenantRls("assessment_provider_subject_checks");

            // The erasure sweep claims and releases checks on the tenant connection; a row is never deleted.
            migrationBuilder.Sql(
                "GRANT SELECT, INSERT, UPDATE ON assessment_provider_subject_checks TO app_tenant;\n" +
                "REVOKE DELETE, TRUNCATE ON assessment_provider_subject_checks FROM app_tenant;");

            // Supabase's API roles never touch the table. Guarded so the migration also runs where they do not exist.
            migrationBuilder.Sql(
                """
                DO $acl$
                DECLARE r text;
                BEGIN
                  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                      EXECUTE format('REVOKE ALL ON TABLE assessment_provider_subject_checks FROM %I', r);
                    END IF;
                  END LOOP;
                END
                $acl$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "assessment_provider_subject_checks");
        }
    }
}
