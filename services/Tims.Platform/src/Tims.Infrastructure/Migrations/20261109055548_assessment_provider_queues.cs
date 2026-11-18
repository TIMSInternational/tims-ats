using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class assessment_provider_queues : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "lease_owner",
                table: "assessment_provider_webhook_inbox",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "lease_until",
                table: "assessment_provider_webhook_inbox",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "next_attempt_at",
                table: "assessment_provider_webhook_inbox",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "create_started_at",
                table: "assessment_provider_attempts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string[]>(
                name: "declined_optional_consents",
                table: "assessment_provider_attempts",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddColumn<string[]>(
                name: "granted_optional_consents",
                table: "assessment_provider_attempts",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddColumn<Guid>(
                name: "withdrawal_lease_owner",
                table: "assessment_provider_attempts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "withdrawal_lease_until",
                table: "assessment_provider_attempts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_assessment_provider_webhook_inbox_due",
                table: "assessment_provider_webhook_inbox",
                columns: new[] { "organization_id", "next_attempt_at" },
                filter: "next_attempt_at IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_assessment_provider_webhook_inbox_lease",
                table: "assessment_provider_webhook_inbox",
                sql: "(lease_owner IS NULL) = (lease_until IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_assessment_provider_attempts_optional_consents",
                table: "assessment_provider_attempts",
                sql: "granted_optional_consents <@ ARRAY['assessment', 'biometric', 'voice', 'ai_scoring']::text[] AND declined_optional_consents <@ ARRAY['assessment', 'biometric', 'voice', 'ai_scoring']::text[] AND NOT (granted_optional_consents && declined_optional_consents)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_assessment_provider_attempts_withdrawal_lease",
                table: "assessment_provider_attempts",
                sql: "(withdrawal_lease_owner IS NULL) = (withdrawal_lease_until IS NULL)");

            // Rows recorded before the inbox became a work queue and not final yet are due at once, so the worker picks
            // them up; processed and ignored rows stay final (next_attempt_at NULL).
            migrationBuilder.Sql(
                "UPDATE assessment_provider_webhook_inbox SET next_attempt_at = received_at "
                + "WHERE status IN ('received', 'failed') AND next_attempt_at IS NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_assessment_provider_webhook_inbox_due",
                table: "assessment_provider_webhook_inbox");

            migrationBuilder.DropCheckConstraint(
                name: "ck_assessment_provider_webhook_inbox_lease",
                table: "assessment_provider_webhook_inbox");

            migrationBuilder.DropCheckConstraint(
                name: "ck_assessment_provider_attempts_optional_consents",
                table: "assessment_provider_attempts");

            migrationBuilder.DropCheckConstraint(
                name: "ck_assessment_provider_attempts_withdrawal_lease",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "lease_owner",
                table: "assessment_provider_webhook_inbox");

            migrationBuilder.DropColumn(
                name: "lease_until",
                table: "assessment_provider_webhook_inbox");

            migrationBuilder.DropColumn(
                name: "next_attempt_at",
                table: "assessment_provider_webhook_inbox");

            migrationBuilder.DropColumn(
                name: "create_started_at",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "declined_optional_consents",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "granted_optional_consents",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "withdrawal_lease_owner",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "withdrawal_lease_until",
                table: "assessment_provider_attempts");
        }
    }
}
