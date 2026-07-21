using Npgsql;

namespace Tims.IntegrationTests;

/// <summary>
/// CB-1b compliance control proof (SOC 2 CC7.2 / ISO 27001 A.8.15): the `audit_logs` admin/security-event
/// trail is APPEND-ONLY at the engine level — the TWIN of CB-1's data_access_logs control, via the SAME
/// reusable <c>AuditImmutability.BuildAppendOnlySql</c>. Runs on the raw <c>postgres</c> (owner+superuser)
/// connection, so only the trigger — not any GRANT — can stop these writes. Also proves (a) the SHARED guard
/// function reports THIS table via <c>TG_TABLE_NAME</c> (the reusability the CB-1 review fixed), and (b) the
/// documented FK-cascade constraint: a hard org delete cascades into audit_logs and is therefore BLOCKED.
/// </summary>
[Collection("AuditWriter")]
public sealed class AuditLogsImmutabilityTests(AuditWriterFixture fixture)
{
    private static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private readonly AuditWriterFixture _fixture = fixture;

    private static async Task InsertAsync(NpgsqlConnection connection, Guid id)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO audit_logs (id, organization_id, action, entity) VALUES (@id, @org, 'user_role_changed', 'user')";
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("org", OrgA);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task ExecAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<PostgresException> ExpectRaiseAsync(NpgsqlConnection connection, string sql) =>
        await Assert.ThrowsAsync<PostgresException>(() => ExecAsync(connection, sql));

    [Fact]
    public async Task AuditLogs_is_append_only_and_the_shared_guard_names_this_table()
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();

        var id = Guid.NewGuid();
        await InsertAsync(connection, id); // append works

        // The guard is SHARED with data_access_logs (CREATE OR REPLACE) — it must name THIS table via
        // TG_TABLE_NAME, never the other. (Before the CB-1 review M1 fix this reported the wrong table.)
        var update = await ExpectRaiseAsync(connection, $"UPDATE audit_logs SET action = 'tampered' WHERE id = '{id}'");
        Assert.Equal("42501", update.SqlState);
        Assert.Contains("audit_logs is append-only", update.MessageText, StringComparison.Ordinal);
        Assert.DoesNotContain("data_access_logs", update.MessageText, StringComparison.Ordinal);

        await ExpectRaiseAsync(connection, $"DELETE FROM audit_logs WHERE id = '{id}'");
        await ExpectRaiseAsync(connection, "TRUNCATE audit_logs");

        // replica-mode bypass closed by ENABLE ALWAYS.
        await ExecAsync(connection, "SET session_replication_role = 'replica'");
        await ExpectRaiseAsync(connection, $"DELETE FROM audit_logs WHERE id = '{id}'");
        await ExecAsync(connection, "SET session_replication_role = 'origin'");
    }

    [Fact]
    public async Task Org_hard_delete_is_blocked_by_the_audit_cascade_guard()
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();

        // An audit row for OrgA exists → deleting OrgA cascades to audit_logs → the row-level DELETE guard
        // raises → the whole org delete is aborted. This pins the documented FK-cascade constraint: once
        // audit_logs is immutable, a hard org/user delete needs a controlled privileged-exception (CB-6).
        await InsertAsync(connection, Guid.NewGuid());
        var ex = await ExpectRaiseAsync(connection, $"DELETE FROM organizations WHERE id = '{OrgA}'");
        Assert.Contains("audit_logs is append-only", ex.MessageText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task User_hard_delete_is_blocked_by_the_audit_setnull_guard()
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();

        // An audit row references the seeded user → deleting that user fires ON DELETE SET NULL, i.e. an
        // UPDATE of audit_logs.user_id → the immutability UPDATE guard raises → the user delete is aborted.
        // Pins the OTHER FK vector (the Prisma userId/actorId optional relations default to SET NULL).
        await using (var insert = connection.CreateCommand())
        {
            insert.CommandText =
                "INSERT INTO audit_logs (id, organization_id, user_id, action, entity) VALUES (@id, @org, @user, 'user_role_changed', 'user')";
            insert.Parameters.AddWithValue("id", Guid.NewGuid());
            insert.Parameters.AddWithValue("org", OrgA);
            insert.Parameters.AddWithValue("user", AuditWriterFixture.RealOwner);
            await insert.ExecuteNonQueryAsync();
        }

        var ex = await ExpectRaiseAsync(
            connection, $"DELETE FROM users_audit WHERE id = '{AuditWriterFixture.RealOwner}'");
        Assert.Contains("audit_logs is append-only", ex.MessageText, StringComparison.Ordinal);
    }
}
