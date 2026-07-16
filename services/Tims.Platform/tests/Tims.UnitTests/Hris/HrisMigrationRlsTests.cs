using System.Text.RegularExpressions;
using Tims.Domain.Rls;

namespace Tims.UnitTests.Hris;

/// <summary>
/// WP3.1 governance acceptance: the REAL first EF migration (20260716000000_hris_domain) must
/// RLS-wrap every org-scoped table it creates. This parses the migration source, derives the
/// org-scoped tables it creates (those with an <c>organization_id</c> column) and the tables it wraps
/// with <c>EnableTenantRls</c>, and asserts <see cref="RlsMigrationLinter.OrgScopedTablesMissingRls"/>
/// is empty — i.e. no HRIS table shipped org-scoped-without-RLS. A negative control proves the linter
/// would BITE if a wrap were forgotten.
/// </summary>
public sealed partial class HrisMigrationRlsTests
{
    private static readonly string[] ExpectedHrisTables =
    [
        "hris_connectors",
        "hris_external_employees",
        "hris_sync_runs",
        "hris_sync_record_errors",
    ];

    [Fact]
    public void Migration_rls_wraps_every_org_scoped_hris_table()
    {
        var migration = ReadMigrationSource();
        var orgScopedCreated = OrgScopedCreatedTables(migration);
        var rlsProtected = RlsProtectedTables(migration);

        // All four HRIS tables are org-scoped and were created by this migration.
        Assert.Equal(
            ExpectedHrisTables.OrderBy(t => t, StringComparer.Ordinal),
            orgScopedCreated.OrderBy(t => t, StringComparer.Ordinal));

        // None of them is org-scoped-without-RLS.
        Assert.Empty(RlsMigrationLinter.OrgScopedTablesMissingRls(orgScopedCreated, rlsProtected));
    }

    [Fact]
    public void Linter_would_bite_if_one_hris_wrap_were_forgotten()
    {
        var migration = ReadMigrationSource();
        var orgScopedCreated = OrgScopedCreatedTables(migration);

        // Drop one real wrap → the linter must flag exactly that table.
        var protectedMinusOne = RlsProtectedTables(migration)
            .Where(t => t != "hris_external_employees")
            .ToList();

        var missing = RlsMigrationLinter.OrgScopedTablesMissingRls(orgScopedCreated, protectedMinusOne);

        Assert.Equal(["hris_external_employees"], missing);
    }

    /// <summary>Tables the migration CREATEs whose column list declares an <c>organization_id</c> column.</summary>
    private static List<string> OrgScopedCreatedTables(string migration)
    {
        var orgScoped = new List<string>();
        // Each CreateTable(...) block runs until the next `migrationBuilder.` call.
        foreach (var block in migration.Split("migrationBuilder.CreateTable(").Skip(1))
        {
            var body = block.Split("migrationBuilder.", StringSplitOptions.None)[0];
            var name = TableNameRegex().Match(body);
            if (name.Success && body.Contains("organization_id", StringComparison.Ordinal))
            {
                orgScoped.Add(name.Groups[1].Value);
            }
        }
        return orgScoped;
    }

    /// <summary>Tables wrapped with <c>EnableTenantRls("…")</c> in the migration.</summary>
    private static List<string> RlsProtectedTables(string migration) =>
        EnableTenantRlsRegex().Matches(migration).Select(m => m.Groups[1].Value).ToList();

    private static string ReadMigrationSource()
    {
        var path = Path.Combine(
            SolutionRoot(), "src", "Tims.Infrastructure", "Migrations", "20260716000000_hris_domain.cs");
        Assert.True(File.Exists(path), $"missing migration: {path}");
        return File.ReadAllText(path);
    }

    private static string SolutionRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Tims.Platform.slnx")))
        {
            dir = dir.Parent;
        }
        return dir?.FullName ?? throw new InvalidOperationException("Tims.Platform.slnx not found walking up from test bin");
    }

    [GeneratedRegex(@"name:\s*""([^""]+)""")]
    private static partial Regex TableNameRegex();

    [GeneratedRegex(@"EnableTenantRls\(""([^""]+)""\)")]
    private static partial Regex EnableTenantRlsRegex();
}
