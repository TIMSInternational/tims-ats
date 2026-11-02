using Npgsql;
using static Tims.IntegrationTests.PlatformOwners.PlatformAuditEventsSchemaFixture;

namespace Tims.IntegrationTests.PlatformOwners;

/// <summary>
/// WP-03 PR-5a: <c>platform_audit_events</c> exists after the migration with the planned shape, is append-only at
/// the engine level (even for the owner and under replica mode), gives tenant roles no access despite Supabase's
/// default privileges, creates no other table, and its hand-applied script is idempotent, refuses to run without
/// the shared guard, and rolls back cleanly through its ROLLBACK twin.
/// </summary>
[Collection(nameof(PlatformAuditEventsSchemaCollection))]
public sealed class PlatformAuditEventsSchemaTests(PlatformAuditEventsSchemaFixture fixture)
{
    private const string TableExists = "SELECT to_regclass('public.platform_audit_events') IS NOT NULL";

    private const string PrecheckMessage = "platform_audit_events requires public.tims_append_only_guard()";

    private static readonly string[] TenantRoles = ["app_tenant", "anon", "authenticated"];

    private readonly PlatformAuditEventsSchemaFixture _fixture = fixture;

    private async Task<string> MigratedAsync()
    {
        var connectionString = await _fixture.FreshDatabaseAsync();
        await ApplyEfMigrationAsync(connectionString);
        return connectionString;
    }

    private static async Task InsertAsync(string connectionString, Guid id)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO platform_audit_events (id, action, entity) VALUES (@id, 'platform_owner_granted', 'platform_owner')";
        command.Parameters.AddWithValue("id", id);
        await command.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task Ef_migration_creates_the_table_with_the_planned_columns()
    {
        var cs = await MigratedAsync();

        Assert.True(await ScalarAsync<bool>(cs, TableExists));
        var columns = await ColumnAsync(
            cs,
            """
            SELECT column_name || ':' || data_type || ':' || is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'platform_audit_events'
            ORDER BY column_name
            """);
        Assert.Equal(
            new[]
            {
                "action:text:NO",
                "actor_id:uuid:YES",
                "changes:jsonb:YES",
                "created_at:timestamp with time zone:NO",
                "entity:text:NO",
                "entity_id:text:YES",
                "id:uuid:NO",
                "ip_address:text:YES",
                "metadata:jsonb:YES",
                "organization_id:uuid:YES",
                "user_agent:text:YES",
            },
            columns);

        // created_at defaults to now(), so a writer that omits it still gets a timestamp.
        var id = Guid.NewGuid();
        await InsertAsync(cs, id);
        Assert.True(await ScalarAsync<bool>(
            cs, $"SELECT created_at IS NOT NULL FROM platform_audit_events WHERE id = '{id}'"));
    }

    [Fact]
    public async Task Ef_migration_has_no_foreign_keys_and_indexes_created_at_and_action()
    {
        var cs = await MigratedAsync();

        Assert.Equal(0L, await ScalarAsync<long>(
            cs,
            "SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.platform_audit_events'::regclass AND contype = 'f'"));

        var indexes = await ColumnAsync(
            cs,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'platform_audit_events'");
        Assert.Contains(indexes, d => d.EndsWith("USING btree (created_at DESC)", StringComparison.Ordinal));
        Assert.Contains(indexes, d => d.EndsWith("USING btree (action, created_at DESC)", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Ef_migration_creates_no_table_other_than_platform_audit_events()
    {
        var cs = await MigratedAsync();

        var tables = await ColumnAsync(
            cs, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
        Assert.Equal(new[] { "__EFMigrationsHistory", "platform_audit_events" }, tables);
    }

    [Fact]
    public async Task Update_delete_and_truncate_raise_the_append_only_error_even_in_replica_mode()
    {
        var cs = await MigratedAsync();
        var id = Guid.NewGuid();
        await InsertAsync(cs, id);

        var update = await Assert.ThrowsAsync<PostgresException>(() =>
            ExecAsync(cs, $"UPDATE platform_audit_events SET action = 'tampered' WHERE id = '{id}'"));
        Assert.Equal("42501", update.SqlState);
        Assert.Contains("platform_audit_events is append-only: UPDATE", update.MessageText, StringComparison.Ordinal);

        var delete = await Assert.ThrowsAsync<PostgresException>(() =>
            ExecAsync(cs, $"DELETE FROM platform_audit_events WHERE id = '{id}'"));
        Assert.Contains("platform_audit_events is append-only: DELETE", delete.MessageText, StringComparison.Ordinal);

        var truncate = await Assert.ThrowsAsync<PostgresException>(() =>
            ExecAsync(cs, "TRUNCATE platform_audit_events"));
        Assert.Contains("platform_audit_events is append-only: TRUNCATE", truncate.MessageText, StringComparison.Ordinal);

        // ENABLE ALWAYS: the guard still fires when replication-role trigger bypass is attempted.
        await Assert.ThrowsAsync<PostgresException>(() => ExecAsync(
            cs,
            $"SET session_replication_role = 'replica'; DELETE FROM platform_audit_events WHERE id = '{id}'"));

        Assert.Equal(1L, await ScalarAsync<long>(cs, "SELECT count(*) FROM platform_audit_events"));
    }

    [Fact]
    public async Task Tenant_roles_have_no_privileges_despite_default_grants_and_rls_denies_app_tenant()
    {
        var cs = await MigratedAsync();

        foreach (var role in TenantRoles)
        {
            foreach (var privilege in new[] { "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER" })
            {
                Assert.False(
                    await ScalarAsync<bool>(
                        cs, $"SELECT has_table_privilege('{role}', 'public.platform_audit_events', '{privilege}')"),
                    $"{role} holds {privilege} on platform_audit_events");
            }
        }

        Assert.True(await ScalarAsync<bool>(
            cs, "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_audit_events'::regclass"));
        Assert.Equal("app_tenant:false:false:RESTRICTIVE", await ScalarAsync<string>(
            cs,
            """
            SELECT array_to_string(roles, ',') || ':' || qual || ':' || with_check || ':' || permissive
            FROM pg_policies WHERE schemaname = 'public' AND tablename = 'platform_audit_events'
            """));

        var denied = await Assert.ThrowsAsync<PostgresException>(() => ExecAsync(
            cs,
            "SET ROLE app_tenant; INSERT INTO platform_audit_events (id, action, entity) VALUES (gen_random_uuid(), 'x', 'y')"));
        Assert.Equal("42501", denied.SqlState);
    }

    [Fact]
    public async Task Manual_script_is_idempotent_and_matches_the_ef_shape()
    {
        var sql = await File.ReadAllTextAsync(ManualScriptPath());
        var manual = await _fixture.FreshDatabaseAsync();

        await ExecAsync(manual, sql);
        await ExecAsync(manual, sql); // second run must be a no-op, not an error

        var ef = await MigratedAsync();
        const string shape =
            """
            SELECT string_agg(x, '|' ORDER BY x) FROM (
              SELECT 'col ' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS x
              FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_audit_events'
              UNION ALL SELECT 'idx ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'platform_audit_events'
              UNION ALL SELECT 'trg ' || tgname || ' ' || tgenabled::text FROM pg_trigger
                WHERE tgrelid = 'public.platform_audit_events'::regclass AND NOT tgisinternal
              UNION ALL SELECT 'pol ' || policyname || ' ' || permissive || ' ' || array_to_string(roles, ',') FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'platform_audit_events'
              UNION ALL SELECT 'rls ' || relrowsecurity::text FROM pg_class WHERE oid = 'public.platform_audit_events'::regclass
              UNION ALL SELECT 'hist ' || "MigrationId" FROM "__EFMigrationsHistory"
            ) s
            """;
        Assert.Equal(await ScalarAsync<string>(ef, shape), await ScalarAsync<string>(manual, shape));
    }

    [Fact]
    public async Task Manual_script_refuses_to_run_without_the_shared_guard_and_leaves_nothing_behind()
    {
        var sql = await File.ReadAllTextAsync(ManualScriptPath());
        var cs = await _fixture.FreshDatabaseAsync(withGuard: false);

        // The precheck must be what stops it: without it the script still fails later, at CREATE TRIGGER, with a
        // "function does not exist" error that names neither the cause nor the fix.
        var refused = await Assert.ThrowsAsync<PostgresException>(() => ExecAsync(cs, sql));
        Assert.Equal("P0001", refused.SqlState);
        Assert.Contains(PrecheckMessage, refused.MessageText, StringComparison.Ordinal);

        Assert.False(await ScalarAsync<bool>(cs, TableExists));
        // Two steps: Postgres resolves a relation at parse time, so a single query referencing a history table that
        // was never created (or was rolled back with the failed batch) errors instead of returning false.
        if (await ScalarAsync<bool>(cs, "SELECT to_regclass('public.\"__EFMigrationsHistory\"') IS NOT NULL"))
        {
            Assert.Equal(0L, await ScalarAsync<long>(cs, "SELECT count(*) FROM \"__EFMigrationsHistory\""));
        }
    }

    [Fact]
    public async Task Ef_migration_refuses_to_run_without_the_shared_guard_and_leaves_nothing_behind()
    {
        var cs = await _fixture.FreshDatabaseAsync(withGuard: false);

        var refused = await Assert.ThrowsAsync<PostgresException>(() => ApplyEfMigrationAsync(cs));
        Assert.Equal("P0001", refused.SqlState);
        Assert.Contains(PrecheckMessage, refused.MessageText, StringComparison.Ordinal);

        Assert.False(await ScalarAsync<bool>(cs, TableExists));
        if (await ScalarAsync<bool>(cs, "SELECT to_regclass('public.\"__EFMigrationsHistory\"') IS NOT NULL"))
        {
            Assert.Equal(0L, await ScalarAsync<long>(cs, "SELECT count(*) FROM \"__EFMigrationsHistory\""));
        }
    }

    [Fact]
    public async Task Rollback_twin_drops_the_table_and_history_row_keeps_the_guard_and_allows_reapply()
    {
        var forward = await File.ReadAllTextAsync(ManualScriptPath());
        var rollback = await File.ReadAllTextAsync(ManualScriptPath(rollback: true));
        var cs = await _fixture.FreshDatabaseAsync();

        await ExecAsync(cs, forward);
        await ExecAsync(cs, rollback);
        await ExecAsync(cs, rollback); // idempotent

        Assert.False(await ScalarAsync<bool>(cs, TableExists));
        Assert.Equal(0L, await ScalarAsync<long>(
            cs, "SELECT count(*) FROM \"__EFMigrationsHistory\" WHERE \"MigrationId\" LIKE '%_platform_audit_events'"));
        Assert.True(await ScalarAsync<bool>(
            cs, "SELECT to_regprocedure('public.tims_append_only_guard()') IS NOT NULL"));

        await ExecAsync(cs, forward);
        Assert.True(await ScalarAsync<bool>(cs, TableExists));
    }
}
