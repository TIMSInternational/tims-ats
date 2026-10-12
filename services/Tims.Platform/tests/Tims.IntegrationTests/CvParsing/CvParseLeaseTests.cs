using Npgsql;
using Tims.Infrastructure.CvParsing;

namespace Tims.IntegrationTests.CvParsing;

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
        await fixture.SeedAsync(org, Now.AddMinutes(-3), fileKey: $"cv-uploads/{Guid.NewGuid()}/{Guid.NewGuid()}.pdf");

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
        Assert.Equal(1, stats.ExhaustedRecent);
        Assert.Equal(0, stats.Deferred);
        Assert.Equal(600, stats.OldestDueAgeSeconds);

        // The alert signal is RECENT exhaustion only: once the window passes, the
        // terminal document stays visible in the total but no longer alerts.
        var later = await _repository.ReadStatsAsync(Now + CvParseLeaseRepository.RecentExhaustionWindow
            + TimeSpan.FromMinutes(1), CancellationToken.None);
        Assert.Equal(1, later.Exhausted);
        Assert.Equal(0, later.ExhaustedRecent);
    }

    [Fact]
    public async Task Budget_deferral_refunds_the_attempt_so_a_denial_never_exhausts_a_document()
    {
        await fixture.ResetAsync();
        var doc = await fixture.SeedAsync(Guid.NewGuid(), Now.AddMinutes(-3));
        var at = Now;
        // Far more denials than MaxAttempts: each one must leave the attempt budget untouched.
        for (var i = 0; i < CvParseLeaseRepository.MaxAttempts * 2; i++)
        {
            var claim = Assert.Single(await _repository.ClaimDueAsync(1, at, CancellationToken.None));
            Assert.Equal(doc, claim.DocumentId);
            Assert.Equal(1, claim.Attempt);
            Assert.True(await _repository.DeferAsync(claim, CvParseFailureCode.BudgetDenied,
                TimeSpan.FromHours(1), at, CancellationToken.None));
            Assert.Empty(await _repository.ClaimDueAsync(1, at.AddMinutes(59), CancellationToken.None));
            var stats = await _repository.ReadStatsAsync(at.AddMinutes(1), CancellationToken.None);
            Assert.Equal(1, stats.Deferred);
            Assert.Equal(0, stats.Exhausted);
            at = at.AddHours(1);
        }
        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(
            "SELECT cv_parse_attempts, cv_parse_failure_code FROM candidate_documents WHERE id=@id", connection);
        command.Parameters.AddWithValue("id", doc);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal(0, reader.GetInt32(0));
        Assert.Equal("budget_denied", reader.GetString(1));
    }

    [Fact]
    public async Task Stale_owner_cannot_defer_a_reclaimed_document()
    {
        await fixture.ResetAsync();
        await fixture.SeedAsync(Guid.NewGuid(), Now.AddMinutes(-3));
        var first = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        var second = Assert.Single(await _repository.ClaimDueAsync(1, Now.AddMinutes(3), CancellationToken.None));
        Assert.False(await _repository.DeferAsync(first, CvParseFailureCode.BudgetDenied,
            TimeSpan.FromHours(1), Now.AddMinutes(3), CancellationToken.None));
        Assert.Equal(2, second.Attempt);
    }

    [Fact]
    public async Task Activation_cutoff_excludes_the_historical_backlog_from_claims_and_alerts()
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        await fixture.SeedAsync(org, Now.AddDays(-30));
        var recent = await fixture.SeedAsync(org, Now.AddMinutes(-5));
        var repository = new CvParseLeaseRepository(fixture.Source, Now.AddMinutes(-60));

        var stats = await repository.ReadStatsAsync(Now, CancellationToken.None);
        Assert.Equal(1, stats.Due);
        Assert.Equal(300, stats.OldestDueAgeSeconds);
        var claim = Assert.Single(await repository.ClaimDueAsync(10, Now, CancellationToken.None));
        Assert.Equal(recent, claim.DocumentId);
        Assert.Empty(await repository.ClaimDueAsync(10, Now, CancellationToken.None));
    }

    [Theory]
    [InlineData("cv-uploads/{org}/resume.pdf")]
    [InlineData("cv-uploads/{org}/nested/{uuid}.pdf")]
    [InlineData("cv-uploads/{org}/{uuid}.PDF")]
    [InlineData("cv-uploads/{org}/{uuid}.exe")]
    [InlineData("cv-uploads/{org}/{uuid}.pdf\n")]
    [InlineData("cv-uploads/{org}//{uuid}.pdf")]
    [InlineData("cv-uploads/{ORG}/{uuid}.pdf")]
    [InlineData("x/cv-uploads/{org}/{uuid}.pdf")]
    public async Task Only_the_generated_upload_key_shape_is_ever_claimed(string template)
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        var key = template.Replace("{org}", org.ToString()).Replace("{ORG}", org.ToString().ToUpperInvariant())
            .Replace("{uuid}", Guid.NewGuid().ToString()).Replace("\\n", "\n");
        Assert.False(CvObjectKey.IsValid(org, key));
        await fixture.SeedAsync(org, Now.AddMinutes(-3), fileKey: key);
        Assert.Empty(await _repository.ClaimDueAsync(10, Now, CancellationToken.None));
        Assert.Equal(0, (await _repository.ReadStatsAsync(Now, CancellationToken.None)).Due);

        var valid = CvParseLeaseFixture.ValidKey(org, "docx");
        Assert.True(CvObjectKey.IsValid(org, valid));
        await fixture.SeedAsync(org, Now.AddMinutes(-3), fileKey: valid);
        Assert.Single(await _repository.ClaimDueAsync(10, Now, CancellationToken.None));
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
