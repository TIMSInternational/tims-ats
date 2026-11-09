using Tims.Application.Assessments.Providers;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// Round-12 fixes against the real migration and RLS: one create fence PER CREATE (Codex round 11 P1: two overlapping
/// creates of one attempt shared one fence, so the first answer lifted it while the second was still in flight), and a
/// <c>result_not_visible</c> answer deleting the stored copy (Codex round 11 P1). Each test owns its organization.
/// </summary>
[Collection("AssessmentProviderRls")]
public sealed class AssessmentProviderRound12Tests(AssessmentProviderSchemaFixture fixture)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;

    private async Task<Guid> OrgAsync()
    {
        var org = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO organizations (id, name, slug) VALUES ('{org}', 'R12', 'r12-{org:N}');
             INSERT INTO assessment_provider_bindings (id, organization_id, provider, provider_tenant_id, enabled_instruments, default_locale)
             VALUES ('{org}', '{org}', 'tims-assessments', gen_random_uuid(), ARRAY['lia','english'], 'es');
             """);
        return org;
    }

    private async Task<Guid> CandidateAsync(Guid org)
    {
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES ('{candidate}', '{org}', 'Ana', 'R12', 'r12-{candidate:N}@example.test')");
        return candidate;
    }

    private async Task<Guid> PendingAttemptAsync(Guid org, Guid candidate)
    {
        var attempt = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, assigned_by_id, age_band)
             VALUES ('{attempt}', '{org}', '{org}', '{candidate}', gen_random_uuid(), 'lia', 'pending_create',
                 'selection', 'Análisis de datos', 'es', 1, gen_random_uuid(), '18_plus')
             """);
        return attempt;
    }

    private async Task<T> WithRepository<T>(Func<AssessmentProviderRepository, Task<T>> work)
    {
        await using var db = fixture.NewContext();
        return await work(new AssessmentProviderRepository(db));
    }

    private Task End(Guid org, Guid attempt, DateTimeOffset fence, ProviderAssignment? assignment) =>
        WithRepository(async r =>
        {
            await r.EndCreateAsync(org, attempt, fence, assignment, CancellationToken.None);
            return 0;
        });

    private Task<object?> Fences(Guid attempt) =>
        fixture.ScalarAsync($"SELECT cardinality(create_fences) FROM assessment_provider_attempts WHERE id = '{attempt}'");

    private static ProviderAssignment Assignment(Guid attempt, Guid subject) =>
        new(Guid.NewGuid(), Guid.NewGuid(), subject, "lia", "1.0", "content-1", "created", ["assessment"], [], Now.AddDays(7),
            attempt.ToString());

    // ── 1. One fence per create ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Two_overlapping_creates_each_keep_the_attempt_fenced_until_their_own_answer()
    {
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var attempt = await PendingAttemptAsync(org, candidate);

        // A double submit: two creates of the same pending attempt are in flight at once, each with its own token.
        var first = (await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)))!.Value;
        var second = (await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)))!.Value;
        Assert.NotEqual(first, second);
        Assert.Equal(2, await Fences(attempt));

        // The first create's answer is recorded and ends ITS fence only.
        var assignment = Assignment(attempt, Guid.NewGuid());
        await WithRepository(r => r.MarkCreatedAsync(org, attempt, assignment, Now, CancellationToken.None));
        await End(org, attempt, first, assignment);
        Assert.Equal(1, await Fences(attempt));

        // The second is still in flight: an erasure must not report done, and a withdrawal cannot complete.
        var facts = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.True(facts!.CreatesInFlight);
        Assert.True(facts.NeedsResolution);
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET state = 'cancelled', withdrawal_state = 'pending' WHERE id = '{attempt}'");
        var fence = Assert.Single(await WithRepository(r => r.ReadWithdrawalFencesAsync(org, [attempt], CancellationToken.None)));
        Assert.True(fence.CreateInFlight);
        Assert.False(fence.CreateStale);
        Assert.Equal(0, await WithRepository(r => r.MarkWithdrawalDoneAsync(org, [fence], Now, CancellationToken.None)));

        // Its own answer lifts the last fence.
        await End(org, attempt, second, assignment);
        Assert.Equal(0, await Fences(attempt));
        var answered = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.False(answered!.CreatesInFlight);
        var after = Assert.Single(await WithRepository(r => r.ReadWithdrawalFencesAsync(org, [attempt], CancellationToken.None)));
        Assert.False(after.CreateInFlight);
        Assert.Equal(1, await WithRepository(r => r.MarkWithdrawalDoneAsync(org, [after], Now, CancellationToken.None)));
    }

    [Fact]
    public async Task A_create_whose_answer_the_attempt_does_not_record_keeps_its_fence()
    {
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var attempt = await PendingAttemptAsync(org, candidate);
        var fence = (await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)))!.Value;
        var recorded = Assignment(attempt, Guid.NewGuid());
        await WithRepository(r => r.MarkCreatedAsync(org, attempt, recorded, Now, CancellationToken.None));

        // An answer naming another subject (a create that made a NEW provider subject, e.g. after an erasure): kept.
        await End(org, attempt, fence, Assignment(attempt, Guid.NewGuid()));
        Assert.Equal(1, await Fences(attempt));

        // A definitive refusal on an attempt an erasure reached: kept as well (its subject may exist untracked).
        await fixture.ExecuteAsync($"UPDATE assessment_provider_attempts SET state = 'erased' WHERE id = '{attempt}'");
        await End(org, attempt, fence, null);
        Assert.Equal(1, await Fences(attempt));

        // Another token than this create's never removes it.
        await fixture.ExecuteAsync($"UPDATE assessment_provider_attempts SET state = 'pending_create' WHERE id = '{attempt}'");
        await End(org, attempt, fence.AddMilliseconds(1), null);
        Assert.Equal(1, await Fences(attempt));

        // A definitive refusal with no erasure ends it.
        await End(org, attempt, fence, null);
        Assert.Equal(0, await Fences(attempt));
    }

    [Fact]
    public async Task A_new_create_prunes_stale_fences_and_a_refused_one_writes_nothing()
    {
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var attempt = await PendingAttemptAsync(org, candidate);
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET create_fences = ARRAY[now() - interval '11 minutes', now() - interval '20 minutes'] WHERE id = '{attempt}'");

        var fence = await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None));
        Assert.NotNull(fence);
        Assert.Equal(1, await Fences(attempt));
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT create_fences[1] > now() - interval '1 minute' FROM assessment_provider_attempts WHERE id = '{attempt}'"));

        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET provider_erasure_requested_at = now() WHERE id = '{attempt}'");
        Assert.Null(await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)));
        Assert.Equal(1, await Fences(attempt));
    }

    // ── 2. A result that is no longer visible ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_result_no_longer_visible_deletes_the_stored_copy_and_clears_the_latest_result()
    {
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var (attempt, subject, result, other) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 latest_result_id, assigned_by_id, age_band)
             VALUES ('{attempt}', '{org}', '{org}', '{candidate}', gen_random_uuid(), 'lia', 'result_ready',
                 'selection', 'Análisis de datos', 'es', 1, '{subject}', gen_random_uuid(), '{result}', gen_random_uuid(), '18_plus');
             INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
                 result_schema, instrument, instrument_version, content_version, content_sha256, norm_version, scoring_version,
                 scoring_method, purpose, validity_status, completion, global_percentile, time_multiplier_applied,
                 rendered_for, rendered_level, completed_at, scored_at)
             VALUES (gen_random_uuid(), '{org}', '{attempt}', '{result}', 2, 'LiaResultV1', 'lia', '1.0', 'content-1', repeat('a', 64),
                     'norms-1', 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', 46.2, 1, 'tenant_hr', 'full',
                     now(), now()),
                    (gen_random_uuid(), '{org}', '{attempt}', '{other}', 1, 'LiaResultV1', 'lia', '1.0', 'content-1', repeat('b', 64),
                     'norms-1', 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', 12, 1, 'tenant_hr', 'full',
                     now(), now());
             """);
        var row = await WithRepository(r => r.FindAttemptAsync(org, attempt, CancellationToken.None));

        var removed = await WithRepository(r => r.HideResultAsync(org, row!, result, Now, CancellationToken.None));

        Assert.Equal(1, removed);
        Assert.Equal(0L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_results WHERE provider_result_id = '{result}'"));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_results WHERE provider_result_id = '{other}'")); // only the one named
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT latest_result_id IS NULL AND state = 'result_ready' FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE entity_id = '{attempt}' AND action = 'assessment_provider_result_hidden'"));

        // Repeated (a redelivery): nothing left to remove, no second audit row.
        Assert.Equal(0, await WithRepository(r => r.HideResultAsync(org, row!, result, Now, CancellationToken.None)));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE entity_id = '{attempt}' AND action = 'assessment_provider_result_hidden'"));
    }

    [Fact]
    public async Task A_result_no_longer_visible_on_a_completed_sitting_moves_it_to_result_ready()
    {
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var attempt = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 assigned_by_id, age_band)
             VALUES ('{attempt}', '{org}', '{org}', '{candidate}', gen_random_uuid(), 'lia', 'completed',
                 'selection', 'Análisis de datos', 'es', 1, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '18_plus');
             """);
        var row = await WithRepository(r => r.FindAttemptAsync(org, attempt, CancellationToken.None));

        Assert.Equal(0, await WithRepository(r => r.HideResultAsync(org, row!, Guid.NewGuid(), Now, CancellationToken.None)));

        Assert.Equal("result_ready", await fixture.ScalarAsync(
            $"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
    }
}
