using Npgsql;

namespace Tims.IntegrationTests.CvParsing;

/// <summary>
/// The retry migration applied (twice) on top of the committed production
/// baseline: what is asserted here is what the owner applies to production.
/// </summary>
[Collection(nameof(CvParseLeaseCollection))]
public sealed class CvParseRetryMigrationTests(CvParseLeaseFixture fixture)
{
    [Fact]
    public void Baseline_extraction_carries_the_real_tables_policies_and_grants()
    {
        var sql = CvParseLeaseFixture.ExtractCommittedSchema(File.ReadAllText(CvParseLeaseFixture.BaselinePath));
        foreach (var table in CvParseLeaseFixture.Tables)
        {
            Assert.Contains($"CREATE TABLE public.{table} (", sql);
            Assert.Contains($"ON TABLE public.{table} TO app_tenant;", sql);
        }
        foreach (var table in CvParseLeaseFixture.Tables.Where(t => t != "ai_agents"))
        {
            Assert.Contains($"CREATE POLICY tenant_isolation ON public.{table} ", sql);
            Assert.Contains($"ALTER TABLE ONLY public.{table} FORCE ROW LEVEL SECURITY;", sql);
        }
        // A foreign key into a table outside the fixture set is skipped, not half-copied.
        Assert.DoesNotContain("REFERENCES public.organizations", sql);
    }

    [Fact]
    public async Task Migration_adds_bounded_retry_columns_and_partial_due_index()
    {
        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var columns = new NpgsqlCommand("""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'candidate_documents'
              AND column_name LIKE 'cv_parse_%' ORDER BY column_name
            """, connection);
        var found = new List<string>();
        await using (var reader = await columns.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
                found.Add($"{reader.GetString(0)}:{reader.GetString(1)}:{reader.GetString(2)}");
        }
        Assert.Equal(new[]
        {
            "cv_parse_attempts:integer:NO",
            "cv_parse_failure_code:character varying:YES",
            "cv_parse_lease_token:uuid:YES",
            "cv_parse_lease_until:timestamp without time zone:YES",
            "cv_parse_next_at:timestamp without time zone:YES"
        }, found);

        await using var index = new NpgsqlCommand("""
            SELECT pg_get_indexdef(indexrelid) FROM pg_index
            WHERE indexrelid = 'public.candidate_documents_cv_retry_due_idx'::regclass
            """, connection);
        var definition = (string)(await index.ExecuteScalarAsync())!;
        Assert.Contains("WHERE ((type = 'cv'::text) AND (parsed_data IS NULL) AND (cv_parse_attempts < 4))", definition);
    }

    [Fact]
    public async Task Attempt_bound_is_enforced_by_the_database()
    {
        await fixture.ResetAsync();
        var document = await fixture.SeedAsync(Guid.NewGuid(), DateTime.UtcNow);
        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(
            "UPDATE candidate_documents SET cv_parse_attempts = 5 WHERE id = @id", connection);
        command.Parameters.AddWithValue("id", document);
        var error = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
        Assert.Equal("candidate_documents_cv_parse_attempts_check", error.ConstraintName);
    }

    [Fact]
    public async Task Committed_tenant_policy_hides_and_protects_another_organizations_document()
    {
        await fixture.ResetAsync();
        var mine = Guid.NewGuid();
        var foreign = await fixture.SeedAsync(Guid.NewGuid(), DateTime.UtcNow);
        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var scope = new NpgsqlCommand("""
            SET LOCAL ROLE app_tenant;
            SELECT set_config('app.current_org_id', @org, true);
            """, connection, transaction))
        {
            scope.Parameters.AddWithValue("org", mine.ToString());
            await scope.ExecuteNonQueryAsync();
        }
        await using var command = new NpgsqlCommand(
            "UPDATE candidate_documents SET cv_parse_failure_code = 'forged' WHERE id = @id",
            connection, transaction);
        command.Parameters.AddWithValue("id", foreign);
        Assert.Equal(0, await command.ExecuteNonQueryAsync());
        await using var read = new NpgsqlCommand(
            "SELECT count(*) FROM candidate_documents WHERE id = @id", connection, transaction);
        read.Parameters.AddWithValue("id", foreign);
        Assert.Equal(0L, (long)(await read.ExecuteScalarAsync())!);
    }
}
