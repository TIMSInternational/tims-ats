using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Tims.Infrastructure.Rls;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class assessment_providers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "assessment_provider_bindings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "text", nullable: false),
                    provider_tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    enabled_instruments = table.Column<string[]>(type: "text[]", nullable: false, defaultValueSql: "'{}'::text[]"),
                    default_locale = table.Column<string>(type: "text", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assessment_provider_bindings", x => x.id);
                    table.CheckConstraint("ck_assessment_provider_bindings_instruments", "enabled_instruments <@ ARRAY['lia', 'english', 'itcia', 'personality', 'mi', 'pca']::text[]");
                    table.CheckConstraint("ck_assessment_provider_bindings_locale", "default_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'");
                    table.CheckConstraint("ck_assessment_provider_bindings_provider", "provider = 'tims-assessments'");
                });

            migrationBuilder.CreateTable(
                name: "assessment_provider_webhook_inbox",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<string>(type: "text", nullable: false),
                    event_version = table.Column<int>(type: "integer", nullable: false),
                    provider_tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    occurred_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    delivery_attempt = table.Column<int>(type: "integer", nullable: true),
                    status = table.Column<string>(type: "text", nullable: false),
                    processing_attempts = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    last_error_code = table.Column<string>(type: "text", nullable: true),
                    data = table.Column<string>(type: "jsonb", nullable: false),
                    received_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    processed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assessment_provider_webhook_inbox", x => x.id);
                    table.CheckConstraint("ck_assessment_provider_webhook_inbox_attempts", "processing_attempts >= 0");
                    table.CheckConstraint("ck_assessment_provider_webhook_inbox_error_code", "last_error_code IS NULL OR char_length(last_error_code) <= 64");
                    table.CheckConstraint("ck_assessment_provider_webhook_inbox_status", "status IN ('received', 'processed', 'ignored', 'failed')");
                    table.CheckConstraint("ck_assessment_provider_webhook_inbox_type", "event_type IN ('assignment.started', 'session.completed', 'session.voided', 'result.ready', 'assignment.expired', 'assignment.voided', 'subject.erased')");
                    table.CheckConstraint("ck_assessment_provider_webhook_inbox_version", "event_version = 1");
                });

            migrationBuilder.CreateTable(
                name: "assessment_provider_attempts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    binding_id = table.Column<Guid>(type: "uuid", nullable: false),
                    candidate_id = table.Column<Guid>(type: "uuid", nullable: false),
                    vacancy_id = table.Column<Guid>(type: "uuid", nullable: false),
                    instrument = table.Column<string>(type: "text", nullable: false),
                    state = table.Column<string>(type: "text", nullable: false),
                    purpose = table.Column<string>(type: "text", nullable: false),
                    job_relatedness_reason = table.Column<string>(type: "text", nullable: false),
                    locale = table.Column<string>(type: "text", nullable: false),
                    time_multiplier = table.Column<decimal>(type: "numeric(3,2)", nullable: false),
                    aids = table.Column<string[]>(type: "text[]", nullable: false, defaultValueSql: "'{}'::text[]"),
                    requested_expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    provider_subject_id = table.Column<Guid>(type: "uuid", nullable: true),
                    provider_assignment_id = table.Column<Guid>(type: "uuid", nullable: true),
                    instrument_version = table.Column<string>(type: "text", nullable: true),
                    content_version = table.Column<string>(type: "text", nullable: true),
                    required_consents = table.Column<string[]>(type: "text[]", nullable: false, defaultValueSql: "'{}'::text[]"),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    started_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    last_launched_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    latest_result_id = table.Column<Guid>(type: "uuid", nullable: true),
                    last_error_code = table.Column<string>(type: "text", nullable: true),
                    withdrawal_state = table.Column<string>(type: "text", nullable: true),
                    provider_erasure_requested_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    assigned_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assessment_provider_attempts", x => x.id);
                    table.CheckConstraint("ck_assessment_provider_attempts_aids", "aids <@ ARRAY['extended_breaks', 'screen_reader', 'screen_magnification', 'high_contrast', 'assistive_input', 'captions_or_transcript', 'reader_assistance', 'separate_setting']::text[]");
                    table.CheckConstraint("ck_assessment_provider_attempts_content_version", "content_version IS NULL OR char_length(content_version) <= 64");
                    table.CheckConstraint("ck_assessment_provider_attempts_error_code", "last_error_code IS NULL OR char_length(last_error_code) <= 64");
                    table.CheckConstraint("ck_assessment_provider_attempts_external_ids", "state IN ('pending_create', 'cancelled') OR (provider_assignment_id IS NOT NULL AND provider_subject_id IS NOT NULL)");
                    table.CheckConstraint("ck_assessment_provider_attempts_instrument", "instrument IN ('lia', 'english', 'itcia', 'personality', 'mi', 'pca')");
                    table.CheckConstraint("ck_assessment_provider_attempts_instrument_version", "instrument_version IS NULL OR instrument_version ~ '^[0-9]{1,3}\\.[0-9]{1,3}$'");
                    table.CheckConstraint("ck_assessment_provider_attempts_locale", "locale ~ '^[a-z]{2}(-[A-Z]{2})?$'");
                    table.CheckConstraint("ck_assessment_provider_attempts_purpose", "purpose = 'selection'");
                    table.CheckConstraint("ck_assessment_provider_attempts_reason", "char_length(job_relatedness_reason) BETWEEN 3 AND 500");
                    table.CheckConstraint("ck_assessment_provider_attempts_withdrawal_state", "withdrawal_state IS NULL OR withdrawal_state IN ('pending', 'done')");
                    table.CheckConstraint("ck_assessment_provider_attempts_required_consents", "required_consents <@ ARRAY['assessment', 'biometric', 'voice', 'ai_scoring']::text[]");
                    table.CheckConstraint("ck_assessment_provider_attempts_state", "state IN ('pending_create', 'created', 'launched', 'in_progress', 'completed', 'result_ready', 'voided', 'expired', 'cancelled', 'erased')");
                    table.CheckConstraint("ck_assessment_provider_attempts_time_multiplier", "time_multiplier BETWEEN 1 AND 3");
                    table.ForeignKey(
                        name: "fk_assessment_provider_attempts_binding",
                        column: x => x.binding_id,
                        principalTable: "assessment_provider_bindings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "assessment_provider_results",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    attempt_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider_result_id = table.Column<Guid>(type: "uuid", nullable: false),
                    result_revision = table.Column<int>(type: "integer", nullable: false),
                    result_schema = table.Column<string>(type: "text", nullable: false),
                    instrument = table.Column<string>(type: "text", nullable: false),
                    instrument_version = table.Column<string>(type: "text", nullable: false),
                    content_version = table.Column<string>(type: "text", nullable: false),
                    content_sha256 = table.Column<string>(type: "text", nullable: false),
                    norm_version = table.Column<string>(type: "text", nullable: true),
                    scoring_version = table.Column<string>(type: "text", nullable: false),
                    scoring_method = table.Column<string>(type: "text", nullable: false),
                    purpose = table.Column<string>(type: "text", nullable: false),
                    validity_status = table.Column<string>(type: "text", nullable: false),
                    validity_reasons = table.Column<string[]>(type: "text[]", nullable: false, defaultValueSql: "'{}'::text[]"),
                    requires_human_review = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    completion = table.Column<string>(type: "text", nullable: false),
                    global_percentile = table.Column<double>(type: "double precision", nullable: true),
                    cefr = table.Column<string>(type: "text", nullable: true),
                    level = table.Column<int>(type: "integer", nullable: true),
                    time_multiplier_applied = table.Column<decimal>(type: "numeric(3,2)", nullable: false),
                    rendered_for = table.Column<string>(type: "text", nullable: false),
                    rendered_level = table.Column<string>(type: "text", nullable: false),
                    scores = table.Column<string>(type: "jsonb", nullable: true),
                    completed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    scored_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assessment_provider_results", x => x.id);
                    table.CheckConstraint("ck_assessment_provider_results_cefr", "cefr IS NULL OR cefr IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')");
                    table.CheckConstraint("ck_assessment_provider_results_completion", "completion IN ('complete', 'partial')");
                    table.CheckConstraint("ck_assessment_provider_results_instrument", "instrument IN ('lia', 'english', 'itcia', 'personality', 'mi', 'pca')");
                    table.CheckConstraint("ck_assessment_provider_results_level", "level IS NULL OR level BETWEEN 1 AND 5");
                    table.CheckConstraint("ck_assessment_provider_results_percentile", "global_percentile IS NULL OR (global_percentile >= 0 AND global_percentile <= 100)");
                    table.CheckConstraint("ck_assessment_provider_results_purpose", "purpose = 'selection'");
                    table.CheckConstraint("ck_assessment_provider_results_rendering", "rendered_for = 'tenant_hr' AND rendered_level IN ('summary', 'full')");
                    table.CheckConstraint("ck_assessment_provider_results_revision", "result_revision >= 1");
                    table.CheckConstraint("ck_assessment_provider_results_schema", "result_schema IN ('LiaResultV1', 'EnglishResultV1', 'ItciaResultV1', 'PersonalityResultV1', 'MiResultV1', 'PcaResultV1')");
                    table.CheckConstraint("ck_assessment_provider_results_scoring_method", "scoring_method IN ('deterministic', 'ai_assisted', 'provider')");
                    table.CheckConstraint("ck_assessment_provider_results_sha256", "content_sha256 ~ '^[a-f0-9]{64}$'");
                    table.CheckConstraint("ck_assessment_provider_results_time_multiplier", "time_multiplier_applied BETWEEN 1 AND 3");
                    table.CheckConstraint("ck_assessment_provider_results_validity", "validity_status IN ('valid', 'voided', 'needs_review')");
                    table.ForeignKey(
                        name: "fk_assessment_provider_results_attempt",
                        column: x => x.attempt_id,
                        principalTable: "assessment_provider_attempts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_assessment_provider_attempts_binding",
                table: "assessment_provider_attempts",
                column: "binding_id");

            migrationBuilder.CreateIndex(
                name: "ix_assessment_provider_attempts_candidate_vacancy",
                table: "assessment_provider_attempts",
                columns: new[] { "organization_id", "candidate_id", "vacancy_id" });

            migrationBuilder.CreateIndex(
                name: "ix_assessment_provider_attempts_subject",
                table: "assessment_provider_attempts",
                columns: new[] { "organization_id", "provider_subject_id" });

            migrationBuilder.CreateIndex(
                name: "ix_assessment_provider_attempts_withdrawal_pending",
                table: "assessment_provider_attempts",
                columns: new[] { "organization_id", "candidate_id" },
                filter: "withdrawal_state = 'pending'");

            migrationBuilder.CreateIndex(
                name: "ux_assessment_provider_attempts_open",
                table: "assessment_provider_attempts",
                columns: new[] { "organization_id", "candidate_id", "vacancy_id", "instrument" },
                unique: true,
                filter: "state IN ('pending_create', 'created', 'launched', 'in_progress', 'completed', 'result_ready')");

            migrationBuilder.CreateIndex(
                name: "ux_assessment_provider_attempts_provider_assignment",
                table: "assessment_provider_attempts",
                columns: new[] { "organization_id", "provider_assignment_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_assessment_provider_bindings_org_provider",
                table: "assessment_provider_bindings",
                columns: new[] { "organization_id", "provider" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_assessment_provider_bindings_provider_tenant",
                table: "assessment_provider_bindings",
                columns: new[] { "provider", "provider_tenant_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_assessment_provider_results_attempt",
                table: "assessment_provider_results",
                column: "attempt_id");

            migrationBuilder.CreateIndex(
                name: "ux_assessment_provider_results_provider_result",
                table: "assessment_provider_results",
                columns: new[] { "organization_id", "provider_result_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_assessment_provider_webhook_inbox_event",
                table: "assessment_provider_webhook_inbox",
                columns: new[] { "organization_id", "event_id" },
                unique: true);

            // The erasure tombstone lookup (AssessmentProviderRepository.IsSubjectErasedAsync): a recorded
            // subject.erased event for a provider subject. An expression index EF cannot model, so raw SQL.
            migrationBuilder.Sql(
                "CREATE INDEX ix_assessment_provider_webhook_inbox_erased_subject ON assessment_provider_webhook_inbox " +
                "(organization_id, lower(data->>'subject_id')) WHERE event_type = 'subject.erased';");

            // All four tables are ORG-SCOPED and EF-OWNED → ship RLS with the tables (WP1.7 governance rail):
            // ENABLE + FORCE + the fail-closed tenant_isolation policy (USING doubles as WITH CHECK).
            migrationBuilder.EnableTenantRls("assessment_provider_bindings");
            migrationBuilder.EnableTenantRls("assessment_provider_attempts");
            migrationBuilder.EnableTenantRls("assessment_provider_results");
            migrationBuilder.EnableTenantRls("assessment_provider_webhook_inbox");

            // Least privilege for the tenant role. Production's default ACL grants app_tenant SELECT/INSERT/UPDATE/DELETE
            // on every new table, so the narrower ones are REVOKEd explicitly:
            //   bindings — SELECT only: written by the platform owner on the privileged connection, never by a tenant.
            //   inbox    — no DELETE: rows are the delivery audit trail (retention is a privileged sweep).
            migrationBuilder.Sql(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_provider_attempts TO app_tenant;\n" +
                "GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_provider_results TO app_tenant;\n" +
                "GRANT SELECT, INSERT, UPDATE ON assessment_provider_webhook_inbox TO app_tenant;\n" +
                "REVOKE DELETE, TRUNCATE ON assessment_provider_webhook_inbox FROM app_tenant;\n" +
                "GRANT SELECT ON assessment_provider_bindings TO app_tenant;\n" +
                "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON assessment_provider_bindings FROM app_tenant;");

            // Supabase's API roles never touch these tables. Guarded so the migration also runs where they do not exist
            // (Testcontainers, a local Postgres); same pattern as 20261001120000_consent_evidence_withdrawal.
            migrationBuilder.Sql(
                """
                DO $acl$
                DECLARE r text;
                BEGIN
                  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                      EXECUTE format('REVOKE ALL ON TABLE assessment_provider_bindings, assessment_provider_attempts, assessment_provider_results, assessment_provider_webhook_inbox FROM %I', r);
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
                name: "assessment_provider_results");

            migrationBuilder.DropTable(
                name: "assessment_provider_webhook_inbox");

            migrationBuilder.DropTable(
                name: "assessment_provider_attempts");

            migrationBuilder.DropTable(
                name: "assessment_provider_bindings");
        }
    }
}
