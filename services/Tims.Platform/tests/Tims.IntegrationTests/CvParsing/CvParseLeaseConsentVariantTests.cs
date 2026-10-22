using Npgsql;
using Tims.Infrastructure.CvParsing;

namespace Tims.IntegrationTests.CvParsing;

/// <summary>
/// Tier-1 (Codex) review of CV recovery 2/4: the consent predicates looked only at the document's own
/// candidate row. The same person can exist as several rows in one organization that differ only in email
/// case or padding, and a withdrawal on ANY of them must stop processing of all of them (the TypeScript
/// consent guard and the C# interview-join rule). Also: a worker that dies after claiming the LAST attempt
/// must not strand the document outside every alert.
/// </summary>
[Collection(nameof(CvParseLeaseCollection))]
public sealed class CvParseLeaseConsentVariantTests(CvParseLeaseFixture fixture)
{
    private readonly CvParseLeaseRepository _repository = new(fixture.Source);
    private static readonly DateTime Now = new(2026, 10, 10, 18, 0, 0, DateTimeKind.Utc);

    private async Task<Guid> CandidateOfAsync(Guid document)
    {
        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("SELECT candidate_id FROM candidate_documents WHERE id=@id", connection);
        command.Parameters.AddWithValue("id", document);
        return (Guid)(await command.ExecuteScalarAsync())!;
    }

    [Fact]
    public async Task Withdrawal_on_a_same_email_variant_row_blocks_claim_and_backlog_count()
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        var doc = await fixture.SeedAsync(org, Now.AddMinutes(-3));
        await fixture.SeedEmailVariantAsync(org, await CandidateOfAsync(doc), withdrawn: true);

        Assert.Empty(await _repository.ClaimDueAsync(10, Now, CancellationToken.None));
        Assert.Equal(0, (await _repository.ReadStatsAsync(Now, CancellationToken.None)).Due);
    }

    [Fact]
    public async Task An_active_variant_or_a_withdrawn_variant_in_another_organization_does_not_block()
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        var doc = await fixture.SeedAsync(org, Now.AddMinutes(-3));
        var candidate = await CandidateOfAsync(doc);
        await fixture.SeedEmailVariantAsync(org, candidate, withdrawn: false);
        await fixture.SeedEmailVariantAsync(Guid.NewGuid(), candidate, withdrawn: true);

        var lease = Assert.Single(await _repository.ClaimDueAsync(10, Now, CancellationToken.None));
        Assert.Equal(doc, lease.DocumentId);
    }

    [Fact]
    public async Task Withdrawal_on_a_variant_after_the_claim_blocks_the_inference_gate_and_completion()
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        await fixture.SeedAsync(org, Now.AddMinutes(-3));
        var lease = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        await fixture.SeedEmailVariantAsync(org, lease.CandidateId, withdrawn: true);

        var called = false;
        var result = await _repository.RunWithConsentGateAsync(lease, _ =>
        {
            called = true;
            return Task.FromResult("sent");
        }, Now, CancellationToken.None);
        Assert.Null(result);
        Assert.False(called);
        Assert.False(await _repository.CompleteAsync(lease, "{\"parsed\":true}", "[]", "[]", Now,
            CancellationToken.None));
    }

    [Fact]
    public async Task The_gate_holds_the_withdrawal_lock_of_every_same_email_variant()
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        await fixture.SeedAsync(org, Now.AddMinutes(-3));
        var lease = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        var variant = await fixture.SeedEmailVariantAsync(org, lease.CandidateId, withdrawn: false);

        var inside = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var processing = _repository.RunWithConsentGateAsync(lease, async _ =>
        {
            inside.SetResult();
            await release.Task;
            return "sent";
        }, Now, CancellationToken.None);
        await inside.Task.WaitAsync(TimeSpan.FromSeconds(5));

        await using (var connection = await fixture.Source.OpenConnectionAsync())
        await using (var transaction = await connection.BeginTransactionAsync())
        await using (var probe = new NpgsqlCommand(
            "SELECT pg_try_advisory_xact_lock(hashtextextended(@variant, 0))", connection, transaction))
        {
            probe.Parameters.AddWithValue("variant", variant.ToString());
            Assert.False((bool)(await probe.ExecuteScalarAsync())!);
        }

        release.SetResult();
        Assert.Equal("sent", await processing.WaitAsync(TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public async Task A_crash_after_the_final_claim_becomes_a_recent_exhaustion_not_a_stranded_row()
    {
        await fixture.ResetAsync();
        var org = Guid.NewGuid();
        var doc = await fixture.SeedAsync(org, Now.AddMinutes(-3));
        await using (var connection = await fixture.Source.OpenConnectionAsync())
        await using (var setup = new NpgsqlCommand(
            "UPDATE candidate_documents SET cv_parse_attempts = @attempts WHERE id = @id", connection))
        {
            setup.Parameters.AddWithValue("attempts", CvParseLeaseRepository.MaxAttempts - 1);
            setup.Parameters.AddWithValue("id", doc);
            await setup.ExecuteNonQueryAsync();
        }
        var lease = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        Assert.Equal(CvParseLeaseRepository.MaxAttempts, lease.Attempt);
        // The worker dies here: no Fail, no Complete. The lease expires.

        var later = Now + CvParseLeaseRepository.LeaseDuration + TimeSpan.FromSeconds(1);
        Assert.Empty(await _repository.ClaimDueAsync(1, later, CancellationToken.None));

        var stats = await _repository.ReadStatsAsync(later, CancellationToken.None);
        Assert.Equal(1, stats.ExhaustedRecent);
        Assert.Equal(0, stats.Leased);
        await using var read = await fixture.Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(
            "SELECT cv_parse_failure_code, cv_parse_lease_token IS NULL FROM candidate_documents WHERE id=@id", read);
        command.Parameters.AddWithValue("id", doc);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("lease_expired", reader.GetString(0));
        Assert.True(reader.GetBoolean(1));
    }

    [Fact]
    public async Task A_live_final_attempt_is_not_finalized_while_its_lease_is_held()
    {
        await fixture.ResetAsync();
        var doc = await fixture.SeedAsync(Guid.NewGuid(), Now.AddMinutes(-3));
        await using (var connection = await fixture.Source.OpenConnectionAsync())
        await using (var setup = new NpgsqlCommand(
            "UPDATE candidate_documents SET cv_parse_attempts = @attempts WHERE id = @id", connection))
        {
            setup.Parameters.AddWithValue("attempts", CvParseLeaseRepository.MaxAttempts - 1);
            setup.Parameters.AddWithValue("id", doc);
            await setup.ExecuteNonQueryAsync();
        }
        var lease = Assert.Single(await _repository.ClaimDueAsync(1, Now, CancellationToken.None));
        Assert.Empty(await _repository.ClaimDueAsync(1, Now.AddSeconds(30), CancellationToken.None));
        Assert.True(await _repository.CompleteAsync(lease, "{\"parsed\":true}", "[]", "[]", Now.AddSeconds(31),
            CancellationToken.None));
    }

    [Fact]
    public async Task Concurrent_gates_and_completions_for_two_rows_of_one_person_never_deadlock()
    {
        // Tier-1 round 2: locking "own row first, then the sorted variants" let gate(A) hold A and wait
        // for B while gate(B) held B and waited for A. Both now take the whole set in id order.
        for (var round = 0; round < 15; round++)
        {
            await fixture.ResetAsync();
            var org = Guid.NewGuid();
            var docA = await fixture.SeedAsync(org, Now.AddMinutes(-4));
            var docB = await fixture.SeedAsync(org, Now.AddMinutes(-3));
            await using (var connection = await fixture.Source.OpenConnectionAsync())
            await using (var same = new NpgsqlCommand("""
                UPDATE candidates b SET email = upper(a.email)
                FROM candidate_documents da, candidate_documents db, candidates a
                WHERE da.id = @a AND db.id = @b AND a.id = da.candidate_id AND b.id = db.candidate_id
                """, connection))
            {
                same.Parameters.AddWithValue("a", docA);
                same.Parameters.AddWithValue("b", docB);
                Assert.Equal(1, await same.ExecuteNonQueryAsync());
            }
            var leases = await _repository.ClaimDueAsync(2, Now, CancellationToken.None);
            Assert.Equal(2, leases.Count);

            var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var work = leases.SelectMany(lease => new[]
            {
                Task.Run(async () =>
                {
                    await start.Task;
                    return await _repository.RunWithConsentGateAsync(lease, async t =>
                    {
                        await Task.Delay(5, t);
                        return "sent";
                    }, Now, CancellationToken.None);
                }),
                Task.Run(async () =>
                {
                    await start.Task;
                    await _repository.CompleteAsync(lease, "{\"parsed\":true}", "[]", "[]", Now, CancellationToken.None);
                    return (string?)"done";
                }),
            }).ToArray();
            start.SetResult();
            // A deadlock surfaces as a PostgresException (40P01) from one of the tasks.
            await Task.WhenAll(work).WaitAsync(TimeSpan.FromSeconds(30));
        }
    }
}
