using Microsoft.EntityFrameworkCore.Migrations;
using Tims.Domain.Rls;

namespace Tims.Infrastructure.Rls;

/// <summary>
/// WP1.7 — the <c>EnableTenantRls("table")</c> EF migration helper. A new org-scoped C# table
/// cannot ship without RLS: call this in a migration's <c>Up</c> right after CreateTable and it
/// emits the canonical ENABLE + FORCE + fail-closed <c>tenant_isolation</c> policy block
/// (<see cref="TenantRls.BuildEnableTenantRlsSql"/>).
/// </summary>
public static class MigrationBuilderRlsExtensions
{
    public static void EnableTenantRls(this MigrationBuilder migrationBuilder, string table)
    {
        ArgumentNullException.ThrowIfNull(migrationBuilder);
        migrationBuilder.Sql(TenantRls.BuildEnableTenantRlsSql(table));
    }
}
