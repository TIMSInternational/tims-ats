using Npgsql;

namespace Tims.IntegrationTests;

/// <summary>
/// CB-1 compliance control proof (SOC 2 CC7.2 / ISO 27001 A.8.15 / SOC 1 audit trail): the
/// <c>data_access_logs</c> audit table is APPEND-ONLY at the database engine level. Every command here runs
/// on the raw <c>postgres</c> connection — the table OWNER + a superuser — so the GRANT layer alone (SELECT,
/// INSERT to app_tenant) would NOT stop these writes; only the BEFORE UPDATE/DELETE/TRUNCATE trigger does.
/// Proves the trigger BITES: append still works, but UPDATE / DELETE / TRUNCATE all raise, so no in-band
/// actor (not even the owner) can tamper with or wipe the audit trail.
/// </summary>
[Collection("AuditWriter")]
public sealed class AuditImmutabilityTests(AuditWriterFixture fixture)
{
    private readonly AuditWriterFixture _fixture = fixture;

    private static async Task InsertRowAsync(NpgsqlConnection connection, Guid recordId)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            INSERT INTO data_access_logs (id, organization_id, actor_id, data_type, record_id, action)
            VALUES (gen_random_uuid(), @org, @actor, 'invoice', @rid, 'read');
            """;
        command.Parameters.AddWithValue("org", AuditWriterFixture.OrgA);
        command.Parameters.AddWithValue("actor", AuditWriterFixture.RealOwner);
        command.Parameters.AddWithValue("rid", recordId);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<PostgresException> ExpectRaiseAsync(NpgsqlConnection connection, string sql)
    {
        return await Assert.ThrowsAsync<PostgresException>(async () =>
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        });
    }

    [Fact]
    public async Task DataAccessLog_is_append_only_update_delete_truncate_blocked_even_for_owner()
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();

        var recordId = Guid.NewGuid();
        await InsertRowAsync(connection, recordId); // append works
        Assert.Equal(1, await _fixture.CountRowsAsync(recordId));

        // UPDATE → blocked by the BEFORE UPDATE trigger; the RAISE sets SQLSTATE 42501 (insufficient_privilege).
        var update = await ExpectRaiseAsync(
            connection, $"UPDATE data_access_logs SET action = 'tampered' WHERE record_id = '{recordId}'");
        Assert.Equal("42501", update.SqlState);
        Assert.Contains("append-only", update.MessageText, StringComparison.Ordinal);

        // DELETE → blocked.
        await ExpectRaiseAsync(connection, $"DELETE FROM data_access_logs WHERE record_id = '{recordId}'");

        // TRUNCATE → blocked by the statement-level BEFORE TRUNCATE trigger (the classic "wipe the logs" path).
        await ExpectRaiseAsync(connection, "TRUNCATE data_access_logs");

        // session_replication_role='replica' is the classic way a privileged actor silently bypasses triggers.
        // ENABLE ALWAYS keeps the guard firing → DELETE is STILL blocked. (Without ENABLE ALWAYS this DELETE
        // would succeed and this assertion would fail — the bite that proves the hardening.)
        await using (var replica = connection.CreateCommand())
        {
            replica.CommandText = "SET session_replication_role = 'replica'";
            await replica.ExecuteNonQueryAsync();
        }

        await ExpectRaiseAsync(connection, $"DELETE FROM data_access_logs WHERE record_id = '{recordId}'");

        await using (var origin = connection.CreateCommand())
        {
            origin.CommandText = "SET session_replication_role = 'origin'";
            await origin.ExecuteNonQueryAsync();
        }

        // The row is intact, and a fresh append still succeeds (append-only, NOT read-only).
        Assert.Equal(1, await _fixture.CountRowsAsync(recordId));
        var secondId = Guid.NewGuid();
        await InsertRowAsync(connection, secondId);
        Assert.Equal(1, await _fixture.CountRowsAsync(secondId));
    }
}
