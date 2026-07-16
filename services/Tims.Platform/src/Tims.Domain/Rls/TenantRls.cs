namespace Tims.Domain.Rls;

/// <summary>
/// WP1.7 governance rail. The canonical RLS block every NEW org-scoped EF table must ship
/// (encodes the FIT-engine lesson: an org-scoped table without RLS is a tenant-isolation
/// breach). Pure string generation lives in Domain so it is unit-testable without EF; the
/// thin <c>MigrationBuilder.EnableTenantRls("table")</c> wrapper in Tims.Infrastructure just
/// emits <see cref="BuildEnableTenantRlsSql"/> into a migration.
///
/// The emitted block matches the live Prisma policy (migration 20260604100000_enable_rls_
/// tenant_isolation): ENABLE + FORCE ROW LEVEL SECURITY + a fail-closed `tenant_isolation`
/// policy reading `organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid`
/// — so an unset GUC hides every row.
/// </summary>
public static class TenantRls
{
    public const string PolicyName = "tenant_isolation";
    public const string OrgColumn = "organization_id";
    public const string OrgGuc = "app.current_org_id";

    public static string BuildEnableTenantRlsSql(string table)
    {
        if (string.IsNullOrWhiteSpace(table))
        {
            throw new ArgumentException("table name is required", nameof(table));
        }

        var quoted = QuoteIdentifier(table);
        return
            $"ALTER TABLE {quoted} ENABLE ROW LEVEL SECURITY;\n" +
            $"ALTER TABLE {quoted} FORCE ROW LEVEL SECURITY;\n" +
            $"CREATE POLICY {PolicyName} ON {quoted}\n" +
            $"    USING ({OrgColumn} = NULLIF(current_setting('{OrgGuc}', true), '')::uuid);";
    }

    // Postgres identifier quoting: wrap in double quotes, escape embedded quotes. Table names
    // are developer-authored constants (never user input), but quoting keeps snake_case /
    // reserved words safe and defends against a malformed name slipping in.
    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
}

/// <summary>
/// Migration linter: given the org-scoped tables a migration CREATES and the tables it wraps
/// with <see cref="TenantRls"/>, returns the org-scoped tables that shipped WITHOUT RLS. A
/// non-empty result is the "org-scoped table created without EnableTenantRls" violation the
/// governance test asserts is caught.
/// </summary>
public static class RlsMigrationLinter
{
    public static IReadOnlyList<string> OrgScopedTablesMissingRls(
        IEnumerable<string> createdOrgScopedTables,
        IEnumerable<string> rlsProtectedTables)
    {
        var protectedSet = new HashSet<string>(rlsProtectedTables, StringComparer.Ordinal);
        return createdOrgScopedTables.Where(t => !protectedSet.Contains(t)).ToList();
    }
}
