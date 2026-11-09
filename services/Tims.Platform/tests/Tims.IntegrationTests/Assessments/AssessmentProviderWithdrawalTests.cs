using Npgsql;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// Owner default D15 against the real migration and RLS: the withdrawal staging statement, result storage after a
/// withdrawal (including the interleaving on the candidate lock), the subject-lock interleaving of erasure and mapping,
/// the cascade's conditional completion, the DSAR export and the erasure marker.
/// </summary>
[Collection("AssessmentProviderRls")]
public sealed class AssessmentProviderWithdrawalTests(AssessmentProviderSchemaFixture fixture)
{
    private static readonly Guid Org = AssessmentProviderSchemaFixture.OrgA;

    private async Task<Guid> CandidateAsync(string email, bool withdrawn)
    {
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES ('{candidate}', '{Org}', 'Wil', 'Drawn', '{email}')");
        if (withdrawn)
        {
            await WithdrawAsync(candidate);
        }

        return candidate;
    }

    private Task WithdrawAsync(Guid candidate) => fixture.ExecuteAsync(
        $"INSERT INTO data_consents (id, organization_id, subject_user_id, consent_type, withdrawn_at) VALUES (gen_random_uuid(), '{Org}', '{candidate}', 'recruitment_data_processing', now())");

    private async Task<(Guid Attempt, Guid Subject)> AttemptAsync(Guid candidate, string state, bool mapped = true)
    {
        var attempt = Guid.NewGuid();
        var subject = Guid.NewGuid();
        var ids = mapped ? $"'{subject}', gen_random_uuid()" : "NULL, NULL";
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 instrument_version, content_version, assigned_by_id, created_at)
             VALUES ('{attempt}', '{Org}', '{AssessmentProviderSchemaFixture.BindingA}', '{candidate}', gen_random_uuid(), 'lia',
                 '{state}', 'selection', 'Análisis de datos', 'es', 1, {ids}, '1.0', 'content-1', gen_random_uuid(), now())
             """);
        return (attempt, subject);
    }

    private async Task<string?> RowAsync(Guid attempt) => (string?)await fixture.ScalarAsync(
        $"SELECT state || '|' || coalesce(last_error_code, '') || '|' || coalesce(withdrawal_state, '') FROM assessment_provider_attempts WHERE id = '{attempt}'");

    private async Task<AttemptRow> FindAsync(Guid attempt)
    {
        await using var db = fixture.NewContext();
        return (await new AssessmentProviderRepository(db).FindAttemptAsync(Org, attempt, CancellationToken.None))!;
    }

    [Fact]
    public async Task Staging_cancels_open_attempts_keeps_finished_ones_and_reaches_a_same_email_sibling()
    {
        var email = $"{Guid.NewGuid():N}@a.example";
        var candidate = await CandidateAsync(email, withdrawn: true);
        var sibling = await CandidateAsync(email.ToUpperInvariant(), withdrawn: false);
        var bystander = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (open, _) = await AttemptAsync(candidate, "launched");
        var (unmapped, _) = await AttemptAsync(candidate, "pending_create", mapped: false);
        var (finished, _) = await AttemptAsync(candidate, "result_ready");
        var (siblings, _) = await AttemptAsync(sibling, "created");
        var (others, _) = await AttemptAsync(bystander, "created");

        await using var db = fixture.NewContext();
        var staged = await new AssessmentProviderRepository(db).StageConsentWithdrawalAsync(
            Org, candidate, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal(4, staged);
        Assert.Equal("cancelled|provider_cancel_pending|pending", await RowAsync(open));
        Assert.Equal("cancelled||pending", await RowAsync(unmapped));
        Assert.Equal("result_ready||pending", await RowAsync(finished));
        Assert.Equal("cancelled|provider_cancel_pending|pending", await RowAsync(siblings));
        Assert.Equal("created||", await RowAsync(others));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE action = 'assessment_provider_withdrawal_staged' AND entity_id = '{candidate}'"));
    }

    [Fact]
    public async Task A_candidate_who_did_not_withdraw_is_never_staged()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "launched");

        await using var db = fixture.NewContext();
        Assert.Equal(0, await new AssessmentProviderRepository(db).StageConsentWithdrawalAsync(
            Org, candidate, DateTimeOffset.UtcNow, CancellationToken.None));
        Assert.Equal("launched||", await RowAsync(attempt));
    }

    private static ParsedProviderResult ResultFor(AttemptRow attempt) => new(
        Guid.NewGuid(), "LiaResultV1", "lia", "1.0", AssessmentProviderSchemaFixture.TenantA, attempt.ProviderSubjectId!.Value,
        attempt.ProviderAssignmentId!.Value, "selection", attempt.VacancyId.ToString(), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, 1,
        "valid", [], "content-1", new string('c', 64), "norms-1", "scoring-1", "deterministic", 1m, "tenant_hr", "full",
        "complete", 50, null, null, false, "{}");

    [Fact]
    public async Task No_result_is_stored_for_a_candidate_who_withdrew()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "completed");
        var row = await FindAsync(attempt);
        await WithdrawAsync(candidate); // committed after the result was fetched, before it is stored

        await using var db = fixture.NewContext();
        var stored = await new AssessmentProviderRepository(db).StoreResultAsync(Org, row, ResultFor(row), DateTimeOffset.UtcNow,
            CancellationToken.None);

        Assert.False(stored);
        Assert.Equal(0L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
    }

    [Fact]
    public async Task A_result_store_waiting_on_a_withdrawal_that_holds_the_candidate_lock_stores_nothing()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "completed");
        var row = await FindAsync(attempt);

        // The withdrawal's transaction: the candidate lock, then its consent row, not committed yet.
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand(
            $"""
             SELECT pg_advisory_xact_lock(hashtextextended('{candidate}', 0));
             INSERT INTO data_consents (id, organization_id, subject_user_id, consent_type, withdrawn_at)
             VALUES (gen_random_uuid(), '{Org}', '{candidate}', 'recruitment_data_processing', now());
             """, connection, transaction))
        {
            await command.ExecuteNonQueryAsync();
        }

        await using var db = fixture.NewContext();
        var store = new AssessmentProviderRepository(db).StoreResultAsync(Org, row, ResultFor(row), DateTimeOffset.UtcNow,
            CancellationToken.None);
        await Task.Delay(400);
        Assert.False(store.IsCompleted); // blocked on the candidate lock
        await transaction.CommitAsync();

        Assert.False(await store);
        Assert.Equal(0L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
    }

    [Fact]
    public async Task D12_a_void_after_publication_arrives_as_a_new_revision_and_voids_the_attempt()
    {
        // Owner default D12: the provider never sends session.voided for a published result; it re-publishes the
        // result with validity voided. CanTransition(result_ready, voided) stays false; the revision does the voiding.
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "completed");
        var row = await FindAsync(attempt);
        var first = ResultFor(row);
        await using (var db = fixture.NewContext())
        {
            Assert.True(await new AssessmentProviderRepository(db).StoreResultAsync(Org, row, first, DateTimeOffset.UtcNow,
                CancellationToken.None));
        }

        Assert.Equal("result_ready||", await RowAsync(attempt));
        var voidedRevision = first with { ResultRevision = 2, ValidityStatus = ProviderValidity.Voided };
        await using (var db = fixture.NewContext())
        {
            Assert.True(await new AssessmentProviderRepository(db).StoreResultAsync(Org, await FindAsync(attempt), voidedRevision,
                DateTimeOffset.UtcNow, CancellationToken.None));
        }

        Assert.Equal("voided||", await RowAsync(attempt));
        Assert.Equal("voided|2", await fixture.ScalarAsync(
            $"SELECT validity_status || '|' || result_revision FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
    }

    // ---- The subject advisory lock: erasure and mapping of one provider subject interleave safely --------------------

    private static string SubjectLock(Guid subject) =>
        $"SELECT pg_advisory_xact_lock(hashtextextended('assessment-provider-subject:' || '{subject}', 0));";

    [Fact]
    public async Task An_erasure_waiting_on_a_mapping_in_flight_erases_the_attempt_that_mapping_commits()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "pending_create", mapped: false);
        var subject = Guid.NewGuid();

        // MarkCreatedAsync's transaction, mid-flight: the subject lock held, the mapping written but not committed.
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand(
            SubjectLock(subject) +
            $"UPDATE assessment_provider_attempts SET state = 'created', provider_subject_id = '{subject}', provider_assignment_id = gen_random_uuid() WHERE id = '{attempt}';",
            connection, transaction))
        {
            await command.ExecuteNonQueryAsync();
        }

        await using var db = fixture.NewContext();
        var erase = new AssessmentProviderRepository(db).EraseSubjectAsync(Org, subject, DateTimeOffset.UtcNow, CancellationToken.None);
        await Task.Delay(400);
        Assert.False(erase.IsCompleted); // waits for the mapping instead of reading a subject with no attempts
        await transaction.CommitAsync();

        Assert.Equal(1, await erase);
        Assert.Equal("erased||", await RowAsync(attempt));
    }

    [Fact]
    public async Task A_mapping_waiting_on_an_erasure_in_flight_leaves_the_attempt_erased()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "pending_create", mapped: false);
        var subject = Guid.NewGuid();

        // The webhook's transaction for subject.erased: the subject lock held and its tombstone recorded, uncommitted.
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand(
            SubjectLock(subject) +
            $$"""
             INSERT INTO assessment_provider_webhook_inbox (id, organization_id, event_id, event_type, event_version,
                 provider_tenant_id, occurred_at, status, data)
             VALUES (gen_random_uuid(), '{{Org}}', gen_random_uuid(), 'subject.erased', 1, '{{AssessmentProviderSchemaFixture.TenantA}}',
                 now(), 'processed', '{"subject_id":"{{subject}}"}');
             """, connection, transaction))
        {
            await command.ExecuteNonQueryAsync();
        }

        await using var db = fixture.NewContext();
        var assignment = new ProviderAssignment(Guid.NewGuid(), AssessmentProviderSchemaFixture.TenantA, subject, "lia", "1.0",
            "content-1", "created", ["assessment"], ["assessment"], DateTimeOffset.UtcNow.AddDays(14), attempt.ToString());
        var map = new AssessmentProviderRepository(db).MarkCreatedAsync(Org, attempt, assignment, DateTimeOffset.UtcNow,
            CancellationToken.None);
        await Task.Delay(400);
        Assert.False(map.IsCompleted);
        await transaction.CommitAsync();

        Assert.Equal("erased", await map);
        Assert.Equal("erased||", await RowAsync(attempt));
    }

    // ---- The cascade's completion, the DSAR export and the erasure marker -------------------------------------------

    [Fact]
    public async Task Completing_the_cascade_skips_an_attempt_whose_provider_cancel_is_still_pending()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: true);
        var (open, _) = await AttemptAsync(candidate, "launched");
        var (finished, _) = await AttemptAsync(candidate, "result_ready");
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        await repository.StageConsentWithdrawalAsync(Org, candidate, DateTimeOffset.UtcNow, CancellationToken.None);

        var fences = await repository.ReadWithdrawalFencesAsync(Org, [open, finished], CancellationToken.None);
        var moved = await repository.MarkWithdrawalDoneAsync(Org, fences, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal(1, moved);
        Assert.Equal("cancelled|provider_cancel_pending|pending", await RowAsync(open));
        Assert.Equal("result_ready||done", await RowAsync(finished));
    }

    private async Task<string?> CaptureAsync(Guid attempt) => (string?)await fixture.ScalarAsync(
        $"SELECT consent_capture_generation || '|' || consent_captures_in_flight || '|' || (consent_capture_started_at IS NOT NULL) FROM assessment_provider_attempts WHERE id = '{attempt}'");

    // Codex release review, round 2 [P1] x2: the consent-capture fence, against the real SQL.
    [Fact]
    public async Task A_capture_is_refused_for_an_attempt_already_in_a_withdrawal_and_counted_while_in_flight()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "created");
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);

        Assert.True(await repository.BeginConsentCaptureAsync(Org, attempt, DateTimeOffset.UtcNow, CancellationToken.None));
        Assert.True(await repository.BeginConsentCaptureAsync(Org, attempt, DateTimeOffset.UtcNow, CancellationToken.None));
        Assert.Equal("2|2|true", await CaptureAsync(attempt));
        await repository.EndConsentCaptureAsync(Org, attempt, DateTimeOffset.UtcNow, CancellationToken.None);
        Assert.Equal("3|1|true", await CaptureAsync(attempt)); // the other launch's capture is still in flight
        await repository.EndConsentCaptureAsync(Org, attempt, DateTimeOffset.UtcNow, CancellationToken.None);
        Assert.Equal("4|0|false", await CaptureAsync(attempt));

        await WithdrawAsync(candidate);
        await repository.StageConsentWithdrawalAsync(Org, candidate, DateTimeOffset.UtcNow, CancellationToken.None);
        Assert.False(await repository.BeginConsentCaptureAsync(Org, attempt, DateTimeOffset.UtcNow, CancellationToken.None));
        Assert.Equal("4|0|false", await CaptureAsync(attempt));
        Assert.Equal(2L, (long)(await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE entity_id = '{attempt}' AND action = 'assessment_provider_consent_capture_started'"))!);
    }

    [Fact]
    public async Task Completion_waits_for_an_in_flight_capture_until_it_is_stale()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "result_ready");
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        Assert.True(await repository.BeginConsentCaptureAsync(Org, attempt, DateTimeOffset.UtcNow, CancellationToken.None));
        await WithdrawAsync(candidate);
        await repository.StageConsentWithdrawalAsync(Org, candidate, DateTimeOffset.UtcNow, CancellationToken.None);

        var fresh = Assert.Single(await repository.ReadWithdrawalFencesAsync(Org, [attempt], CancellationToken.None));
        Assert.Equal(0, await repository.MarkWithdrawalDoneAsync(Org, [fresh], DateTimeOffset.UtcNow, CancellationToken.None));
        Assert.Equal("result_ready||pending", await RowAsync(attempt));

        // Even a pass that wrongly believed it stale cannot complete it: the database re-checks in-flight against the fence.
        Assert.Equal(0, await repository.MarkWithdrawalDoneAsync(
            Org, [fresh with { CaptureInFlight = false }], DateTimeOffset.UtcNow, CancellationToken.None));

        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET consent_capture_started_at = clock_timestamp() - interval '11 minutes' WHERE id = '{attempt}'");
        var stale = Assert.Single(await repository.ReadWithdrawalFencesAsync(Org, [attempt], CancellationToken.None));
        Assert.True(stale is { CaptureInFlight: true, CaptureStale: true });
        Assert.Equal(1, await repository.MarkWithdrawalDoneAsync(Org, [stale], DateTimeOffset.UtcNow, CancellationToken.None));
        Assert.Equal("result_ready||done", await RowAsync(attempt));
    }

    [Fact]
    public async Task Completion_is_refused_when_a_capture_ended_after_the_fence_was_read()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "result_ready");
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        Assert.True(await repository.BeginConsentCaptureAsync(Org, attempt, DateTimeOffset.UtcNow, CancellationToken.None));
        await WithdrawAsync(candidate);
        await repository.StageConsentWithdrawalAsync(Org, candidate, DateTimeOffset.UtcNow, CancellationToken.None);
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET consent_capture_started_at = clock_timestamp() - interval '11 minutes' WHERE id = '{attempt}'");
        var stale = Assert.Single(await repository.ReadWithdrawalFencesAsync(Org, [attempt], CancellationToken.None));

        // The stale capture's launch resumes and ends it after the pass read its fence: the listing may predate it.
        await repository.EndConsentCaptureAsync(Org, attempt, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal(0, await repository.MarkWithdrawalDoneAsync(Org, [stale], DateTimeOffset.UtcNow, CancellationToken.None));
        Assert.Equal("result_ready||pending", await RowAsync(attempt));
        var next = Assert.Single(await repository.ReadWithdrawalFencesAsync(Org, [attempt], CancellationToken.None));
        Assert.Equal(1, await repository.MarkWithdrawalDoneAsync(Org, [next], DateTimeOffset.UtcNow, CancellationToken.None));
    }

    // Codex release round 2 [P2] (slice "fit"): a pass sends what it leaves pending to the back of the listing, so a batch
    // that keeps failing cannot starve the attempts behind it; a completed attempt is never touched.
    [Fact]
    public async Task Deferring_moves_still_pending_attempts_to_the_back_of_the_listing()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: true);
        var (first, _) = await AttemptAsync(candidate, "result_ready");
        var (second, _) = await AttemptAsync(candidate, "completed");
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET withdrawal_state = 'pending', updated_at = now() - interval '2 hours' WHERE id = '{first}'");
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET withdrawal_state = 'pending', updated_at = now() - interval '1 hour' WHERE id = '{second}'");
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        try
        {
            var before = (await repository.ListPendingWithdrawalsAsync(Org, 500, CancellationToken.None)).Select(a => a.Id).ToList();
            Assert.True(before.IndexOf(first) < before.IndexOf(second));

            await repository.DeferPendingWithdrawalsAsync(Org, [first], DateTimeOffset.UtcNow, CancellationToken.None);

            var after = (await repository.ListPendingWithdrawalsAsync(Org, 500, CancellationToken.None)).Select(a => a.Id).ToList();
            Assert.True(after.IndexOf(second) < after.IndexOf(first));

            await fixture.ExecuteAsync($"UPDATE assessment_provider_attempts SET withdrawal_state = 'done' WHERE id = '{second}'");
            var doneAt = await fixture.ScalarAsync($"SELECT updated_at::text FROM assessment_provider_attempts WHERE id = '{second}'");
            await repository.DeferPendingWithdrawalsAsync(Org, [second], DateTimeOffset.UtcNow.AddHours(1), CancellationToken.None);
            Assert.Equal(doneAt, await fixture.ScalarAsync($"SELECT updated_at::text FROM assessment_provider_attempts WHERE id = '{second}'"));
        }
        finally
        {
            await fixture.ExecuteAsync(
                $"UPDATE assessment_provider_attempts SET withdrawal_state = 'done' WHERE id IN ('{first}', '{second}')");
        }
    }

    // Codex release round 3 [P2] (slice "fit"): the sweep visits organizations oldest pending work first, so an
    // organization whose attempts keep failing (and are deferred) moves behind the others instead of holding the bound.
    [Fact]
    public async Task The_sweep_lists_organizations_by_their_oldest_pending_attempt_so_deferral_rotates_them()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: true);
        var (attempt, _) = await AttemptAsync(candidate, "result_ready");
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET withdrawal_state = 'pending', updated_at = now() - interval '3 days' WHERE id = '{attempt}'");
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET withdrawal_state = 'pending', updated_at = now() - interval '1 day' WHERE id = '{AssessmentProviderSchemaFixture.AttemptB}'");
        try
        {
            Assert.Equal([Org], await repository.ListOrganizationsWithPendingWithdrawalsAsync(1, CancellationToken.None));

            await repository.DeferPendingWithdrawalsAsync(Org, [attempt], DateTimeOffset.UtcNow, CancellationToken.None);

            Assert.Equal(
                [AssessmentProviderSchemaFixture.OrgB],
                await repository.ListOrganizationsWithPendingWithdrawalsAsync(1, CancellationToken.None));
        }
        finally
        {
            await fixture.ExecuteAsync($"UPDATE assessment_provider_attempts SET withdrawal_state = 'done' WHERE id = '{attempt}'");
            await fixture.ExecuteAsync(
                $"UPDATE assessment_provider_attempts SET withdrawal_state = NULL WHERE id = '{AssessmentProviderSchemaFixture.AttemptB}'");
        }
    }

    // Codex release review, round 3 [P1]: the sweep's pre-tenant listing sees every organization with pending work.
    [Fact]
    public async Task The_sweep_lists_every_organization_holding_a_pending_withdrawal_and_no_other()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: true);
        var (attempt, _) = await AttemptAsync(candidate, "result_ready");
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET withdrawal_state = 'pending' WHERE id = '{AssessmentProviderSchemaFixture.AttemptB}'");
        try
        {
            await repository.StageConsentWithdrawalAsync(Org, candidate, DateTimeOffset.UtcNow, CancellationToken.None);

            var organizations = await repository.ListOrganizationsWithPendingWithdrawalsAsync(10, CancellationToken.None);

            Assert.Contains(AssessmentProviderSchemaFixture.OrgA, organizations);
            Assert.Contains(AssessmentProviderSchemaFixture.OrgB, organizations); // pre-tenant: across organizations
            Assert.Equal(organizations.Distinct().Count(), organizations.Count);

            var fence = Assert.Single(await repository.ReadWithdrawalFencesAsync(Org, [attempt], CancellationToken.None));
            await repository.MarkWithdrawalDoneAsync(Org, [fence], DateTimeOffset.UtcNow, CancellationToken.None);
            await fixture.ExecuteAsync(
                $"UPDATE assessment_provider_attempts SET withdrawal_state = 'done' WHERE organization_id = '{Org}' AND withdrawal_state = 'pending'");
            Assert.DoesNotContain(AssessmentProviderSchemaFixture.OrgA,
                await repository.ListOrganizationsWithPendingWithdrawalsAsync(10, CancellationToken.None));
        }
        finally
        {
            await fixture.ExecuteAsync(
                $"UPDATE assessment_provider_attempts SET withdrawal_state = NULL WHERE id = '{AssessmentProviderSchemaFixture.AttemptB}'");
        }
    }

    [Fact]
    public async Task The_capture_counters_cannot_go_negative()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "created");

        var error = await Assert.ThrowsAsync<PostgresException>(() => fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET consent_captures_in_flight = -1 WHERE id = '{attempt}'"));

        Assert.Equal("ck_assessment_provider_attempts_consent_capture", error.ConstraintName);
    }

    [Fact]
    public async Task The_withdrawal_state_column_accepts_only_the_cascade_vocabulary()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (attempt, _) = await AttemptAsync(candidate, "created");

        var error = await Assert.ThrowsAsync<PostgresException>(() => fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET withdrawal_state = 'maybe' WHERE id = '{attempt}'"));

        Assert.Equal("ck_assessment_provider_attempts_withdrawal_state", error.ConstraintName);
    }

    [Fact]
    public async Task The_dsar_export_returns_the_candidates_attempts_and_results_with_an_audit_row()
    {
        var actor = Guid.NewGuid();
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);

        var export = await repository.ExportCandidateAsync(Org, AssessmentProviderSchemaFixture.CandidateA, actor,
            DateTimeOffset.UtcNow, CancellationToken.None);
        var foreign = await repository.ExportCandidateAsync(Org, AssessmentProviderSchemaFixture.CandidateB, actor,
            DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Contains(export!.Attempts, a => a.AttemptId == AssessmentProviderSchemaFixture.AttemptA);
        Assert.Contains(export.Results, r => r.ResultId == AssessmentProviderSchemaFixture.ResultA && r.GlobalPercentile == 46.2);
        Assert.DoesNotContain(export.Attempts, a => a.AttemptId == AssessmentProviderSchemaFixture.AttemptB);
        Assert.Null(foreign); // another org's candidate is not found, never exported
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE action = 'assessment_provider_subject_exported' AND actor_id = '{actor}'"));
    }

    [Fact]
    public async Task An_accepted_erasure_marks_only_that_subjects_attempts_and_stops_their_results()
    {
        var candidate = await CandidateAsync($"{Guid.NewGuid():N}@a.example", withdrawn: false);
        var (erased, subject) = await AttemptAsync(candidate, "completed");
        var (kept, _) = await AttemptAsync(candidate, "completed");
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);

        await repository.MarkErasureRequestedAsync(Org, candidate, subject, "accepted", Guid.NewGuid(), DateTimeOffset.UtcNow,
            CancellationToken.None);
        var row = await FindAsync(erased);
        var stored = await repository.StoreResultAsync(Org, row, ResultFor(row), DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.True(row.ResultsStopped);
        Assert.False((await FindAsync(kept)).ResultsStopped);
        Assert.False(stored);
    }
}
