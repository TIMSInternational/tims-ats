using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class assessment_provider_consent_capture : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "consent_capture_generation",
                table: "assessment_provider_attempts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "consent_capture_started_at",
                table: "assessment_provider_attempts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "consent_captures_in_flight",
                table: "assessment_provider_attempts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddCheckConstraint(
                name: "ck_assessment_provider_attempts_consent_capture",
                table: "assessment_provider_attempts",
                sql: "consent_capture_generation >= 0 AND consent_captures_in_flight >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_assessment_provider_attempts_consent_capture",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "consent_capture_generation",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "consent_capture_started_at",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "consent_captures_in_flight",
                table: "assessment_provider_attempts");
        }
    }
}
