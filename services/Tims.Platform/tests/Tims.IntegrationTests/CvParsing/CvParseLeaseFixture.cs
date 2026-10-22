using System.Text;
using System.Text.RegularExpressions;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests.CvParsing;

[CollectionDefinition(nameof(CvParseLeaseCollection))]
public sealed class CvParseLeaseCollection : ICollectionFixture<CvParseLeaseFixture> { }

/// <summary>
/// Builds the CV recovery tables from the COMMITTED production schema, not from
/// hand-written DDL: table definitions, primary/unique keys, indexes, foreign
/// keys between these tables, ENABLE/FORCE row level security, the real
/// <c>tenant_isolation</c> policies and the real <c>app_tenant</c> grants are
/// extracted verbatim from <c>packages/db/baseline/prod-public-schema.sql</c>.
/// Migrations committed after that baseline are then applied verbatim, and the
/// CV retry migration is applied twice to prove it is re-runnable.
/// </summary>
public sealed class CvParseLeaseFixture : IAsyncLifetime
{
    /// <summary>Every table the CV recovery code reads or writes.</summary>
    public static readonly string[] Tables =
        ["candidates", "candidate_documents", "data_consents", "ai_agents", "ai_agent_org_configs", "ai_agent_usage_logs"];

    /// <summary>Post-baseline migrations touching <see cref="Tables"/>, in apply order.</summary>
    public static readonly string[] PostBaselineMigrations = ["ai-usage-success", "cv-parse-retry"];

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine").Build();
    public NpgsqlDataSource Source { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        Source = NpgsqlDataSource.Create(_container.GetConnectionString());
        await using var connection = await Source.OpenConnectionAsync();
        // Cluster-level role: not part of a public-schema dump. Production's is NOLOGIN NOBYPASSRLS.
        await ExecuteAsync(connection, "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;");
        await ExecuteAsync(connection, ExtractCommittedSchema(await File.ReadAllTextAsync(BaselinePath)));
        foreach (var migration in PostBaselineMigrations)
            await ExecuteAsync(connection, await File.ReadAllTextAsync(MigrationPath(migration)));
        // The committed CV retry DDL is explicitly safe to rerun.
        await ExecuteAsync(connection, await File.ReadAllTextAsync(MigrationPath("cv-parse-retry")));
    }

    public static string BaselinePath =>
        Path.Combine(AppContext.BaseDirectory, "db", "baseline", "prod-public-schema.sql");

    public static string MigrationPath(string name) =>
        Path.Combine(AppContext.BaseDirectory, "db", name, "migration.sql");

    /// <summary>
    /// Selects, verbatim, every baseline statement that defines or protects one of
    /// <see cref="Tables"/>. Foreign keys to tables outside the set are skipped so
    /// the fixture does not need the whole organization/user graph.
    /// </summary>
    public static string ExtractCommittedSchema(string baseline)
    {
        var names = string.Join("|", Tables.Select(Regex.Escape));
        var table = $@"public\.(?:{names})";
        var lines = baseline.Replace("\r\n", "\n").Split('\n');
        var output = new StringBuilder();
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            if (Regex.IsMatch(line, $@"^CREATE TABLE {table} \($"))
            {
                while (i < lines.Length && lines[i] != ");") output.AppendLine(lines[i++]);
                output.AppendLine(");");
            }
            else if (Regex.IsMatch(line, $@"^ALTER TABLE (?:ONLY )?{table} (?:FORCE|ENABLE) ROW LEVEL SECURITY;$") ||
                     Regex.IsMatch(line, $@"^CREATE POLICY \S+ ON {table} .*;$") ||
                     Regex.IsMatch(line, $@"^CREATE (?:UNIQUE )?INDEX \S+ ON {table} .*;$") ||
                     Regex.IsMatch(line, $@"^GRANT [A-Z,]+ ON TABLE {table} TO app_tenant;$"))
            {
                output.AppendLine(line);
            }
            else if (Regex.IsMatch(line, $@"^ALTER TABLE ONLY {table}$") && i + 1 < lines.Length)
            {
                var constraint = lines[i + 1];
                var foreign = Regex.Match(constraint, @"REFERENCES public\.(\w+)\(");
                if (foreign.Success && !Tables.Contains(foreign.Groups[1].Value)) continue;
                output.AppendLine(line).AppendLine(constraint);
                i++;
            }
        }
        return output.ToString();
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    public async Task ResetAsync()
    {
        await using var connection = await Source.OpenConnectionAsync();
        await ExecuteAsync(connection,
            "TRUNCATE candidate_documents, data_consents, candidates, ai_agent_usage_logs, ai_agent_org_configs, ai_agents");
    }

    public async Task<Guid> SeedAsync(Guid org, DateTime createdAt, string? fileKey = null,
        bool consent = true, bool withdrawn = false, bool deleted = false, bool parsed = false)
    {
        var candidate = Guid.NewGuid();
        var document = Guid.NewGuid();
        await using var connection = await Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO candidates(id, organization_id, first_name, last_name, email, source, pool_type,
              updated_at, deleted_at)
              VALUES (@candidate, @org, 'Synthetic', 'Candidate', @email, 'portal', 'external',
                @created, CASE WHEN @deleted THEN @created ELSE NULL END);
            INSERT INTO candidate_documents(id, organization_id, candidate_id, type, file_name, file_url,
              parsed_data, created_at, updated_at)
              VALUES (@document, @org, @candidate, 'cv', 'resume.pdf', @key,
                CASE WHEN @parsed THEN '{}'::jsonb ELSE NULL END, @created, @created);
            """, connection);
        command.Parameters.AddWithValue("candidate", candidate);
        command.Parameters.AddWithValue("document", document);
        command.Parameters.AddWithValue("org", org);
        command.Parameters.AddWithValue("email", $"{candidate}@example.test");
        command.Parameters.AddWithValue("key", fileKey ?? ValidKey(org));
        command.Parameters.AddWithValue("deleted", deleted);
        command.Parameters.AddWithValue("parsed", parsed);
        command.Parameters.AddWithValue("created", NpgsqlTypes.NpgsqlDbType.Timestamp,
            DateTime.SpecifyKind(createdAt, DateTimeKind.Unspecified));
        await command.ExecuteNonQueryAsync();
        if (consent)
        {
            await using var insertConsent = new NpgsqlCommand("""
                INSERT INTO data_consents(id, organization_id, subject_user_id, consent_type, text_version,
                  agreed_at, withdrawn_at, created_at, updated_at)
                VALUES (gen_random_uuid(), @org, @candidate, 'recruitment_data_processing', 'v1',
                  @created, CASE WHEN @withdrawn THEN @created ELSE NULL END, @created, @created)
                """, connection);
            insertConsent.Parameters.AddWithValue("org", org);
            insertConsent.Parameters.AddWithValue("candidate", candidate);
            insertConsent.Parameters.AddWithValue("withdrawn", withdrawn);
            insertConsent.Parameters.AddWithValue("created", NpgsqlTypes.NpgsqlDbType.Timestamp,
                DateTime.SpecifyKind(createdAt, DateTimeKind.Unspecified));
            await insertConsent.ExecuteNonQueryAsync();
        }
        return document;
    }

    /// <summary>The exact key shape the portal's presigned upload generates.</summary>
    public static string ValidKey(Guid org, string extension = "pdf") =>
        $"cv-uploads/{org}/{Guid.NewGuid()}.{extension}";

    public async Task SeedAgentAsync(Guid agent, string status = "active")
    {
        await using var connection = await Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO ai_agents(id, slug, name, status, updated_at)
            VALUES (@agent, 'cv-parser', 'CV Parser', @status, now())
            """, connection);
        command.Parameters.AddWithValue("agent", agent);
        command.Parameters.AddWithValue("status", status);
        await command.ExecuteNonQueryAsync();
    }

    public async Task SeedOrgConfigAsync(Guid agent, Guid org, bool enabled, double? monthlyBudget)
    {
        await using var connection = await Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO ai_agent_org_configs(id, agent_id, organization_id, enabled, monthly_budget, updated_at)
            VALUES (gen_random_uuid(), @agent, @org, @enabled, @budget, now())
            """, connection);
        command.Parameters.AddWithValue("agent", agent);
        command.Parameters.AddWithValue("org", org);
        command.Parameters.AddWithValue("enabled", enabled);
        command.Parameters.AddWithValue("budget", NpgsqlTypes.NpgsqlDbType.Double,
            (object?)monthlyBudget ?? DBNull.Value);
        await command.ExecuteNonQueryAsync();
    }

    public async Task DisposeAsync()
    {
        if (Source is not null) await Source.DisposeAsync();
        await _container.DisposeAsync();
    }

    /// <summary>
    /// A second candidate row in <paramref name="org"/> for the same person as
    /// <paramref name="documentCandidateId"/> (same email, different case and padding),
    /// with a recruitment consent that is withdrawn when <paramref name="withdrawn"/>.
    /// </summary>
    public async Task<Guid> SeedEmailVariantAsync(Guid org, Guid documentCandidateId, bool withdrawn)
    {
        var variant = Guid.NewGuid();
        await using var connection = await Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO candidates(id, organization_id, first_name, last_name, email, source, pool_type, updated_at)
              VALUES (@variant, @org, 'Synthetic', 'Variant', @email, 'portal', 'external', now());
            INSERT INTO data_consents(id, organization_id, subject_user_id, consent_type, text_version,
              agreed_at, withdrawn_at, created_at, updated_at)
              VALUES (gen_random_uuid(), @org, @variant, 'recruitment_data_processing', 'v1',
                now(), CASE WHEN @withdrawn THEN now() ELSE NULL END, now(), now());
            """, connection);
        command.Parameters.AddWithValue("variant", variant);
        command.Parameters.AddWithValue("org", org);
        command.Parameters.AddWithValue("email", $"  {documentCandidateId.ToString().ToUpperInvariant()}@EXAMPLE.TEST ");
        command.Parameters.AddWithValue("withdrawn", withdrawn);
        await command.ExecuteNonQueryAsync();
        return variant;
    }

    public async Task WithdrawAsync(Guid candidateId)
    {
        await using var connection = await Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            UPDATE data_consents SET withdrawn_at = @now WHERE subject_user_id = @candidate
            """, connection);
        command.Parameters.AddWithValue("now", NpgsqlTypes.NpgsqlDbType.Timestamp,
            DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Unspecified));
        command.Parameters.AddWithValue("candidate", candidateId);
        await command.ExecuteNonQueryAsync();
    }
}
