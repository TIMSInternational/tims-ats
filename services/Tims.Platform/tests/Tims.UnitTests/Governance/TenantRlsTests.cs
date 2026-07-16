using Tims.Domain.Rls;

namespace Tims.UnitTests.Governance;

/// <summary>
/// WP1.7 acceptance: the EnableTenantRls block is the canonical fail-closed policy, and the
/// migration linter CATCHES an org-scoped table created without RLS.
/// </summary>
public sealed class TenantRlsTests
{
    [Fact]
    public void BuildEnableTenantRlsSql_emits_enable_force_and_failclosed_policy()
    {
        var sql = TenantRls.BuildEnableTenantRlsSql("employee_compensation");

        const string expected =
            "ALTER TABLE \"employee_compensation\" ENABLE ROW LEVEL SECURITY;\n" +
            "ALTER TABLE \"employee_compensation\" FORCE ROW LEVEL SECURITY;\n" +
            "CREATE POLICY tenant_isolation ON \"employee_compensation\"\n" +
            "    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);";

        Assert.Equal(expected, sql);
    }

    [Fact]
    public void BuildEnableTenantRlsSql_rejects_empty_table()
    {
        Assert.Throws<ArgumentException>(() => TenantRls.BuildEnableTenantRlsSql(""));
    }

    [Fact]
    public void Linter_catches_org_scoped_table_created_without_rls()
    {
        // A migration that creates two org-scoped tables but only wraps one with EnableTenantRls.
        var created = new[] { "employee_profile", "employee_document" };
        var rlsProtected = new[] { "employee_profile" }; // employee_document was forgotten

        var missing = RlsMigrationLinter.OrgScopedTablesMissingRls(created, rlsProtected);

        Assert.Equal(["employee_document"], missing);
    }

    [Fact]
    public void Linter_is_clean_when_every_org_scoped_table_has_rls()
    {
        var created = new[] { "employee_profile", "employee_document" };
        var rlsProtected = new[] { "employee_profile", "employee_document" };

        Assert.Empty(RlsMigrationLinter.OrgScopedTablesMissingRls(created, rlsProtected));
    }
}
