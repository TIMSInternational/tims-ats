using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.CvParsing;

namespace Tims.IntegrationTests.CvParsing;

[CollectionDefinition(nameof(CvParseLeaseCollection))]
public sealed class CvParseLeaseCollection : ICollectionFixture<CvParseLeaseFixture> { }

public sealed class CvParseLeaseFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine").Build();
    public NpgsqlDataSource Source { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        Source = NpgsqlDataSource.Create(_container.GetConnectionString());
        await using var connection = await Source.OpenConnectionAsync();
        await using var schema = new NpgsqlCommand("""
            CREATE TABLE candidates (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
              deleted_at timestamp(3), education jsonb, languages jsonb);
            CREATE TABLE data_consents (
              organization_id uuid NOT NULL, subject_user_id uuid NOT NULL,
              consent_type text NOT NULL, withdrawn_at timestamp(3)
            );
            CREATE TABLE candidate_documents (
              id uuid PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL,
              type text NOT NULL, file_url text NOT NULL, parsed_data jsonb,
              created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL
            );
            CREATE TABLE ai_agents (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, status text NOT NULL);
            CREATE TABLE ai_agent_org_configs (id uuid PRIMARY KEY, agent_id uuid NOT NULL,
              organization_id uuid NOT NULL, enabled boolean NOT NULL, monthly_budget double precision);
            CREATE TABLE ai_agent_usage_logs (id uuid PRIMARY KEY, agent_id uuid NOT NULL,
              organization_id uuid NOT NULL, input_tokens integer NOT NULL, output_tokens integer NOT NULL,
              cost_usd double precision NOT NULL, latency_ms integer NOT NULL, cached boolean NOT NULL,
              created_at timestamp NOT NULL);
            CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
            GRANT SELECT, UPDATE ON candidates, data_consents, candidate_documents TO app_tenant;
            GRANT SELECT ON ai_agents, ai_agent_org_configs TO app_tenant;
            GRANT SELECT, INSERT ON ai_agent_usage_logs TO app_tenant;
            ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
            ALTER TABLE candidates FORCE ROW LEVEL SECURITY;
            ALTER TABLE data_consents ENABLE ROW LEVEL SECURITY;
            ALTER TABLE data_consents FORCE ROW LEVEL SECURITY;
            ALTER TABLE candidate_documents ENABLE ROW LEVEL SECURITY;
            ALTER TABLE candidate_documents FORCE ROW LEVEL SECURITY;
            ALTER TABLE ai_agent_org_configs ENABLE ROW LEVEL SECURITY;
            ALTER TABLE ai_agent_org_configs FORCE ROW LEVEL SECURITY;
            ALTER TABLE ai_agent_usage_logs ENABLE ROW LEVEL SECURITY;
            ALTER TABLE ai_agent_usage_logs FORCE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON candidates
              USING (organization_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid)
              WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid);
            CREATE POLICY tenant_isolation ON data_consents
              USING (organization_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid)
              WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid);
            CREATE POLICY tenant_isolation ON candidate_documents
              USING (organization_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid)
              WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid);
            CREATE POLICY tenant_isolation ON ai_agent_org_configs
              USING (organization_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid)
              WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid);
            CREATE POLICY tenant_isolation ON ai_agent_usage_logs
              USING (organization_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid)
              WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid);
            """, connection);
        await schema.ExecuteNonQueryAsync();
        var ddl = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "db", "cv-parse-retry", "migration.sql"));
        await using var migration = new NpgsqlCommand(ddl, connection);
        await migration.ExecuteNonQueryAsync();
        // The committed DDL is explicitly safe to rerun.
        await migration.ExecuteNonQueryAsync();
    }

    public async Task ResetAsync()
    {
        await using var connection = await Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("TRUNCATE candidate_documents, data_consents, candidates, ai_agent_usage_logs, ai_agent_org_configs, ai_agents", connection);
        await command.ExecuteNonQueryAsync();
    }

    public async Task<Guid> SeedAsync(Guid org, DateTime createdAt, string? fileKey = null,
        bool consent = true, bool withdrawn = false, bool deleted = false, bool parsed = false)
    {
        var candidate = Guid.NewGuid();
        var document = Guid.NewGuid();
        await using var connection = await Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO candidates(id, organization_id, deleted_at)
              VALUES (@candidate, @org, CASE WHEN @deleted THEN @created ELSE NULL END);
            INSERT INTO candidate_documents(id, organization_id, candidate_id, type, file_url,
              parsed_data, created_at, updated_at)
              VALUES (@document, @org, @candidate, 'cv', @key,
                CASE WHEN @parsed THEN '{}'::jsonb ELSE NULL END, @created, @created);
            """, connection);
        command.Parameters.AddWithValue("candidate", candidate);
        command.Parameters.AddWithValue("document", document);
        command.Parameters.AddWithValue("org", org);
        command.Parameters.AddWithValue("key", fileKey ?? $"cv-uploads/{org}/resume.pdf");
        command.Parameters.AddWithValue("deleted", deleted);
        command.Parameters.AddWithValue("parsed", parsed);
        command.Parameters.AddWithValue("created", NpgsqlTypes.NpgsqlDbType.Timestamp,
            DateTime.SpecifyKind(createdAt, DateTimeKind.Unspecified));
        await command.ExecuteNonQueryAsync();
        if (consent)
        {
            await using var insertConsent = new NpgsqlCommand("""
                INSERT INTO data_consents(organization_id,subject_user_id,consent_type,withdrawn_at)
                VALUES (@org,@candidate,'recruitment_data_processing',
                  CASE WHEN @withdrawn THEN @created ELSE NULL END)
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

    public async Task DisposeAsync()
    {
        if (Source is not null) await Source.DisposeAsync();
        await _container.DisposeAsync();
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

[Collection(nameof(CvParseLeaseCollection))]
public sealed class CvParseLeaseTests(CvParseLeaseFixture fixture)
{
    private readonly CvParseLeaseRepository _repository = new(fixture.Source);
    private static readonly DateTime Now = new(2026, 10, 10, 18, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Two_workers_claim_one_document_only_once_and_skip_ineligible_rows()
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        var eligible = await fixture.SeedAsync(org, Now.AddMinutes(-3));
        await fixture.SeedAsync(org, Now.AddMinutes(-1));
        await fixture.SeedAsync(org, Now.AddMinutes(-3), consent: false);
        await fixture.SeedAsync(org, Now.AddMinutes(-3), withdrawn: true);
        await fixture.SeedAsync(org, Now.AddMinutes(-3), deleted: true);
        await fixture.SeedAsync(org, Now.AddMinutes(-3), parsed: true);
        await fixture.SeedAsync(org, Now.AddMinutes(-3), fileKey: "cv-uploads/other-org/foreign.pdf");

        var otherWorker = new CvParseLeaseRepository(fixture.Source);
        var batches = await Task.WhenAll(_repository.ClaimDueAsync(10, Now, CancellationToken.None),
            otherWorker.ClaimDueAsync(10, Now, CancellationToken.None));
        var claim = Assert.Single(batches.SelectMany(x => x));
        Assert.Equal(eligible, claim.DocumentId);
        Assert.Equal(org, claim.OrganizationId);
        Assert.Equal(1, claim.Attempt);
    }

    [Fact]
    public async Task Expired_lease_can_be_reclaimed_but_stale_owner_cannot_release_it()
    {
        await fixture.ResetAsync();
        var doc = await fixture.SeedAsync(Guid.NewGuid(), Now.AddMinutes(-3));
        var first = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        var second = Assert.Single(await _repository.ClaimDueAsync(1, Now.AddMinutes(3), CancellationToken.None));
        Assert.Equal(doc, second.DocumentId);
        Assert.Equal(2, second.Attempt);
        Assert.NotEqual(first.Token, second.Token);
        Assert.False(await _repository.FailAsync(first, CvParseFailureCode.FetchError, Now.AddMinutes(3), CancellationToken.None));
        Assert.True(await _repository.FailAsync(second, CvParseFailureCode.FetchError, Now.AddMinutes(3), CancellationToken.None));
        Assert.Empty(await _repository.ClaimDueAsync(1, Now.AddMinutes(22), CancellationToken.None));
        Assert.Single(await _repository.ClaimDueAsync(1, Now.AddMinutes(24), CancellationToken.None));
    }

    [Fact]
    public async Task Invalid_document_is_terminal_without_retrying_or_storing_provider_details()
    {
        await fixture.ResetAsync();
        await fixture.SeedAsync(Guid.NewGuid(), Now.AddMinutes(-3));
        var claim = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        Assert.True(await _repository.FailAsync(claim, CvParseFailureCode.InvalidDocument, Now, CancellationToken.None));
        Assert.Empty(await _repository.ClaimDueAsync(1, Now.AddDays(2), CancellationToken.None));
        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            SELECT cv_parse_attempts, cv_parse_failure_code, cv_parse_lease_token
            FROM candidate_documents WHERE id=@id
            """, connection);
        command.Parameters.AddWithValue("id", claim.DocumentId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal(CvParseLeaseRepository.MaxAttempts, reader.GetInt32(0));
        Assert.Equal("invalid_document", reader.GetString(1));
        Assert.True(reader.IsDBNull(2));
    }

    [Fact]
    public async Task Backlog_snapshot_counts_due_leased_and_exhausted_without_candidate_data()
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        await fixture.SeedAsync(org, Now.AddMinutes(-30));
        await fixture.SeedAsync(org, Now.AddMinutes(-20));
        await fixture.SeedAsync(org, Now.AddMinutes(-10));
        var exhausted = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        Assert.True(await _repository.FailAsync(exhausted, CvParseFailureCode.InvalidDocument,
            Now, CancellationToken.None));
        _ = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        var stats = await _repository.ReadStatsAsync(Now, CancellationToken.None);
        Assert.Equal(1, stats.Due);
        Assert.Equal(1, stats.Leased);
        Assert.Equal(1, stats.Exhausted);
        Assert.Equal(600, stats.OldestDueAgeSeconds);
    }

    [Fact]
    public async Task Completion_writes_document_and_profile_once_then_rejects_replay()
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        var doc = await fixture.SeedAsync(org, Now.AddMinutes(-3));
        var lease = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        const string parsed = "{\"parsed\":true,\"name\":\"Synthetic Candidate\"}";
        Assert.True(await _repository.CompleteAsync(lease, parsed, "[{\"institution\":\"Synthetic College\"}]",
            "[\"Spanish\"]", Now, CancellationToken.None));
        Assert.False(await _repository.CompleteAsync(lease, parsed, "[]", "[]", Now, CancellationToken.None));
        Assert.Empty(await _repository.ClaimDueAsync(1, Now.AddDays(1), CancellationToken.None));
        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("SELECT parsed_data FROM candidate_documents WHERE id=@id", connection);
        command.Parameters.AddWithValue("id", doc);
        Assert.Contains("Synthetic Candidate", (string)(await command.ExecuteScalarAsync())!);
        await using var candidate = new NpgsqlCommand("SELECT education, languages FROM candidates WHERE id=@id", connection);
        candidate.Parameters.AddWithValue("id", lease.CandidateId);
        await using var profile = await candidate.ExecuteReaderAsync();
        Assert.True(await profile.ReadAsync());
        Assert.Contains("Synthetic College", profile.GetString(0));
        Assert.Contains("Spanish", profile.GetString(1));
    }

    [Fact]
    public async Task Withdrawal_after_claim_blocks_completion_and_keeps_document_unparsed()
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        var doc = await fixture.SeedAsync(org, Now.AddMinutes(-3));
        var lease = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        await fixture.WithdrawAsync(lease.CandidateId);
        Assert.False(await _repository.CompleteAsync(lease, "{\"parsed\":true}", "[]", "[]", Now,
            CancellationToken.None));
        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("SELECT parsed_data IS NULL FROM candidate_documents WHERE id=@id", connection);
        command.Parameters.AddWithValue("id", doc);
        Assert.True((bool)(await command.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Consent_gate_denies_withdrawn_claim_before_model_work()
    {
        await fixture.ResetAsync();
        await fixture.SeedAsync(Guid.NewGuid(), Now.AddMinutes(-3));
        var lease = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        await fixture.WithdrawAsync(lease.CandidateId);
        var called = false;
        var result = await _repository.RunWithConsentGateAsync(lease, _ =>
        {
            called = true;
            return Task.FromResult("sent");
        }, Now, CancellationToken.None);
        Assert.Null(result);
        Assert.False(called);
    }

    [Fact]
    public async Task Consent_gate_serializes_with_withdrawal_lock_during_inference()
    {
        await fixture.ResetAsync();
        await fixture.SeedAsync(Guid.NewGuid(), Now.AddMinutes(-3));
        var lease = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        var inside = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var processing = _repository.RunWithConsentGateAsync(lease, async _ =>
        {
            inside.SetResult();
            await release.Task;
            return "sent";
        }, Now, CancellationToken.None);
        await inside.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var withdrawing = Task.Run(async () =>
        {
            await using var connection = await fixture.Source.OpenConnectionAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            await using var command = new NpgsqlCommand("""
                SELECT pg_advisory_xact_lock(hashtextextended(@candidate, 0));
                UPDATE data_consents SET withdrawn_at = @now WHERE subject_user_id = @id;
                """, connection, transaction);
            command.Parameters.AddWithValue("candidate", lease.CandidateId.ToString());
            command.Parameters.AddWithValue("id", lease.CandidateId);
            command.Parameters.AddWithValue("now", NpgsqlTypes.NpgsqlDbType.Timestamp,
                DateTime.SpecifyKind(Now, DateTimeKind.Unspecified));
            await command.ExecuteNonQueryAsync();
            await transaction.CommitAsync();
        });
        await Task.Delay(100);
        Assert.False(withdrawing.IsCompleted);
        release.SetResult();
        Assert.Equal("sent", await processing.WaitAsync(TimeSpan.FromSeconds(5)));
        await withdrawing.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(await _repository.CompleteAsync(lease, "{\"parsed\":true}", "[]", "[]", Now,
            CancellationToken.None));
    }

    [Fact]
    public async Task Consent_gate_releases_transaction_lock_when_parser_fails()
    {
        await fixture.ResetAsync();
        await fixture.SeedAsync(Guid.NewGuid(), Now.AddMinutes(-3));
        var lease = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            _repository.RunWithConsentGateAsync(lease,
                _ => Task.FromException<string>(new InvalidOperationException("synthetic parser failure")),
                Now, CancellationToken.None));

        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = new NpgsqlCommand(
            "SELECT pg_try_advisory_xact_lock(hashtextextended(@candidate, 0))", connection, transaction);
        command.Parameters.AddWithValue("candidate", lease.CandidateId.ToString());
        Assert.True((bool)(await command.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Wrong_organization_cannot_finish_or_release_another_tenants_claim()
    {
        await fixture.ResetAsync();
        await fixture.SeedAsync(Guid.NewGuid(), Now.AddMinutes(-3));
        var lease = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        var forged = lease with { OrganizationId = Guid.NewGuid() };
        Assert.False(await _repository.FailAsync(forged, CvParseFailureCode.FetchError, Now, CancellationToken.None));
        Assert.False(await _repository.CompleteAsync(forged, "{\"parsed\":true}", "[]", "[]", Now,
            CancellationToken.None));
        Assert.True(await _repository.CompleteAsync(lease, "{\"parsed\":true}", "[]", "[]", Now,
            CancellationToken.None));
    }
}
