using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Tims.Infrastructure.Rls;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <summary>
    /// Proctoring parity with tims-suite (owner decision 2026-11-11). (1) <c>assessment_provider_settings</c>: one row per
    /// org with HR's assessment security settings (lockdown, anti-cheat threshold + consequence, identity check), all off
    /// by default; ORG-SCOPED and EF-OWNED, so it ships with ENABLE + FORCE RLS and the fail-closed tenant_isolation
    /// policy, app_tenant SELECT/INSERT/UPDATE (no DELETE) and nothing for anon/authenticated. (2) On
    /// <c>assessment_provider_attempts</c>: the proctoring block the attempt's assignment carries (a snapshot, so a
    /// re-sent create sends the same block), the provider's <c>completed_by</c> and void reason. Existing rows keep NULL
    /// everywhere: no block was sent for them, which is exactly what they were created with.
    /// </summary>
    public partial class assessment_provider_proctoring : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "completed_by",
                table: "assessment_provider_attempts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "proctoring_anti_cheat_consequence",
                table: "assessment_provider_attempts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "proctoring_anti_cheat_threshold",
                table: "assessment_provider_attempts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "proctoring_identity_check",
                table: "assessment_provider_attempts",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "proctoring_lockdown",
                table: "assessment_provider_attempts",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "void_reason",
                table: "assessment_provider_attempts",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "assessment_provider_settings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    proctoring_lockdown = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    anti_cheat_threshold = table.Column<int>(type: "integer", nullable: true),
                    anti_cheat_consequence = table.Column<string>(type: "text", nullable: true),
                    identity_check = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    updated_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assessment_provider_settings", x => x.id);
                    table.CheckConstraint("ck_assessment_provider_settings_anti_cheat", "(anti_cheat_threshold IS NULL) = (anti_cheat_consequence IS NULL) AND (anti_cheat_threshold IS NULL OR anti_cheat_threshold BETWEEN 1 AND 20) AND (anti_cheat_consequence IS NULL OR anti_cheat_consequence IN ('warn', 'auto_submit', 'void'))");
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_assessment_provider_attempts_completed_by",
                table: "assessment_provider_attempts",
                sql: "completed_by IS NULL OR completed_by IN ('candidate', 'time_limit', 'proctoring_auto_submit')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_assessment_provider_attempts_proctoring",
                table: "assessment_provider_attempts",
                sql: "(proctoring_lockdown IS NULL) = (proctoring_identity_check IS NULL) AND (proctoring_anti_cheat_threshold IS NULL) = (proctoring_anti_cheat_consequence IS NULL) AND (proctoring_anti_cheat_threshold IS NULL OR proctoring_lockdown IS NOT NULL) AND (proctoring_anti_cheat_threshold IS NULL OR proctoring_anti_cheat_threshold BETWEEN 1 AND 20) AND (proctoring_anti_cheat_consequence IS NULL OR proctoring_anti_cheat_consequence IN ('warn', 'auto_submit', 'void'))");

            migrationBuilder.AddCheckConstraint(
                name: "ck_assessment_provider_attempts_void_reason",
                table: "assessment_provider_attempts",
                sql: "void_reason IS NULL OR void_reason IN ('proctoring_void', 'identity_check_failed', 'administrative_void', 'consent_withdrawn')");

            migrationBuilder.CreateIndex(
                name: "ux_assessment_provider_settings_org",
                table: "assessment_provider_settings",
                column: "organization_id",
                unique: true);

            // ORG-SCOPED and EF-OWNED (WP1.7 governance rail): ENABLE + FORCE + the fail-closed tenant_isolation policy.
            migrationBuilder.EnableTenantRls("assessment_provider_settings");

            // HR writes the settings through the tenant connection; the row is never deleted (an org turns settings off).
            migrationBuilder.Sql(
                "GRANT SELECT, INSERT, UPDATE ON assessment_provider_settings TO app_tenant;\n" +
                "REVOKE DELETE, TRUNCATE ON assessment_provider_settings FROM app_tenant;");

            // Supabase's API roles never touch the table. Guarded so the migration also runs where they do not exist.
            migrationBuilder.Sql(
                """
                DO $acl$
                DECLARE r text;
                BEGIN
                  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                      EXECUTE format('REVOKE ALL ON TABLE assessment_provider_settings FROM %I', r);
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
                name: "assessment_provider_settings");

            migrationBuilder.DropCheckConstraint(
                name: "ck_assessment_provider_attempts_completed_by",
                table: "assessment_provider_attempts");

            migrationBuilder.DropCheckConstraint(
                name: "ck_assessment_provider_attempts_proctoring",
                table: "assessment_provider_attempts");

            migrationBuilder.DropCheckConstraint(
                name: "ck_assessment_provider_attempts_void_reason",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "completed_by",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "proctoring_anti_cheat_consequence",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "proctoring_anti_cheat_threshold",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "proctoring_identity_check",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "proctoring_lockdown",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "void_reason",
                table: "assessment_provider_attempts");
        }
    }
}
