using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class assessment_provider_attempt_job_code : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "job_code",
                table: "assessment_provider_attempts",
                type: "text",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_assessment_provider_attempts_job_code",
                table: "assessment_provider_attempts",
                sql: "job_code IS NULL OR (instrument = 'pca' AND job_code ~ '^[A-Za-z0-9_-]{2,30}$')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_assessment_provider_attempts_job_code",
                table: "assessment_provider_attempts");

            migrationBuilder.DropColumn(
                name: "job_code",
                table: "assessment_provider_attempts");
        }
    }
}
