using Tims.Domain.Audit;

namespace Tims.UnitTests.Audit;

/// <summary>
/// Unit-pins the CB-1 append-only SQL builder (Domain, DB-free). The Testcontainers proof
/// (Tims.IntegrationTests.AuditImmutabilityTests) verifies it actually blocks UPDATE/DELETE/TRUNCATE against
/// a real Postgres; these assert the emitted block carries every clause the control requires.
/// </summary>
public sealed class AuditImmutabilityTests
{
    [Fact]
    public void BuildAppendOnlySql_emits_revoke_guard_and_triggers()
    {
        var sql = AuditImmutability.BuildAppendOnlySql("data_access_logs");

        // 1) mutating privileges revoked from PUBLIC + the tenant role (least-privilege; prod over-grant fix),
        // TRUNCATE included on both for parity.
        Assert.Contains("REVOKE UPDATE, DELETE, TRUNCATE ON \"data_access_logs\" FROM PUBLIC;", sql, StringComparison.Ordinal);
        Assert.Contains("REVOKE UPDATE, DELETE, TRUNCATE ON \"data_access_logs\" FROM app_tenant;", sql, StringComparison.Ordinal);
        // 2) the shared guard function that RAISEs.
        Assert.Contains($"CREATE OR REPLACE FUNCTION {AuditImmutability.GuardFunction}()", sql, StringComparison.Ordinal);
        Assert.Contains("RAISE EXCEPTION", sql, StringComparison.Ordinal);
        Assert.Contains("insufficient_privilege", sql, StringComparison.Ordinal);
        // Table-agnostic message (shared function across tables) — must use TG_TABLE_NAME, not a baked literal.
        Assert.Contains("TG_TABLE_NAME", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("'data_access_logs is append-only", sql, StringComparison.Ordinal);
        // 3) row-level UPDATE/DELETE guard + statement-level TRUNCATE guard, with FULLY-QUOTED trigger names
        // (the truncate trigger name must be quoted as a whole — a `"name"_truncate` split is a syntax error).
        Assert.Contains("CREATE TRIGGER \"data_access_logs_append_only\"", sql, StringComparison.Ordinal);
        Assert.Contains("BEFORE UPDATE OR DELETE ON \"data_access_logs\"", sql, StringComparison.Ordinal);
        Assert.Contains("CREATE TRIGGER \"data_access_logs_append_only_truncate\"", sql, StringComparison.Ordinal);
        Assert.Contains("BEFORE TRUNCATE ON \"data_access_logs\"", sql, StringComparison.Ordinal);
        Assert.Contains("FOR EACH STATEMENT", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("\"_truncate", sql, StringComparison.Ordinal); // no malformed split-quote name
        // 4) ENABLE ALWAYS so the guards fire even under session_replication_role='replica'.
        Assert.Contains("ENABLE ALWAYS TRIGGER \"data_access_logs_append_only\"", sql, StringComparison.Ordinal);
        Assert.Contains("ENABLE ALWAYS TRIGGER \"data_access_logs_append_only_truncate\"", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void BuildAppendOnlySql_rejects_blank_table() =>
        Assert.Throws<ArgumentException>(() => AuditImmutability.BuildAppendOnlySql("  "));
}
