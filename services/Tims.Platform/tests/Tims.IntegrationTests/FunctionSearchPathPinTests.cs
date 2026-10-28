using Npgsql;
using Tims.Domain.Audit;

namespace Tims.IntegrationTests;

/// <summary>
/// Supabase lint 0011 (<c>function_search_path_mutable</c>): every function in <c>public</c> must carry a
/// function-level <c>search_path</c>. Proves, against a real Postgres, that (a) the guard created by
/// <see cref="AuditImmutability.BuildAppendOnlySql"/> is pinned, (b) the hand-run prod script
/// <c>packages/db/prisma/manual/2026-10-12-pin-function-search-path.sql</c> pins BOTH public functions starting
/// from their unpinned baseline shape without changing what they do, and (c) a later re-apply of the builder
/// block does not undo the pin.
/// </summary>
[Collection("AuditWriter")]
public sealed class FunctionSearchPathPinTests(AuditWriterFixture fixture)
{
    // Body copied from packages/db/baseline/prod-public-schema.sql (the only other public function).
    private const string CurrentOrgIdBaselineDdl =
        "CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$\n" +
        "  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid;\n$$;";

    private const string PinnedConfig = "search_path=\"\"";

    private readonly AuditWriterFixture _fixture = fixture;

    private static async Task ExecAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<string[]> ProconfigAsync(NpgsqlConnection connection, string function)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT coalesce(p.proconfig, '{}'::text[]) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
            "WHERE n.nspname = 'public' AND p.proname = @name";
        command.Parameters.AddWithValue("name", function);
        var result = await command.ExecuteScalarAsync();
        return Assert.IsType<string[]>(result);
    }

    private static string ManualScript(string fileName)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "packages", "db", "prisma", "manual", fileName);
            if (File.Exists(candidate))
            {
                return File.ReadAllText(candidate);
            }
        }

        throw new FileNotFoundException("manual SQL not found from " + AppContext.BaseDirectory, fileName);
    }

    [Fact]
    public async Task Builder_created_guard_has_a_pinned_search_path()
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();

        Assert.Contains(PinnedConfig, await ProconfigAsync(connection, AuditImmutability.GuardFunction));
    }

    [Fact]
    public async Task Prod_script_pins_both_public_functions_and_keeps_their_behaviour()
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();

        // Recreate the UNPINNED prod shape: current_org_id() as in the baseline, the guard with its pin removed.
        await ExecAsync(connection, CurrentOrgIdBaselineDdl);
        await ExecAsync(connection, $"ALTER FUNCTION public.{AuditImmutability.GuardFunction}() RESET search_path");
        Assert.Empty(await ProconfigAsync(connection, "current_org_id"));
        Assert.Empty(await ProconfigAsync(connection, AuditImmutability.GuardFunction));

        await ExecAsync(connection, ManualScript("2026-10-12-pin-function-search-path.sql"));

        Assert.Equal([PinnedConfig], await ProconfigAsync(connection, "current_org_id"));
        Assert.Equal([PinnedConfig], await ProconfigAsync(connection, AuditImmutability.GuardFunction));

        // Behaviour unchanged with an empty path: current_org_id() still resolves the GUC (pg_catalog built-ins)…
        await using (var tx = await connection.BeginTransactionAsync())
        {
            await ExecAsync(connection, $"SELECT set_config('app.current_org_id', '{AuditWriterFixture.OrgA}', true)");
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT public.current_org_id()";
            Assert.Equal(AuditWriterFixture.OrgA, await command.ExecuteScalarAsync());
            await tx.RollbackAsync();
        }

        // …and the guard still raises 42501 naming the table it fired on.
        var ex = await Assert.ThrowsAsync<PostgresException>(() => ExecAsync(connection, "TRUNCATE audit_logs"));
        Assert.Equal("42501", ex.SqlState);
        Assert.Contains("audit_logs is append-only", ex.MessageText, StringComparison.Ordinal);

        // Re-applying the canonical builder block (as a future re-run of a 2026-07-17 script would) KEEPS the pin.
        await ExecAsync(connection, AuditImmutability.BuildAppendOnlySql("audit_logs"));
        Assert.Equal([PinnedConfig], await ProconfigAsync(connection, AuditImmutability.GuardFunction));

        // The ROLLBACK script really reverts, then the forward script re-pins (idempotent re-apply).
        await ExecAsync(connection, ManualScript("2026-10-12-pin-function-search-path.ROLLBACK.sql"));
        Assert.Empty(await ProconfigAsync(connection, "current_org_id"));
        await ExecAsync(connection, ManualScript("2026-10-12-pin-function-search-path.sql"));
        await ExecAsync(connection, ManualScript("2026-10-12-pin-function-search-path.sql"));
        Assert.Equal([PinnedConfig], await ProconfigAsync(connection, "current_org_id"));
        Assert.Equal([PinnedConfig], await ProconfigAsync(connection, AuditImmutability.GuardFunction));
    }
}
