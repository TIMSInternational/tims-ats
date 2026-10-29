using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class platform_audit_events : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Precheck: the append-only guard is SHARED with audit_logs/data_access_logs and already exists in
            // production. This migration references it and never (re)defines it; without it, fail before any DDL.
            migrationBuilder.Sql(
                """
                DO $pae_precheck$
                BEGIN
                    IF to_regprocedure('public.tims_append_only_guard()') IS NULL THEN
                        RAISE EXCEPTION 'platform_audit_events requires public.tims_append_only_guard(); apply the baseline first';
                    END IF;
                END $pae_precheck$;
                """);

            migrationBuilder.CreateTable(
                name: "platform_audit_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_id = table.Column<Guid>(type: "uuid", nullable: true),
                    action = table.Column<string>(type: "text", nullable: false),
                    entity = table.Column<string>(type: "text", nullable: false),
                    entity_id = table.Column<string>(type: "text", nullable: true),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: true),
                    changes = table.Column<string>(type: "jsonb", nullable: true),
                    metadata = table.Column<string>(type: "jsonb", nullable: true),
                    ip_address = table.Column<string>(type: "text", nullable: true),
                    user_agent = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_platform_audit_events", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_platform_audit_events_action_created_at",
                table: "platform_audit_events",
                columns: new[] { "action", "created_at" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ix_platform_audit_events_created_at",
                table: "platform_audit_events",
                column: "created_at",
                descending: new bool[0]);

            // Append-only at the engine level, exactly like audit_logs: row writes and TRUNCATE both raise, and
            // ENABLE ALWAYS keeps the guard firing under session_replication_role = replica.
            migrationBuilder.Sql("CREATE TRIGGER platform_audit_events_append_only BEFORE UPDATE OR DELETE ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION public.tims_append_only_guard();");
            migrationBuilder.Sql("ALTER TABLE platform_audit_events ENABLE ALWAYS TRIGGER platform_audit_events_append_only;");
            migrationBuilder.Sql("CREATE TRIGGER platform_audit_events_append_only_truncate BEFORE TRUNCATE ON platform_audit_events FOR EACH STATEMENT EXECUTE FUNCTION public.tims_append_only_guard();");
            migrationBuilder.Sql("ALTER TABLE platform_audit_events ENABLE ALWAYS TRIGGER platform_audit_events_append_only_truncate;");

            // Org-less platform table: NOT EnableTenantRls (there is no organization_id predicate to enforce).
            // RLS on with a RESTRICTIVE deny-all for app_tenant, and every tenant-role privilege removed, including
            // the ones Supabase's default privileges hand to each new public table. Only the platform (owner)
            // connection writes it. Not FORCEd: the owner connection is the sole writer.
            migrationBuilder.Sql("ALTER TABLE platform_audit_events ENABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("CREATE POLICY platform_audit_events_deny_tenant ON platform_audit_events AS RESTRICTIVE FOR ALL TO app_tenant USING (false) WITH CHECK (false);");
            migrationBuilder.Sql("REVOKE ALL ON platform_audit_events FROM PUBLIC, app_tenant, anon, authenticated;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "platform_audit_events");
        }
    }
}
