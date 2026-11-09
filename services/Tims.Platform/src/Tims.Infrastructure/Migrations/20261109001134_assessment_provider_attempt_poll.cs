using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class assessment_provider_attempt_poll : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "last_polled_at",
                table: "assessment_provider_attempts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string[]>(
                name: "missing_consents",
                table: "assessment_provider_attempts",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddColumn<Guid>(
                name: "poll_lease_owner",
                table: "assessment_provider_attempts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "poll_lease_until",
                table: "assessment_provider_attempts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_assessment_provider_attempts_poll",
                table: "assessment_provider_attempts",
                columns: new[] { "organization_id", "last_polled_at" },
                filter: "provider_assignment_id IS NOT NULL AND withdrawal_state IS NULL AND provider_erasure_requested_at IS NULL AND state IN ('created', 'launched', 'in_progress', 'completed', 'result_ready')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_assessment_provider_attempts_missing_consents",
                table: "assessment_provider_attempts",
                sql: "missing_consents <@ ARRAY['assessment', 'biometric', 'voice', 'ai_scoring']::text[]");

            migrationBuilder.AddCheckConstraint(
                name: "ck_assessment_provider_attempts_poll_lease",
                table: "assessment_provider_attempts",
                sql: "(poll_lease_owner IS NULL) = (poll_lease_until IS NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_assessment_provider_attempts_poll",
                table: "assessment_provider_attempts");

            migrationBuilder.DropCheckConstraint(
                name: "ck_assessment_provider_attempts_missing_consents",
                table: "assessment_provider_attempts");

            migrationBuilder.DropCheckConstraint(
                name: "ck_assessment_provider_attempts_poll_lease",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "last_polled_at",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "missing_consents",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "poll_lease_owner",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "poll_lease_until",
                table: "assessment_provider_attempts");
        }
    }
}
