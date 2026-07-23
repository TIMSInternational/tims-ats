using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class fx_rates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "fx_rates",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    base_currency = table.Column<string>(type: "text", nullable: false),
                    quote_currency = table.Column<string>(type: "text", nullable: false),
                    rate = table.Column<double>(type: "double precision", nullable: false),
                    as_of = table.Column<DateOnly>(type: "date", nullable: false),
                    fetched_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    source = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fx_rates", x => x.id);
                });

            // RLS-EXEMPT (global catalog, like ai_agents/permissions/platform_owner_emails): fx_rates is
            // org-agnostic SHARED data — a tenant GUC would hide every row. So DELIBERATELY DO NOT call
            // EnableTenantRls. The daily FxRefreshJob writes on the PRIVILEGED/owner connection (all
            // privileges); the tenant role only ever SELECTs a pin as a sub-query of a comp read, so GRANT it
            // SELECT ONLY. (Slice 11c — see docs/architecture/table-ownership.md note "fx".)
            migrationBuilder.Sql("GRANT SELECT ON fx_rates TO app_tenant;");

            migrationBuilder.CreateIndex(
                name: "ux_fx_rates_base_quote_asof",
                table: "fx_rates",
                columns: new[] { "base_currency", "quote_currency", "as_of" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "fx_rates");
        }
    }
}
