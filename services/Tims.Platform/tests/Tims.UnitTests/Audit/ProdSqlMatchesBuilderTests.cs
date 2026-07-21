using Tims.Domain.Audit;

namespace Tims.UnitTests.Audit;

/// <summary>
/// Drift-pin (CB-1 review M3): the hand-run prod DDL
/// <c>packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql</c> is the artifact that actually
/// hits production — its non-comment body MUST stay byte-identical to the TESTED
/// <see cref="AuditImmutability.BuildAppendOnlySql"/>("data_access_logs"). Editing either side without the
/// other turns this red, so the proven builder and the prod script can never silently diverge.
/// </summary>
public sealed class ProdSqlMatchesBuilderTests
{
    [Theory]
    [InlineData("data_access_logs", "2026-07-17-data-access-logs-immutable.sql")]
    [InlineData("audit_logs", "2026-07-17-audit-logs-immutable.sql")]
    public void ProdImmutabilitySql_body_matches_the_builder_output(string table, string fileName)
    {
        var sqlPath = Path.Combine(FindRepoRoot(), "packages", "db", "prisma", "manual", fileName);
        Assert.True(File.Exists(sqlPath), $"prod SQL not found at {sqlPath}");

        var fileBody = StripCommentsAndBlanks(File.ReadAllText(sqlPath));
        var builderBody = StripCommentsAndBlanks(AuditImmutability.BuildAppendOnlySql(table));

        Assert.Equal(builderBody, fileBody);
    }

    // Drop SQL line comments (-- ...) and blank lines; normalize CRLF; trim.
    private static string StripCommentsAndBlanks(string sql) =>
        string.Join(
            '\n',
            sql.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n')
                .Where(line => line.Trim().Length > 0 && !line.TrimStart().StartsWith("--", StringComparison.Ordinal)))
            .Trim();

    // Walk up from the test bin dir until the manual-migrations directory is found (repo-root marker).
    private static string FindRepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "packages", "db", "prisma", "manual")))
            {
                return dir.FullName;
            }
        }

        throw new DirectoryNotFoundException(
            "repo root (packages/db/prisma/manual) not found from " + AppContext.BaseDirectory);
    }
}
