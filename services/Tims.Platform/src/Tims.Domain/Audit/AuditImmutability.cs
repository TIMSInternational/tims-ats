namespace Tims.Domain.Audit;

/// <summary>
/// Compliance control CB-1 (SOC 2 CC7.2 / ISO 27001 A.8.15 / SOC 1 audit trail): the canonical DB block that
/// makes an append-only audit table TAMPER-EVIDENT. The existing writer + GRANT (SELECT, INSERT only) express
/// append-only for the <c>app_tenant</c> role, but a GRANT is defeated by any role that DOES hold
/// UPDATE/DELETE (the table owner, a future mis-grant, a superuser-via-role). This adds ENGINE-LEVEL
/// immutability that survives privilege changes:
///   1. <c>REVOKE UPDATE, DELETE, TRUNCATE</c> from PUBLIC (belt-and-suspenders on the GRANT layer), and
///   2. a <c>BEFORE UPDATE OR DELETE</c> (row-level) + <c>BEFORE TRUNCATE</c> (statement-level) trigger that
///      RAISEs — a BEFORE trigger fires for EVERY role including the table owner and superusers (unless
///      <c>session_replication_role='replica'</c>), so no in-band actor can mutate or wipe the audit trail.
/// Pure string generation lives in Domain so it is unit-testable without a DB; the Testcontainers proof
/// (append still works; UPDATE/DELETE/TRUNCATE all raise, even as the owner) is the operating-effectiveness
/// evidence. Reusable for every append-only table (data_access_logs today; future audit tables next).
///
/// Prisma owns the <c>data_access_logs</c> DDL, so this is applied to prod via a hand-run SQL migration
/// (packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql) — Federico runs prod DDL.
/// </summary>
public static class AuditImmutability
{
    /// <summary>Shared, table-agnostic guard function (raises on any write it is attached to).</summary>
    public const string GuardFunction = "tims_append_only_guard";

    /// <summary>The tenant role that runs app queries (NOLOGIN/NOBYPASSRLS). An append-only table must not
    /// grant it UPDATE/DELETE — some prod tables were historically over-granted, so we revoke explicitly.</summary>
    public const string TenantRole = "app_tenant";

    public static string TriggerName(string table) => $"{table}_append_only";

    /// <summary>
    /// Emits the append-only hardening for <paramref name="table"/>: revoke mutating privileges from PUBLIC,
    /// (re)create the shared guard function, and (re)create the row-level UPDATE/DELETE + statement-level
    /// TRUNCATE triggers. Idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS) so it can be re-applied.
    /// </summary>
    public static string BuildAppendOnlySql(string table)
    {
        if (string.IsNullOrWhiteSpace(table))
        {
            throw new ArgumentException("table name is required", nameof(table));
        }

        var quoted = QuoteIdentifier(table);
        var trigger = QuoteIdentifier(TriggerName(table));
        var truncateTrigger = QuoteIdentifier(TriggerName(table) + "_truncate");
        return
            $"REVOKE UPDATE, DELETE, TRUNCATE ON {quoted} FROM PUBLIC;\n" +
            // Least-privilege: align the tenant role's grant with append-only (some prod tables were granted
            // UPDATE/DELETE historically). No-op where it was never granted. The trigger is the hard control;
            // this keeps grants honest (SOC 2 CC6.3 / ISO A.8.2). TRUNCATE included for parity with PUBLIC.
            $"REVOKE UPDATE, DELETE, TRUNCATE ON {quoted} FROM {TenantRole};\n" +
            $"CREATE OR REPLACE FUNCTION {GuardFunction}() RETURNS trigger AS $$\n" +
            "BEGIN\n" +
            // Table-agnostic message via TG_TABLE_NAME — the function is SHARED across every append-only table
            // (CREATE OR REPLACE), so baking a literal table name would make a second table's trigger report
            // the wrong table. TG_TABLE_NAME resolves to the table the trigger actually fired on.
            "    RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP\n" +
            "        USING ERRCODE = 'insufficient_privilege';\n" +
            "END;\n" +
            "$$ LANGUAGE plpgsql;\n" +
            $"DROP TRIGGER IF EXISTS {trigger} ON {quoted};\n" +
            $"CREATE TRIGGER {trigger}\n" +
            $"    BEFORE UPDATE OR DELETE ON {quoted}\n" +
            $"    FOR EACH ROW EXECUTE FUNCTION {GuardFunction}();\n" +
            // ENABLE ALWAYS so the guard fires even under `session_replication_role = 'replica'` (the classic
            // trigger-bypass a privileged actor could use). Closes that bypass; a DROP TRIGGER / DROP TABLE by
            // a superuser remains an out-of-band residual (CB-3 append-only log export catches it).
            $"ALTER TABLE {quoted} ENABLE ALWAYS TRIGGER {trigger};\n" +
            $"DROP TRIGGER IF EXISTS {truncateTrigger} ON {quoted};\n" +
            $"CREATE TRIGGER {truncateTrigger}\n" +
            $"    BEFORE TRUNCATE ON {quoted}\n" +
            $"    FOR EACH STATEMENT EXECUTE FUNCTION {GuardFunction}();\n" +
            $"ALTER TABLE {quoted} ENABLE ALWAYS TRIGGER {truncateTrigger};";
    }

    // Postgres identifier quoting (table names are developer constants, never user input; quoting keeps
    // snake_case / reserved words safe and defends against a malformed name).
    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
}
