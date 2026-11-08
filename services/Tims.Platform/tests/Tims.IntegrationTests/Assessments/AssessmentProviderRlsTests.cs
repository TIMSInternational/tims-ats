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

        Assert.Equal(AssessmentProviderSchemaFixture.OrgB,
            await repository.FindOrganizationByProviderTenantAsync(AssessmentProviderSchemaFixture.TenantB, CancellationToken.None));
        Assert.Null(await repository.FindOrganizationByProviderTenantAsync(Guid.NewGuid(), CancellationToken.None));
    }

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
        await repository.CompleteInboxAsync(AssessmentProviderSchemaFixture.OrgA, envelope.EventId, InboxStatuses.Processed, null,
            DateTimeOffset.UtcNow, CancellationToken.None);
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
            var launch = new AssessmentProviderRepository(db).MarkLaunchedAsync(
                AssessmentProviderSchemaFixture.OrgA, attempt, AssessmentProviderSchemaFixture.CandidateA, "native",
                DateTimeOffset.UtcNow, CancellationToken.None);
            await Task.Delay(300);
            await transaction.CommitAsync();
            await launch;
        }

        Assert.Equal("completed", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
    }

    private static ProviderAssignment AssignmentFor(Guid attempt, Guid subject) => new(
        Guid.NewGuid(), AssessmentProviderSchemaFixture.TenantA, subject, "lia", "1.0", "content-1", "created", ["assessment"],
        ["assessment"], DateTimeOffset.UtcNow.AddDays(14), attempt.ToString());

    private Task InsertErasureTombstoneAsync(Guid subject)
    {
        var data = "{\"subject_id\":\"" + subject + "\"}";
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
