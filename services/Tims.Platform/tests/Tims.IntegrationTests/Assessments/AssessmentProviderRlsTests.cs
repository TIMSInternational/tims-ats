using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// AS-5: two-tenant isolation of the four provider tables FOR REAL, against the migration's own RLS and grant blocks
/// in a Postgres container (never mocked), plus the repository paths that cross the tenant boundary on purpose.
/// </summary>
[Collection("AssessmentProviderRls")]
public sealed class AssessmentProviderRlsTests(AssessmentProviderSchemaFixture fixture)
{
    private static readonly string[] Tables =
    [
        AssessmentProviderDbContext.BindingsTable, AssessmentProviderDbContext.AttemptsTable,
        AssessmentProviderDbContext.ResultsTable, AssessmentProviderDbContext.InboxTable,
    ];

    [Fact]
    public async Task OrgA_reads_only_its_own_rows_in_every_table()
    {
        await using var db = fixture.NewContext();
        await using var scope = await TenantScope.BeginAsync(db, AssessmentProviderSchemaFixture.OrgA);

        var bindings = await db.Bindings.AsNoTracking().ToListAsync();
        var attempts = await db.Attempts.AsNoTracking().ToListAsync();
        var results = await db.Results.AsNoTracking().ToListAsync();
        var inbox = await db.Inbox.AsNoTracking().ToListAsync();
        await scope.CommitAsync();

        // Other tests in this collection add OrgA rows, so assert ownership of every visible row, presence of OrgA's
        // seed and absence of OrgB's — never a count.
        Assert.Equal(AssessmentProviderSchemaFixture.BindingA, Assert.Single(bindings).Id);
        Assert.All(attempts, a => Assert.Equal(AssessmentProviderSchemaFixture.OrgA, a.OrganizationId));
        Assert.All(results, r => Assert.Equal(AssessmentProviderSchemaFixture.OrgA, r.OrganizationId));
        Assert.All(inbox, i => Assert.Equal(AssessmentProviderSchemaFixture.OrgA, i.OrganizationId));
        Assert.Contains(attempts, a => a.Id == AssessmentProviderSchemaFixture.AttemptA);
        Assert.DoesNotContain(attempts, a => a.Id == AssessmentProviderSchemaFixture.AttemptB);
        Assert.Contains(results, r => r.ProviderResultId == AssessmentProviderSchemaFixture.ResultA);
        Assert.DoesNotContain(results, r => r.ProviderResultId == AssessmentProviderSchemaFixture.ResultB);
        Assert.Contains(inbox, i => i.EventId == AssessmentProviderSchemaFixture.EventA);
        Assert.DoesNotContain(inbox, i => i.EventId == AssessmentProviderSchemaFixture.EventB);
    }

    [Fact]
    public async Task OrgA_cannot_update_or_delete_OrgB_rows()
    {
        await using var db = fixture.NewContext();
        await using var scope = await TenantScope.BeginAsync(db, AssessmentProviderSchemaFixture.OrgA);

        var updated = await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE assessment_provider_attempts SET state = 'voided' WHERE id = {AssessmentProviderSchemaFixture.AttemptB}");
        var deleted = await db.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM assessment_provider_results WHERE provider_result_id = {AssessmentProviderSchemaFixture.ResultB}");
        await scope.CommitAsync();

        Assert.Equal(0, updated);
        Assert.Equal(0, deleted);
        Assert.Equal("result_ready", await fixture.ScalarAsync(
            $"SELECT state FROM assessment_provider_attempts WHERE id = '{AssessmentProviderSchemaFixture.AttemptB}'"));
    }

    [Fact]
    public async Task An_unset_org_sees_zero_rows_fail_closed()
    {
        await using var db = fixture.NewContext();
        await using var scope = await TenantScope.BeginAsync(db, organizationId: null);

        var counts = new[]
        {
            await db.Bindings.CountAsync(), await db.Attempts.CountAsync(), await db.Results.CountAsync(), await db.Inbox.CountAsync(),
        };
        await scope.CommitAsync();

        Assert.All(counts, c => Assert.Equal(0, c));
    }

    [Fact]
    public async Task OrgA_cannot_insert_a_row_stamped_for_OrgB()
    {
        await using var db = fixture.NewContext();
        await using var scope = await TenantScope.BeginAsync(db, AssessmentProviderSchemaFixture.OrgA);

        var ex = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO assessment_provider_webhook_inbox (id, organization_id, event_id, event_type, event_version,
                 provider_tenant_id, occurred_at, status, data)
             VALUES ({Guid.NewGuid()}, {AssessmentProviderSchemaFixture.OrgB}, {Guid.NewGuid()}, 'result.ready', 1,
                 {AssessmentProviderSchemaFixture.TenantB}, now(), 'received', CAST({"{}"} AS jsonb))
             """));

        Assert.Equal("42501", ex.SqlState); // new row violates row-level security policy
    }

    [Fact]
    public async Task The_tenant_role_cannot_write_bindings_even_for_its_own_org()
    {
        await using var db = fixture.NewContext();
        await using var scope = await TenantScope.BeginAsync(db, AssessmentProviderSchemaFixture.OrgA);

        var ex = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE assessment_provider_bindings SET enabled_instruments = ARRAY['lia','english','itcia'] WHERE id = {AssessmentProviderSchemaFixture.BindingA}"));

        Assert.Equal("42501", ex.SqlState); // permission denied: bindings are platform-owner writes only
    }

    [Fact]
    public async Task Every_table_forces_rls_and_carries_the_tenant_isolation_policy()
    {
        foreach (var table in Tables)
        {
            Assert.Equal(true, await fixture.ScalarAsync(
                $"SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = '{table}' AND relkind = 'r'"));
            Assert.Equal(1L, await fixture.ScalarAsync(
                $"SELECT count(*) FROM pg_policies WHERE tablename = '{table}' AND policyname = 'tenant_isolation'"));
        }
    }

    [Fact]
    public async Task Anon_and_authenticated_hold_no_privilege_despite_the_default_acl()
    {
        // The fixture's default ACL grants ALL to both roles on every new table, as Supabase's does: only the
        // migration's REVOKE can make this pass.
        foreach (var table in Tables)
        {
            foreach (var role in new[] { "anon", "authenticated" })
            {
                foreach (var privilege in new[] { "SELECT", "INSERT", "UPDATE", "DELETE" })
                {
                    Assert.Equal(false, await fixture.ScalarAsync($"SELECT has_table_privilege('{role}', '{table}', '{privilege}')"));
                }
            }
        }

        Assert.Equal(false, await fixture.ScalarAsync(
            "SELECT has_table_privilege('app_tenant', 'assessment_provider_webhook_inbox', 'DELETE')"));
        Assert.Equal(true, await fixture.ScalarAsync(
            "SELECT has_table_privilege('app_tenant', 'assessment_provider_attempts', 'INSERT')"));
    }

    [Fact]
    public async Task The_fit_rows_of_a_candidate_never_include_another_orgs_result()
    {
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);

        var own = await repository.GetFitRowsAsync(AssessmentProviderSchemaFixture.OrgA, AssessmentProviderSchemaFixture.CandidateA,
            AssessmentProviderSchemaFixture.VacancyA, CancellationToken.None);
        // OrgA asking for OrgB's candidate and vacancy ids: RLS + the explicit org filter return nothing.
        var foreign = await repository.GetFitRowsAsync(AssessmentProviderSchemaFixture.OrgA, AssessmentProviderSchemaFixture.CandidateB,
            AssessmentProviderSchemaFixture.VacancyB, CancellationToken.None);

        var row = Assert.Single(own);
        Assert.Equal(AssessmentProviderSchemaFixture.ResultA, row.ProviderResultId);
        Assert.Equal(46.2, row.GlobalPercentile);
        Assert.Empty(foreign);
        Assert.Equal(ProviderResultIntegrity.Valid, Assert.Single(ProviderFitMapping.Map(own)).Integrity);
    }

    [Fact]
    public async Task A_webhook_tenant_resolves_to_exactly_its_bound_org()
    {
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);

        Assert.Equal(new ProviderTenantOwner(AssessmentProviderSchemaFixture.OrgB, true),
            await repository.FindOrganizationByProviderTenantAsync(AssessmentProviderSchemaFixture.TenantB, CancellationToken.None));
        Assert.Null(await repository.FindOrganizationByProviderTenantAsync(Guid.NewGuid(), CancellationToken.None));
    }

    [Theory]
    [MemberData(nameof(EveryEventType))]
    public async Task The_inbox_accepts_every_contract_event_type(string eventType)
    {
        // The inbox's CHECK constraint is generated from ProviderEventTypes.All: a type added to the vocabulary but not
        // to the migration would fail every delivery of it on insert.
        await using var db = fixture.NewContext();
        var envelope = new ProviderEventEnvelope(
            Guid.NewGuid(), eventType, DateTimeOffset.UtcNow, AssessmentProviderSchemaFixture.TenantA, "{}");

        Assert.Equal(InboxOutcome.New, await new AssessmentProviderRepository(db).RecordInboxAsync(
            AssessmentProviderSchemaFixture.OrgA, envelope, 1, DateTimeOffset.UtcNow, CancellationToken.None));
    }

    public static TheoryData<string> EveryEventType() => [.. ProviderEventTypes.All];

    [Fact]
    public async Task The_inbox_deduplicates_an_event_and_another_org_cannot_see_or_claim_it()
    {
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        var envelope = new ProviderEventEnvelope(
            Guid.NewGuid(), ProviderEventTypes.SessionCompleted, DateTimeOffset.UtcNow, AssessmentProviderSchemaFixture.TenantA, "{}");

        // A delivery without TIMS-Delivery-Attempt stores NULL (the parameter must still type as integer).
        var first = await repository.RecordInboxAsync(AssessmentProviderSchemaFixture.OrgA, envelope, null, DateTimeOffset.UtcNow, CancellationToken.None);
        var unfinished = await repository.RecordInboxAsync(AssessmentProviderSchemaFixture.OrgA, envelope, 2, DateTimeOffset.UtcNow, CancellationToken.None);
        // OrgA's due rows from other tests in this collection may come first: claim until this event is ours.
        var owner = Guid.NewGuid();
        ClaimedInboxEvent? claimed = null;
        for (var i = 0; i < 50 && claimed?.Envelope.EventId != envelope.EventId; i++)
        {
            claimed = await repository.ClaimInboxEventAsync(AssessmentProviderSchemaFixture.OrgA, owner, CancellationToken.None);
            Assert.NotNull(claimed);
        }

        Assert.Equal(envelope.EventId, claimed!.Envelope.EventId);
        // Another org's worker never sees it (RLS and the explicit org filter).
        var other = await repository.ClaimInboxEventAsync(AssessmentProviderSchemaFixture.OrgB, Guid.NewGuid(), CancellationToken.None);
        Assert.NotEqual(envelope.EventId, other?.Envelope.EventId);
        await repository.CompleteInboxAsync(AssessmentProviderSchemaFixture.OrgA, envelope.EventId, owner, InboxStatuses.Processed,
            null, null, DateTimeOffset.UtcNow, CancellationToken.None);
        var done = await repository.RecordInboxAsync(AssessmentProviderSchemaFixture.OrgA, envelope, 3, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal(InboxOutcome.New, first);
        Assert.Equal(InboxOutcome.Retry, unfinished);
        Assert.Equal(InboxOutcome.Done, done);
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_webhook_inbox WHERE event_id = '{envelope.EventId}'"));
    }

    [Fact]
    public async Task A_withdrawn_candidate_cannot_be_reserved_and_nothing_is_written()
    {
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO candidates (id, organization_id, first_name, last_name, email)
             VALUES ('{candidate}', '{AssessmentProviderSchemaFixture.OrgA}', 'Wil', 'Drawn', 'wil@a.example');
             INSERT INTO data_consents (id, organization_id, subject_user_id, consent_type, withdrawn_at)
             VALUES (gen_random_uuid(), '{AssessmentProviderSchemaFixture.OrgA}', '{candidate}', 'recruitment_data_processing', now());
             """);
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        var binding = new ProviderBindingRow(AssessmentProviderSchemaFixture.BindingA, AssessmentProviderSchemaFixture.OrgA,
            AssessmentProviderSchemaFixture.TenantA, ["lia"], "es");

        var outcome = await repository.ReserveAttemptsAsync(AssessmentProviderSchemaFixture.OrgA, Guid.NewGuid(), binding, candidate,
            AssessmentProviderSchemaFixture.VacancyA, [new NewAttempt("lia", "Análisis de datos", "es", 1m, [], null)],
            DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.True(outcome.ConsentWithdrawn);
        Assert.Equal(0L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_attempts WHERE candidate_id = '{candidate}'"));
    }

    [Fact]
    public async Task Reserving_twice_returns_the_same_open_attempt_with_one_audit_row()
    {
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES ('{candidate}', '{AssessmentProviderSchemaFixture.OrgA}', 'Re', 'Try', 're@a.example')");
        var binding = new ProviderBindingRow(AssessmentProviderSchemaFixture.BindingA, AssessmentProviderSchemaFixture.OrgA,
            AssessmentProviderSchemaFixture.TenantA, ["lia", "english"], "es");
        NewAttempt[] attempts =
        [
            new("lia", "Análisis de datos", "es", 1.25m, ["extended_breaks"], null),
            new("english", "Clientes en inglés", "es", 1.25m, ["extended_breaks"], null),
        ];

        await using var first = fixture.NewContext();
        var a = await new AssessmentProviderRepository(first).ReserveAttemptsAsync(AssessmentProviderSchemaFixture.OrgA, Guid.NewGuid(),
            binding, candidate, AssessmentProviderSchemaFixture.VacancyA, attempts, DateTimeOffset.UtcNow, CancellationToken.None);
        await using var second = fixture.NewContext();
        var b = await new AssessmentProviderRepository(second).ReserveAttemptsAsync(AssessmentProviderSchemaFixture.OrgA, Guid.NewGuid(),
            binding, candidate, AssessmentProviderSchemaFixture.VacancyA, attempts, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.All(a.Attempts, r => Assert.True(r.IsNew));
        Assert.All(b.Attempts, r => Assert.False(r.IsNew));
        Assert.Equal(a.Attempts.Select(r => r.Id).Order(), b.Attempts.Select(r => r.Id).Order());
        Assert.Equal(2L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_attempts WHERE candidate_id = '{candidate}'"));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE action = 'assessment_provider_assigned' AND metadata->>'candidateId' = '{candidate}'"));
    }

    [Fact]
    public async Task An_open_attempt_with_other_terms_is_reported_and_nothing_is_written()
    {
        var candidate = Guid.NewGuid();
        var binding = new ProviderBindingRow(AssessmentProviderSchemaFixture.BindingA, AssessmentProviderSchemaFixture.OrgA,
            AssessmentProviderSchemaFixture.TenantA, ["lia", "english"], "es");
        await using (var first = fixture.NewContext())
        {
            await new AssessmentProviderRepository(first).ReserveAttemptsAsync(AssessmentProviderSchemaFixture.OrgA, Guid.NewGuid(),
                binding, candidate, AssessmentProviderSchemaFixture.VacancyA,
                [new NewAttempt("lia", "Análisis de datos", "es", 1.5m, ["extended_breaks", "screen_reader"], null)],
                DateTimeOffset.UtcNow, CancellationToken.None);
        }

        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        // Same terms, aids in another order: the open attempt is returned.
        var same = await repository.ReserveAttemptsAsync(AssessmentProviderSchemaFixture.OrgA, Guid.NewGuid(), binding, candidate,
            AssessmentProviderSchemaFixture.VacancyA,
            [new NewAttempt("lia", "Análisis de datos", "es", 1.50m, ["screen_reader", "extended_breaks"], null)],
            DateTimeOffset.UtcNow, CancellationToken.None);
        // A corrected multiplier, plus a new instrument: refused as a whole.
        var corrected = await repository.ReserveAttemptsAsync(AssessmentProviderSchemaFixture.OrgA, Guid.NewGuid(), binding, candidate,
            AssessmentProviderSchemaFixture.VacancyA,
            [
                new NewAttempt("lia", "Análisis de datos", "es", 2m, ["extended_breaks", "screen_reader"], null),
                new NewAttempt("english", "Clientes en inglés", "es", 2m, [], null),
            ],
            DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Null(same.TermsConflict);
        Assert.False(Assert.Single(same.Attempts).IsNew);
        Assert.Equal(1.5m, corrected.TermsConflict!.TimeMultiplier);
        Assert.Empty(corrected.Attempts);
        Assert.Equal(1L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_attempts WHERE candidate_id = '{candidate}'"));
    }

    [Fact]
    public async Task A_staff_cancel_is_audited_and_frees_the_slot_for_a_corrected_assignment()
    {
        var (attempt, _) = await InsertAttemptAsync("launched");
        var actor = Guid.NewGuid();

        await using var db = fixture.NewContext();
        var mapping = (Guid)(await fixture.ScalarAsync($"SELECT provider_assignment_id FROM assessment_provider_attempts WHERE id = '{attempt}'"))!;
        var state = await new AssessmentProviderRepository(db).MarkCancelledAsync(
            AssessmentProviderSchemaFixture.OrgA, attempt, mapping, actor, cancelledAtProvider: true, DateTimeOffset.UtcNow,
            CancellationToken.None);

        Assert.Equal("cancelled", state);
        Assert.Equal(1L, await AuditCountAsync(attempt, "assessment_provider_attempt_cancelled"));
        Assert.Equal($"{actor}|launched|true", await fixture.ScalarAsync(
            $"SELECT actor_id::text || '|' || (metadata->>'from') || '|' || (metadata->>'cancelledAtProvider') FROM audit_logs WHERE entity_id = '{attempt}' AND action = 'assessment_provider_attempt_cancelled'"));
    }

    [Fact]
    public async Task A_cancel_waiting_on_a_webhook_that_finished_the_sitting_leaves_it_finished()
    {
        var (attempt, _) = await InsertAttemptAsync("in_progress");
        var (connection, transaction) = await HoldAttemptAsync(
            attempt, $"UPDATE assessment_provider_attempts SET state = 'completed' WHERE id = '{attempt}';");
        await using (connection)
        {
            await using var db = fixture.NewContext();
            var mapping = (Guid)(await fixture.ScalarAsync($"SELECT provider_assignment_id FROM assessment_provider_attempts WHERE id = '{attempt}'"))!;
            var cancel = new AssessmentProviderRepository(db).MarkCancelledAsync(
                AssessmentProviderSchemaFixture.OrgA, attempt, mapping, Guid.NewGuid(), cancelledAtProvider: false, DateTimeOffset.UtcNow,
                CancellationToken.None);
            await Task.Delay(300);
            await transaction.CommitAsync();

            Assert.Equal("completed", await cancel);
        }

        Assert.Equal("completed", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        Assert.Equal(0L, await AuditCountAsync(attempt, "assessment_provider_attempt_cancelled"));
    }

    [Fact]
    public async Task A_local_cancel_never_lands_over_a_provider_assignment_the_caller_did_not_cancel()
    {
        // The caller read the attempt while it was pending_create (no provider assignment); it has been mapped since.
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        var attempt = await ReservePendingAsync(repository);
        await repository.MarkCreatedAsync(AssessmentProviderSchemaFixture.OrgA, attempt, AssignmentFor(attempt, Guid.NewGuid()),
            DateTimeOffset.UtcNow, CancellationToken.None);

        var state = await repository.MarkCancelledAsync(AssessmentProviderSchemaFixture.OrgA, attempt, expectedProviderAssignmentId: null,
            Guid.NewGuid(), cancelledAtProvider: false, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal("created", state);
        Assert.Equal(0L, await AuditCountAsync(attempt, "assessment_provider_attempt_cancelled"));
    }

    [Fact]
    public async Task A_corrected_revision_for_a_voided_attempt_already_reassigned_is_kept_without_reopening_it()
    {
        // void -> HR re-assigns the instrument -> the provider's review overturns the void (a newer, valid revision).
        var (voided, subject) = await InsertAttemptAsync("voided");
        var row = await RowAsync(voided);
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, assigned_by_id)
             VALUES (gen_random_uuid(), '{AssessmentProviderSchemaFixture.OrgA}', '{AssessmentProviderSchemaFixture.BindingA}',
                 '{row.CandidateId}', '{AssessmentProviderSchemaFixture.VacancyA}', 'lia', 'pending_create', 'selection',
                 'Análisis de datos', 'es', 1, gen_random_uuid())
             """);
        var corrected = ResultFor(row.ProviderAssignmentId!.Value) with { SubjectId = subject, ResultRevision = 2 };

        await using var db = fixture.NewContext();
        var stored = await new AssessmentProviderRepository(db).StoreResultAsync(
            AssessmentProviderSchemaFixture.OrgA, row, corrected, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.True(stored);
        Assert.Equal("voided", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{voided}'"));
        Assert.Equal(2, await fixture.ScalarAsync(
            $"SELECT result_revision FROM assessment_provider_results WHERE attempt_id = '{voided}'"));
        Assert.Equal("true", await fixture.ScalarAsync(
            $"SELECT metadata->>'supersededByReassignment' FROM audit_logs WHERE entity_id = '{voided}' AND action = 'assessment_provider_result_received'"));
    }

    [Theory]
    [InlineData("expired")] // the replacement expired: still newer, still supersedes
    [InlineData("voided")]
    public async Task A_corrected_revision_never_reopens_an_attempt_a_newer_replacement_superseded(string replacementState)
    {
        var (voided, subject) = await InsertAttemptAsync("voided");
        var row = await RowAsync(voided);
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 assigned_by_id, created_at)
             VALUES (gen_random_uuid(), '{AssessmentProviderSchemaFixture.OrgA}', '{AssessmentProviderSchemaFixture.BindingA}',
                 '{row.CandidateId}', '{AssessmentProviderSchemaFixture.VacancyA}', 'lia', '{replacementState}', 'selection',
                 'Análisis de datos', 'es', 1, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now() + interval '1 minute')
             """);
        var corrected = ResultFor(row.ProviderAssignmentId!.Value) with { SubjectId = subject, ResultRevision = 2 };

        await using var db = fixture.NewContext();
        Assert.True(await new AssessmentProviderRepository(db).StoreResultAsync(
            AssessmentProviderSchemaFixture.OrgA, row, corrected, DateTimeOffset.UtcNow, CancellationToken.None));

        Assert.Equal("voided", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{voided}'"));
    }

    [Fact]
    public async Task A_result_fetched_before_a_hide_committed_is_never_stored_and_a_fresh_read_stores_again()
    {
        // Codex r12 P1: worker A reads the attempt and fetches visible scores; worker B's result_not_visible commits a
        // hide; A then stores. The hide bumped the generation A read, so A's scores are refused.
        var (attempt, subject) = await InsertAttemptAsync("completed");
        var before = await RowAsync(attempt);
        var fetched = ResultFor(before.ProviderAssignmentId!.Value) with { SubjectId = subject };

        await using (var hide = fixture.NewContext())
        {
            await new AssessmentProviderRepository(hide).HideResultAsync(
                AssessmentProviderSchemaFixture.OrgA, before, fetched.ResultId, DateTimeOffset.UtcNow, CancellationToken.None);
        }

        await using (var stale = fixture.NewContext())
        {
            Assert.False(await new AssessmentProviderRepository(stale).StoreResultAsync(
                AssessmentProviderSchemaFixture.OrgA, before, fetched, DateTimeOffset.UtcNow, CancellationToken.None));
        }

        Assert.Equal(0L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));

        // Made visible again: a fetch that starts from a fresh read stores it.
        var after = await RowAsync(attempt);
        Assert.Equal(before.ResultVisibilityGeneration + 1, after.ResultVisibilityGeneration);
        await using (var fresh = fixture.NewContext())
        {
            Assert.True(await new AssessmentProviderRepository(fresh).StoreResultAsync(
                AssessmentProviderSchemaFixture.OrgA, after, fetched, DateTimeOffset.UtcNow, CancellationToken.None));
        }

        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
    }

    [Fact]
    public async Task A_corrected_revision_restores_the_attempt_when_the_only_newer_one_was_cancelled()
    {
        var (voided, subject) = await InsertAttemptAsync("voided");
        var row = await RowAsync(voided);
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, assigned_by_id, created_at)
             VALUES (gen_random_uuid(), '{AssessmentProviderSchemaFixture.OrgA}', '{AssessmentProviderSchemaFixture.BindingA}',
                 '{row.CandidateId}', '{AssessmentProviderSchemaFixture.VacancyA}', 'lia', 'cancelled', 'selection',
                 'Análisis de datos', 'es', 1, gen_random_uuid(), now() + interval '1 minute')
             """);
        var corrected = ResultFor(row.ProviderAssignmentId!.Value) with { SubjectId = subject, ResultRevision = 2 };

        await using var db = fixture.NewContext();
        Assert.True(await new AssessmentProviderRepository(db).StoreResultAsync(
            AssessmentProviderSchemaFixture.OrgA, row, corrected, DateTimeOffset.UtcNow, CancellationToken.None));

        Assert.Equal("result_ready", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{voided}'"));
    }

    [Fact]
    public async Task A_create_answered_after_a_staff_cancel_is_recorded_as_an_orphan_until_the_provider_confirms()
    {
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        var attempt = await ReservePendingAsync(repository);
        Assert.Equal("cancelled", await repository.MarkCancelledAsync(AssessmentProviderSchemaFixture.OrgA, attempt, null, Guid.NewGuid(),
            cancelledAtProvider: false, DateTimeOffset.UtcNow, CancellationToken.None));
        var assignment = AssignmentFor(attempt, Guid.NewGuid());

        Assert.Equal("cancelled", await repository.MarkCreatedAsync(AssessmentProviderSchemaFixture.OrgA, attempt, assignment,
            DateTimeOffset.UtcNow, CancellationToken.None));
        Assert.Equal($"cancelled|{assignment.AssignmentId}|provider_cancel_pending", await fixture.ScalarAsync(
            $"SELECT state || '|' || provider_assignment_id || '|' || last_error_code FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        Assert.Equal(1L, await AuditCountAsync(attempt, "assessment_provider_orphan_recorded"));

        await repository.MarkProviderCancelledAsync(AssessmentProviderSchemaFixture.OrgA, attempt, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Null(await fixture.ScalarAsync($"SELECT last_error_code FROM assessment_provider_attempts WHERE id = '{attempt}'") as string);
        Assert.Equal(1L, await AuditCountAsync(attempt, "assessment_provider_orphan_cancelled"));
    }

    [Fact]
    public async Task A_corrected_revision_for_a_voided_attempt_nobody_replaced_restores_it()
    {
        var (voided, subject) = await InsertAttemptAsync("voided");
        var row = await RowAsync(voided);
        var corrected = ResultFor(row.ProviderAssignmentId!.Value) with { SubjectId = subject, ResultRevision = 2 };

        await using var db = fixture.NewContext();
        Assert.True(await new AssessmentProviderRepository(db).StoreResultAsync(
            AssessmentProviderSchemaFixture.OrgA, row, corrected, DateTimeOffset.UtcNow, CancellationToken.None));

        Assert.Equal("result_ready", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{voided}'"));
    }

    [Fact]
    public async Task A_late_session_voided_never_undoes_a_corrected_revision_delivered_first()
    {
        // Reverse delivery: the provider voided the sitting, then its review re-published a valid revision. The
        // corrected revision arrives first and restores the attempt; the earlier session.voided arrives after it.
        var (voided, subject) = await InsertAttemptAsync("voided");
        var row = await RowAsync(voided);
        var corrected = ResultFor(row.ProviderAssignmentId!.Value) with { SubjectId = subject, ResultRevision = 2 };
        await using (var db = fixture.NewContext())
        {
            Assert.True(await new AssessmentProviderRepository(db).StoreResultAsync(
                AssessmentProviderSchemaFixture.OrgA, row, corrected, DateTimeOffset.UtcNow, CancellationToken.None));
        }

        await using (var db = fixture.NewContext())
        {
            Assert.False(await new AssessmentProviderRepository(db).AdvanceAttemptAsync(AssessmentProviderSchemaFixture.OrgA,
                voided, ProviderAttemptStates.Voided, DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow,
                CancellationToken.None));
        }

        Assert.Equal("result_ready", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{voided}'"));
    }

    [Fact]
    public async Task A_late_session_voided_never_lands_on_any_attempt_that_holds_a_stored_result()
    {
        // A superseded attempt keeps its terminal state with the corrected result attached (here: expired, replaced by a
        // newer assignment). The domain rule alone would let a void move expired -> voided; the stored result forbids it.
        var (expired, subject) = await InsertAttemptAsync("expired");
        var row = await RowAsync(expired);
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, assigned_by_id, created_at)
             VALUES (gen_random_uuid(), '{AssessmentProviderSchemaFixture.OrgA}', '{AssessmentProviderSchemaFixture.BindingA}',
                 '{row.CandidateId}', '{AssessmentProviderSchemaFixture.VacancyA}', 'lia', 'pending_create', 'selection',
                 'Análisis de datos', 'es', 1, gen_random_uuid(), now() + interval '1 minute')
             """);
        var result = ResultFor(row.ProviderAssignmentId!.Value) with { SubjectId = subject };
        await using (var db = fixture.NewContext())
        {
            Assert.True(await new AssessmentProviderRepository(db).StoreResultAsync(
                AssessmentProviderSchemaFixture.OrgA, row, result, DateTimeOffset.UtcNow, CancellationToken.None));
        }

        Assert.Equal("expired", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{expired}'"));

        await using (var db = fixture.NewContext())
        {
            Assert.False(await new AssessmentProviderRepository(db).AdvanceAttemptAsync(AssessmentProviderSchemaFixture.OrgA,
                expired, ProviderAttemptStates.Voided, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, CancellationToken.None));
        }

        Assert.Equal("expired", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{expired}'"));
    }

    [Fact]
    public async Task A_session_voided_still_voids_an_attempt_with_no_result_yet()
    {
        var (inProgress, _) = await InsertAttemptAsync("in_progress");

        await using (var db = fixture.NewContext())
        {
            Assert.True(await new AssessmentProviderRepository(db).AdvanceAttemptAsync(AssessmentProviderSchemaFixture.OrgA,
                inProgress, ProviderAttemptStates.Voided, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, CancellationToken.None));
        }

        Assert.Equal("voided", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{inProgress}'"));
    }

    // ---- Lock discipline: webhook writes, launches and erasures of one attempt are serialized --------------------

    private async Task<(Guid Attempt, Guid Subject)> InsertAttemptAsync(string state)
    {
        // A fresh candidate per attempt: the open-attempt unique index allows one open lia attempt per candidate and
        // vacancy, and the collection's tests share one database.
        var attempt = Guid.NewGuid();
        var subject = Guid.NewGuid();
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 instrument_version, content_version, assigned_by_id)
             VALUES ('{attempt}', '{AssessmentProviderSchemaFixture.OrgA}', '{AssessmentProviderSchemaFixture.BindingA}',
                 '{candidate}', '{AssessmentProviderSchemaFixture.VacancyA}', 'lia', '{state}',
                 'selection', 'Análisis de datos', 'es', 1, '{subject}', gen_random_uuid(), '1.0', 'content-1', gen_random_uuid())
             """);
        return (attempt, subject);
    }

    private static ParsedProviderResult ResultFor(Guid attemptAssignment) => new(
        Guid.NewGuid(), "LiaResultV1", "lia", "1.0", AssessmentProviderSchemaFixture.TenantA, Guid.NewGuid(), attemptAssignment,
        "selection", AssessmentProviderSchemaFixture.VacancyA.ToString(), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, 1,
        "valid", [], "content-1", new string('c', 64), "norms-1", "scoring-1", "deterministic", 1m, "tenant_hr", "full",
        "complete", 50, null, null, false, "{}");

    private async Task<AttemptRow> RowAsync(Guid attempt)
    {
        await using var db = fixture.NewContext();
        return (await new AssessmentProviderRepository(db).FindAttemptAsync(
            AssessmentProviderSchemaFixture.OrgA, attempt, CancellationToken.None))!;
    }

    // Holds the attempt's advisory lock (the key LockAttemptAsync uses) and applies a change without committing it,
    // the shape of a concurrent writer that is mid-transaction.
    private async Task<(NpgsqlConnection Connection, NpgsqlTransaction Transaction)> HoldAttemptAsync(Guid attempt, string change)
    {
        var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        var transaction = await connection.BeginTransactionAsync();
        await using var command = new NpgsqlCommand(
            $"SELECT pg_advisory_xact_lock(hashtextextended('assessment-provider-attempt:' || '{attempt}', 0)); {change}",
            connection, transaction);
        await command.ExecuteNonQueryAsync();
        return (connection, transaction);
    }

    [Fact]
    public async Task A_result_fetched_before_an_erasure_is_not_stored_after_it()
    {
        var (attempt, subject) = await InsertAttemptAsync("completed");
        var row = await RowAsync(attempt);
        await using (var eraseDb = fixture.NewContext())
        {
            Assert.Equal(1, await new AssessmentProviderRepository(eraseDb).EraseSubjectAsync(
                AssessmentProviderSchemaFixture.OrgA, subject, DateTimeOffset.UtcNow, CancellationToken.None));
        }

        await using var db = fixture.NewContext();
        var stored = await new AssessmentProviderRepository(db).StoreResultAsync(
            AssessmentProviderSchemaFixture.OrgA, row, ResultFor(row.ProviderAssignmentId!.Value), DateTimeOffset.UtcNow,
            CancellationToken.None);

        Assert.False(stored);
        Assert.Equal(0L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
        Assert.Equal("erased", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
    }

    [Fact]
    public async Task A_result_write_waiting_on_a_concurrent_erasure_stores_nothing()
    {
        var (attempt, _) = await InsertAttemptAsync("completed");
        var row = await RowAsync(attempt);
        var (connection, transaction) = await HoldAttemptAsync(
            attempt, $"UPDATE assessment_provider_attempts SET state = 'erased' WHERE id = '{attempt}';");
        await using (connection)
        {
            await using var db = fixture.NewContext();
            var store = new AssessmentProviderRepository(db).StoreResultAsync(
                AssessmentProviderSchemaFixture.OrgA, row, ResultFor(row.ProviderAssignmentId!.Value), DateTimeOffset.UtcNow,
                CancellationToken.None);
            await Task.Delay(300);
            await transaction.CommitAsync();

            Assert.False(await store);
        }

        Assert.Equal(0L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
        Assert.Equal("erased", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
    }

    [Fact]
    public async Task A_launch_waiting_on_a_concurrent_webhook_never_rewinds_its_state()
    {
        var (attempt, _) = await InsertAttemptAsync("created");
        var (connection, transaction) = await HoldAttemptAsync(
            attempt, $"UPDATE assessment_provider_attempts SET state = 'completed' WHERE id = '{attempt}';");
        await using (connection)
        {
            await using var db = fixture.NewContext();
            var called = false;
            var launch = new AssessmentProviderRepository(db).LaunchUnderCandidateLockAsync(
                AssessmentProviderSchemaFixture.OrgA, attempt,
                (_, _) =>
                {
                    called = true;
                    return Task.FromResult(ProviderCall<ProviderLaunch>.Success(
                        new ProviderLaunch("native", DateTimeOffset.UtcNow.AddMinutes(5), "https://player.test/l/1", [])));
                },
                DateTimeOffset.UtcNow, CancellationToken.None);
            await Task.Delay(300);
            await transaction.CommitAsync();
            var outcome = await launch;

            // The fresh read under the attempt lock sees the finished sitting: nothing is launched, nothing rewound.
            Assert.Equal(LockedLaunchOutcome.NotLaunchable, outcome.Outcome);
            Assert.False(called);
        }

        Assert.Equal("completed", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
    }

    private static ProviderAssignment AssignmentFor(Guid attempt, Guid subject) => new(
        Guid.NewGuid(), AssessmentProviderSchemaFixture.TenantA, subject, "lia", "1.0", "content-1", "created", ["assessment"],
        ["assessment"], DateTimeOffset.UtcNow.AddDays(14), attempt.ToString());

    private Task InsertErasureTombstoneAsync(Guid subject, bool upperCase = false)
    {
        var id = upperCase ? subject.ToString().ToUpperInvariant() : subject.ToString();
        var data = "{\"subject_id\":\"" + id + "\"}";
        return fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_webhook_inbox (id, organization_id, event_id, event_type, event_version,
                 provider_tenant_id, occurred_at, status, data)
             VALUES (gen_random_uuid(), '{AssessmentProviderSchemaFixture.OrgA}', gen_random_uuid(), 'subject.erased', 1,
                 '{AssessmentProviderSchemaFixture.TenantA}', now(), 'processed', '{data}')
             """);
    }

    private async Task<Guid> ReservePendingAsync(AssessmentProviderRepository repository)
    {
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES ('{candidate}', '{AssessmentProviderSchemaFixture.OrgA}', 'Pe', 'Nding', '{candidate}@a.example')");
        var binding = new ProviderBindingRow(AssessmentProviderSchemaFixture.BindingA, AssessmentProviderSchemaFixture.OrgA,
            AssessmentProviderSchemaFixture.TenantA, ["lia"], "es");
        var reserved = await repository.ReserveAttemptsAsync(AssessmentProviderSchemaFixture.OrgA, Guid.NewGuid(), binding,
            candidate, AssessmentProviderSchemaFixture.VacancyA, [new NewAttempt("lia", "Análisis de datos", "es", 1m, [], null)],
            DateTimeOffset.UtcNow, CancellationToken.None);
        return Assert.Single(reserved.Attempts).Id;
    }

    [Fact]
    public async Task MarkCreated_on_the_context_that_reserved_never_overwrites_a_committed_transition()
    {
        // ONE context for reserve and mark-created, as in a real request: the reserve leaves the attempt tracked.
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        var attempt = await ReservePendingAsync(repository);
        var subject = Guid.NewGuid();
        // Meanwhile a webhook reconciled the attempt and advanced it (committed by another connection).
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET state = 'in_progress', provider_subject_id = '{subject}', provider_assignment_id = gen_random_uuid() WHERE id = '{attempt}'");

        var state = await repository.MarkCreatedAsync(AssessmentProviderSchemaFixture.OrgA, attempt, AssignmentFor(attempt, subject),
            DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal("in_progress", state);
        Assert.Equal("in_progress", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
    }

    private Task<object?> AuditCountAsync(Guid attempt, string action) => fixture.ScalarAsync(
        $"SELECT count(*) FROM audit_logs WHERE entity = 'assessment_provider_attempt' AND entity_id = '{attempt}' AND action = '{action}'");

    [Fact]
    public async Task Mapping_a_pending_attempt_writes_its_created_audit_row()
    {
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        var attempt = await ReservePendingAsync(repository);
        var assignment = AssignmentFor(attempt, Guid.NewGuid());

        Assert.Equal("created", await repository.MarkCreatedAsync(AssessmentProviderSchemaFixture.OrgA, attempt, assignment,
            DateTimeOffset.UtcNow, CancellationToken.None));

        Assert.Equal(1L, await AuditCountAsync(attempt, "assessment_provider_attempt_created"));
        Assert.Equal("1.0|content-1|created", await fixture.ScalarAsync(
            $"SELECT metadata->>'instrumentVersion' || '|' || (metadata->>'contentVersion') || '|' || (metadata->>'to') FROM audit_logs WHERE entity_id = '{attempt}' AND action = 'assessment_provider_attempt_created'"));
    }

    [Fact]
    public async Task A_failed_create_is_audited_whether_it_stays_pending_or_is_refused()
    {
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        var pending = await ReservePendingAsync(repository);
        var refused = await ReservePendingAsync(repository);

        await repository.MarkCreateFailedAsync(AssessmentProviderSchemaFixture.OrgA, pending, "idempotency_key_in_use", cancel: false,
            DateTimeOffset.UtcNow, CancellationToken.None);
        await repository.MarkCreateFailedAsync(AssessmentProviderSchemaFixture.OrgA, refused, "validation_failed", cancel: true,
            DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal("pending_create", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{pending}'"));
        Assert.Equal(1L, await AuditCountAsync(pending, "assessment_provider_create_failed"));
        Assert.Equal("cancelled", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{refused}'"));
        Assert.Equal(1L, await AuditCountAsync(refused, "assessment_provider_assignment_refused"));
    }

    [Fact]
    public async Task A_mapping_that_commits_after_its_subject_was_erased_leaves_the_attempt_erased()
    {
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        var attempt = await ReservePendingAsync(repository);
        var subject = Guid.NewGuid();
        await InsertErasureTombstoneAsync(subject); // subject.erased recorded before the mapping committed

        var state = await repository.MarkCreatedAsync(AssessmentProviderSchemaFixture.OrgA, attempt, AssignmentFor(attempt, subject),
            DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal("erased", state);
        Assert.Equal("erased", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
    }

    [Fact]
    public async Task An_upper_case_subject_id_in_the_tombstone_still_erases_a_late_mapping()
    {
        // The contract's Uuid is format: uuid, any case; the inbox stores the payload verbatim.
        await using var db = fixture.NewContext();
        var repository = new AssessmentProviderRepository(db);
        var attempt = await ReservePendingAsync(repository);
        var subject = Guid.NewGuid();
        await InsertErasureTombstoneAsync(subject, upperCase: true);

        var state = await repository.MarkCreatedAsync(AssessmentProviderSchemaFixture.OrgA, attempt, AssignmentFor(attempt, subject),
            DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal("erased", state);
    }

    [Fact]
    public async Task A_result_for_a_tombstoned_subject_is_never_stored()
    {
        var (attempt, subject) = await InsertAttemptAsync("completed");
        var row = await RowAsync(attempt);
        await InsertErasureTombstoneAsync(subject);
        var result = ResultFor(row.ProviderAssignmentId!.Value) with { SubjectId = subject };

        await using var db = fixture.NewContext();
        Assert.False(await new AssessmentProviderRepository(db).StoreResultAsync(
            AssessmentProviderSchemaFixture.OrgA, row, result, DateTimeOffset.UtcNow, CancellationToken.None));
        Assert.Equal(0L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
    }
}
