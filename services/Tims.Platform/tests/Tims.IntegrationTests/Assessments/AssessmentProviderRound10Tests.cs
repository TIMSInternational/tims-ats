using System.Text.Json;
using Npgsql;
using Tims.Application.Assessments.Providers;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// Round-10 fixes against the real migration and RLS: the webhook inbox as a leased work queue, the #312 cascade's
/// lease, the create fence, the sibling-aware candidate lock, the optional-consent decisions and the DSAR terminal-erasure
/// facts. Each test owns its organization.
/// </summary>
[Collection("AssessmentProviderRls")]
public sealed class AssessmentProviderRound10Tests(AssessmentProviderSchemaFixture fixture)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;

    private async Task<Guid> OrgAsync()
    {
        var org = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO organizations (id, name, slug) VALUES ('{org}', 'R10', 'r10-{org:N}');
             INSERT INTO assessment_provider_bindings (id, organization_id, provider, provider_tenant_id, enabled_instruments, default_locale)
             VALUES ('{org}', '{org}', 'tims-assessments', gen_random_uuid(), ARRAY['lia','english'], 'es');
             """);
        return org;
    }

    private async Task<Guid> AttemptAsync(
        Guid org, string state = "created", Guid? candidate = null, string instrument = "lia", string extra = "",
        string extraValues = "", bool mapped = true)
    {
        var attempt = Guid.NewGuid();
        var ids = mapped ? "gen_random_uuid(), gen_random_uuid()" : "NULL, NULL";
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 assigned_by_id, age_band{extra})
             VALUES ('{attempt}', '{org}', '{org}', '{candidate ?? Guid.NewGuid()}', gen_random_uuid(), '{instrument}', '{state}',
                 'selection', 'Análisis de datos', 'es', 1, {ids}, gen_random_uuid(), '18_plus'{extraValues})
             """);
        return attempt;
    }

    private static ProviderEventEnvelope Event(Guid org) =>
        new(Guid.NewGuid(), "assignment.started", Now, Guid.NewGuid(), JsonSerializer.Serialize(new { assignment_id = org }));

    private async Task<T> WithRepository<T>(Func<AssessmentProviderRepository, Task<T>> work)
    {
        await using var db = fixture.NewContext();
        return await work(new AssessmentProviderRepository(db));
    }

    // ── 1. The webhook inbox as a leased work queue ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_recorded_event_is_due_at_once_and_only_one_worker_claims_it()
    {
        var org = await OrgAsync();
        var envelope = Event(org);
        Assert.Equal(InboxOutcome.New, await WithRepository(r => r.RecordInboxAsync(org, envelope, 1, Now, CancellationToken.None)));
        Assert.Contains(org, await WithRepository(r => r.ListOrganizationsWithDueInboxEventsAsync(1000, CancellationToken.None)));

        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        var claims = await Task.WhenAll(
            WithRepository(r => r.ClaimInboxEventAsync(org, a, CancellationToken.None)),
            WithRepository(r => r.ClaimInboxEventAsync(org, b, CancellationToken.None)));

        var winner = Assert.Single(claims, c => c is not null)!;
        Assert.Equal(envelope.EventId, winner.Envelope.EventId);
        Assert.Equal(envelope.DataJson, JsonSerializer.Serialize(JsonDocument.Parse(winner.Envelope.DataJson).RootElement));
        Assert.Equal(0, winner.ProcessingAttempts);
        Assert.DoesNotContain(org, await WithRepository(r => r.ListOrganizationsWithDueInboxEventsAsync(1000, CancellationToken.None)));
    }

    [Fact]
    public async Task A_rescheduled_event_waits_a_redelivery_rearms_it_and_a_final_one_is_a_duplicate()
    {
        var org = await OrgAsync();
        var envelope = Event(org);
        var owner = Guid.NewGuid();
        await WithRepository(r => r.RecordInboxAsync(org, envelope, 1, Now, CancellationToken.None));
        await WithRepository(r => r.ClaimInboxEventAsync(org, owner, CancellationToken.None));

        // A late completion by a worker that does not hold the lease records nothing.
        await WithRepository(async r =>
        {
            await r.CompleteInboxAsync(org, envelope.EventId, Guid.NewGuid(), InboxStatuses.Processed, null, null, Now, CancellationToken.None);
            return 0;
        });
        Assert.Equal("received|0", await RowAsync(envelope.EventId));

        await WithRepository(async r =>
        {
            await r.CompleteInboxAsync(org, envelope.EventId, owner, InboxStatuses.Failed, "provider_unavailable",
                DateTimeOffset.UtcNow.AddHours(1), Now, CancellationToken.None);
            return 0;
        });
        Assert.Equal("failed|1", await RowAsync(envelope.EventId));
        Assert.Null(await WithRepository(r => r.ClaimInboxEventAsync(org, Guid.NewGuid(), CancellationToken.None)));

        // The sender redelivers (its own retry): the event is due again at once.
        Assert.Equal(InboxOutcome.Retry, await WithRepository(r => r.RecordInboxAsync(org, envelope, 2, Now, CancellationToken.None)));
        var again = await WithRepository(r => r.ClaimInboxEventAsync(org, owner, CancellationToken.None));
        Assert.Equal(1, again!.ProcessingAttempts);

        await WithRepository(async r =>
        {
            await r.CompleteInboxAsync(org, envelope.EventId, owner, InboxStatuses.Processed, null, null, Now, CancellationToken.None);
            return 0;
        });
        Assert.Equal("processed|2", await RowAsync(envelope.EventId));
        Assert.Equal(InboxOutcome.Done, await WithRepository(r => r.RecordInboxAsync(org, envelope, 3, Now, CancellationToken.None)));
        Assert.Null(await WithRepository(r => r.ClaimInboxEventAsync(org, Guid.NewGuid(), CancellationToken.None)));
    }

    [Fact]
    public async Task An_event_whose_worker_died_is_reclaimed_when_its_lease_expires()
    {
        var org = await OrgAsync();
        var envelope = Event(org);
        await WithRepository(r => r.RecordInboxAsync(org, envelope, 1, Now, CancellationToken.None));
        await WithRepository(r => r.ClaimInboxEventAsync(org, Guid.NewGuid(), CancellationToken.None));
        Assert.Null(await WithRepository(r => r.ClaimInboxEventAsync(org, Guid.NewGuid(), CancellationToken.None)));

        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_webhook_inbox SET lease_until = now() - interval '1 second' WHERE event_id = '{envelope.EventId}'");

        Assert.NotNull(await WithRepository(r => r.ClaimInboxEventAsync(org, Guid.NewGuid(), CancellationToken.None)));
    }

    private async Task<string?> RowAsync(Guid eventId) => (string?)await fixture.ScalarAsync(
        $"SELECT status || '|' || processing_attempts FROM assessment_provider_webhook_inbox WHERE event_id = '{eventId}'");

    // ── 7. The #312 cascade's lease ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Two_cascade_passes_claiming_at_once_never_hold_the_same_attempt()
    {
        var org = await OrgAsync();
        var attempts = new List<Guid>();
        for (var i = 0; i < 10; i++)
        {
            attempts.Add(await AttemptAsync(org, "cancelled", extra: ", withdrawal_state", extraValues: ", 'pending'"));
        }

        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        var claims = await Task.WhenAll(
            WithRepository(r => r.ClaimPendingWithdrawalsAsync(org, a, 10, CancellationToken.None)),
            WithRepository(r => r.ClaimPendingWithdrawalsAsync(org, b, 10, CancellationToken.None)));

        var ids = claims.Select(c => c.Select(x => x.Id).ToList()).ToArray();
        Assert.Empty(ids[0].Intersect(ids[1]));
        Assert.Equal(attempts.Order(), ids[0].Concat(ids[1]).Order());
        Assert.Empty(await WithRepository(r => r.ClaimPendingWithdrawalsAsync(org, Guid.NewGuid(), 10, CancellationToken.None)));
        Assert.DoesNotContain(org, await WithRepository(r => r.ListOrganizationsWithPendingWithdrawalsAsync(1000, CancellationToken.None)));

        // Only the owner's release frees them.
        await WithRepository(async r => { await r.ReleaseWithdrawalLeasesAsync(org, ids[0], b, CancellationToken.None); return 0; });
        Assert.Empty(await WithRepository(r => r.ClaimPendingWithdrawalsAsync(org, Guid.NewGuid(), 10, CancellationToken.None)));
        await WithRepository(async r => { await r.ReleaseWithdrawalLeasesAsync(org, ids[0], a, CancellationToken.None); return 0; });
        Assert.Equal(ids[0].Order(),
            (await WithRepository(r => r.ClaimPendingWithdrawalsAsync(org, Guid.NewGuid(), 10, CancellationToken.None))).Select(x => x.Id).Order());
    }

    // ── 4a. The create fence ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_unanswered_create_keeps_a_withdrawal_pending_until_it_is_answered_or_stale()
    {
        var org = await OrgAsync();
        var attempt = await AttemptAsync(org, "pending_create", mapped: false);
        Assert.NotNull(await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)));

        // The candidate withdraws while the create is in flight: no new create may begin, and completion is refused.
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET state = 'cancelled', withdrawal_state = 'pending' WHERE id = '{attempt}'");
        Assert.Null(await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)));
        var fence = Assert.Single(await WithRepository(r => r.ReadWithdrawalFencesAsync(org, [attempt], CancellationToken.None)));
        Assert.True(fence.CreateInFlight);
        Assert.False(fence.CreateStale);
        Assert.Equal(0, await WithRepository(r => r.MarkWithdrawalDoneAsync(org, [fence], Now, CancellationToken.None)));

        // Once the announcement is stale (no create can still land), the fence no longer blocks.
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET create_fences = ARRAY[now() - interval '11 minutes'] WHERE id = '{attempt}'");
        var stale = Assert.Single(await WithRepository(r => r.ReadWithdrawalFencesAsync(org, [attempt], CancellationToken.None)));
        Assert.True(stale.CreateStale);
        Assert.Equal(1, await WithRepository(r => r.MarkWithdrawalDoneAsync(org, [stale], Now, CancellationToken.None)));
    }

    [Fact]
    public async Task A_recorded_create_answer_clears_the_fence()
    {
        var org = await OrgAsync();
        var attempt = await AttemptAsync(org, "pending_create", mapped: false);
        var fence = (await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)))!.Value;
        var subject = Guid.NewGuid();
        var assignment = new ProviderAssignment(
            Guid.NewGuid(), Guid.NewGuid(), subject, "lia", "1.0", "content-1", "created", ["assessment"], [], Now.AddDays(7),
            attempt.ToString());

        await WithRepository(r => r.MarkCreatedAsync(org, attempt, assignment, Now, CancellationToken.None));
        // Recording the mapping alone ends no create: only that create's own end does (round 12).
        Assert.Equal(1, await fixture.ScalarAsync(
            $"SELECT cardinality(create_fences) FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        await WithRepository(async r => { await r.EndCreateAsync(org, attempt, fence, assignment, CancellationToken.None); return 0; });

        Assert.Equal(0, await fixture.ScalarAsync(
            $"SELECT cardinality(create_fences) FROM assessment_provider_attempts WHERE id = '{attempt}'"));
    }

    [Fact]
    public async Task A_resolved_subject_is_recorded_on_an_unmapped_attempt_only()
    {
        var org = await OrgAsync();
        var pending = await AttemptAsync(org, "pending_create", mapped: false);
        var mapped = await AttemptAsync(org, "created");
        var subject = Guid.NewGuid();

        await WithRepository(async r => { await r.RecordSubjectAsync(org, pending, subject, CancellationToken.None); return 0; });
        await WithRepository(async r => { await r.RecordSubjectAsync(org, mapped, subject, CancellationToken.None); return 0; });

        Assert.Equal(subject, await fixture.ScalarAsync($"SELECT provider_subject_id FROM assessment_provider_attempts WHERE id = '{pending}'"));
        Assert.NotEqual(subject, await fixture.ScalarAsync($"SELECT provider_subject_id FROM assessment_provider_attempts WHERE id = '{mapped}'"));
    }

    // ── 4b. The sibling-aware candidate lock ───────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_same_email_siblings_withdrawal_in_flight_is_waited_for_and_seen()
    {
        var org = await OrgAsync();
        var (target, sibling) = (Guid.NewGuid(), Guid.NewGuid());
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO candidates (id, organization_id, first_name, last_name, email)
             VALUES ('{target}', '{org}', 'Ana', 'Uno', 'ana@r10.example'), ('{sibling}', '{org}', 'Ana', 'Dos', ' ANA@r10.example ');
             """);
        var attempt = await AttemptAsync(org, "created", target);

        // The sibling's withdrawal holds ITS row lock (CandidateConsentRepository.WithdrawOneAsync) and has not committed.
        await using var withdrawal = new NpgsqlConnection(fixture.ConnectionString);
        await withdrawal.OpenAsync();
        await using var transaction = await withdrawal.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand(
            $"""
             SELECT pg_advisory_xact_lock(hashtextextended('{sibling}', 0));
             INSERT INTO data_consents (id, organization_id, subject_user_id, consent_type, withdrawn_at)
             VALUES (gen_random_uuid(), '{org}', '{sibling}', 'recruitment_data_processing', now());
             """, withdrawal, transaction))
        {
            await command.ExecuteNonQueryAsync();
        }

        // A writer for the TARGET re-checks "withdrawn" under its candidate lock (here the provider's self-healing staging).
        var staging = WithRepository(r => r.StageConsentWithdrawalAsync(org, target, Now, CancellationToken.None));
        await Task.Delay(TimeSpan.FromMilliseconds(750));
        Assert.False(staging.IsCompleted); // it waits for the sibling's withdrawal instead of reading around it

        await transaction.CommitAsync();
        Assert.Equal(1, await staging);
        Assert.Equal("pending", (string?)await fixture.ScalarAsync(
            $"SELECT withdrawal_state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
    }

    [Fact]
    public async Task More_same_email_rows_than_the_lock_bound_fail_the_writer_closed()
    {
        // Codex r10 run 2 [P2]: a partial set could leave out the target or a withdrawn sibling; nothing is written.
        var org = await OrgAsync();
        var email = $"{Guid.NewGuid():N}@r10.example";
        var values = string.Join(", ", Enumerable.Range(0, 51).Select(i =>
            $"(gen_random_uuid(), '{org}', 'C', '{i}', '{(i % 2 == 0 ? email : email.ToUpperInvariant())}')"));
        await fixture.ExecuteAsync($"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES {values}");
        var target = (Guid)(await fixture.ScalarAsync(
            $"SELECT id FROM candidates WHERE organization_id = '{org}' ORDER BY id DESC LIMIT 1"))!; // outside the first 50

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            WithRepository(r => r.StageConsentWithdrawalAsync(org, target, Now, CancellationToken.None)));
    }

    // ── 2 and 3. Optional consents and DSAR facts ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Optional_decisions_keep_only_offered_purposes_and_a_later_grant_replaces_a_decline()
    {
        var org = await OrgAsync();
        var english = await AttemptAsync(org, instrument: "english");

        await WithRepository(async r =>
        {
            await r.RecordOptionalConsentDecisionsAsync(org, english, ["ai_scoring", "assessment"], ["voice"], CancellationToken.None);
            return 0;
        });
        Assert.Equal("{ai_scoring}|{voice}", await OptionalAsync(english));

        await WithRepository(async r =>
        {
            await r.RecordOptionalConsentDecisionsAsync(org, english, ["voice"], [], CancellationToken.None);
            return 0;
        });
        Assert.Equal("{ai_scoring,voice}|{}", await OptionalAsync(english));
        var row = await WithRepository(r => r.FindAttemptAsync(org, english, CancellationToken.None));
        Assert.Empty(row!.PendingOptionalConsents);
    }

    private async Task<string?> OptionalAsync(Guid attempt) => (string?)await fixture.ScalarAsync(
        $"SELECT granted_optional_consents::text || '|' || declined_optional_consents::text FROM assessment_provider_attempts WHERE id = '{attempt}'");

    [Fact]
    public async Task Subject_facts_report_an_erased_subject_and_no_resolution_once_every_attempt_is_erased_or_requested()
    {
        var org = await OrgAsync();
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES ('{candidate}', '{org}', 'B', 'C', 'b@r10.example')");
        var requested = await AttemptAsync(org, "created", candidate, extra: ", provider_erasure_requested_at", extraValues: ", now()");
        var subject = (Guid)(await fixture.ScalarAsync($"SELECT provider_subject_id FROM assessment_provider_attempts WHERE id = '{requested}'"))!;
        var tenant = (Guid)(await fixture.ScalarAsync($"SELECT provider_tenant_id FROM assessment_provider_bindings WHERE id = '{org}'"))!;
        var erasedData = JsonSerializer.Serialize(new { subject_id = subject.ToString().ToUpperInvariant() });
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_webhook_inbox (id, organization_id, event_id, event_type, event_version,
                 provider_tenant_id, occurred_at, status, data)
             VALUES (gen_random_uuid(), '{org}', gen_random_uuid(), 'subject.erased', 1, '{tenant}', now(), 'processed',
                 '{erasedData}');
             """);

        var facts = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));

        Assert.False(facts!.NeedsResolution);
        Assert.Equal([subject], facts.ErasedSubjects);

        await AttemptAsync(org, "created", candidate); // a later, live assignment needs the subject again
        Assert.True((await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None)))!.NeedsResolution);
    }

    // Codex ats-final run 2 [P1]: a create announced before an erasure's markers may still create a provider subject. A
    // live fence is reported (the erasure stays incomplete); an unanswered one with no recorded subject forces resolution
    // even under an erasure request; a stale or answered one does neither.
    [Fact]
    public async Task Subject_facts_report_a_live_create_and_resolve_any_unanswered_one()
    {
        var org = await OrgAsync();
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES ('{candidate}', '{org}', 'B', 'C', 'f@r10.example')");
        var attempt = await AttemptAsync(org, "pending_create", candidate, mapped: false);
        Assert.NotNull(await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)));
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET provider_erasure_requested_at = now() WHERE id = '{attempt}'");

        var live = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.True(live!.CreatesInFlight);
        Assert.True(live.NeedsResolution);

        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET create_fences = ARRAY[now() - interval '11 minutes'] WHERE id = '{attempt}'");
        var stale = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.False(stale!.CreatesInFlight);
        Assert.True(stale.NeedsResolution);

        // Codex ats-final run 3: a recorded subject (or an erased attempt) does not end it; only an answer does.
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET provider_subject_id = gen_random_uuid(), provider_assignment_id = gen_random_uuid(), state = 'erased' WHERE id = '{attempt}'");
        var recorded = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.False(recorded!.CreatesInFlight);
        Assert.True(recorded.NeedsResolution);

        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET create_fences = '{{}}' WHERE id = '{attempt}'");
        var answered = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.False(answered!.CreatesInFlight);
        Assert.False(answered.NeedsResolution);
    }

    // Codex ats round 13 [P2]: after a complete erasure, only fences already stale at the read that preceded its
    // resolution are retired, and only on erasure-touched attempts; a younger fence, or one on a live attempt, stays.
    [Fact]
    public async Task Retiring_fences_drops_only_those_stale_before_the_read_on_erasure_touched_attempts()
    {
        var org = await OrgAsync();
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES ('{candidate}', '{org}', 'B', 'C', 'r13@r10.example')");
        var erased = await AttemptAsync(org, "pending_create", candidate, mapped: false);
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET provider_erasure_requested_at = now(), create_fences = ARRAY[now() - interval '1 day', now() - interval '30 seconds'] WHERE id = '{erased}'");

        var facts = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.True(facts!.NeedsResolution);
        Assert.True(facts.OnlyUnansweredCreatesNeedResolution);
        Assert.True(facts.CreatesInFlight); // the 30-second-old fence is still live
        Assert.NotNull(facts.ReadAt);

        Assert.Equal(1, await WithRepository(r => r.RetireStaleCreateFencesAsync(org, candidate, facts.ReadAt!.Value, CancellationToken.None)));
        var left = (int)(await fixture.ScalarAsync(
            $"SELECT cardinality(create_fences) FROM assessment_provider_attempts WHERE id = '{erased}'"))!;
        Assert.Equal(1, left); // the live fence survives

        // A live attempt is never touched, and its presence clears the "only unanswered creates" fact.
        var live = await AttemptAsync(org, "pending_create", candidate, mapped: false);
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET create_fences = ARRAY[now() - interval '1 day'] WHERE id = '{live}'");
        var mixed = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.False(mixed!.OnlyUnansweredCreatesNeedResolution);
        Assert.Equal(0, await WithRepository(r => r.RetireStaleCreateFencesAsync(org, candidate, mixed.ReadAt!.Value, CancellationToken.None)));
    }

    // Codex ats round 13 run 2 [P2]: subject.erased is recorded in the inbox before its worker erases the attempts. An
    // attempt recorded against that subject is already a stored erasure: it no longer calls for a resolution (whose POST
    // could create a fresh subject for the erased person). A live attempt with no subject still does.
    [Fact]
    public async Task An_attempt_whose_subject_the_provider_confirmed_erased_needs_no_resolution()
    {
        var org = await OrgAsync();
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES ('{candidate}', '{org}', 'E', 'S', 'r13s@r10.example')");
        var attempt = await AttemptAsync(org, "result_ready", candidate);
        var subject = (Guid)(await fixture.ScalarAsync(
            $"SELECT provider_subject_id FROM assessment_provider_attempts WHERE id = '{attempt}'"))!;

        var before = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.True(before!.NeedsResolution); // live: a subject no attempt names may exist

        await fixture.ExecuteAsync(
            $$"""
             INSERT INTO assessment_provider_webhook_inbox (id, organization_id, event_id, event_type, event_version,
                 provider_tenant_id, occurred_at, status, data)
             VALUES (gen_random_uuid(), '{{org}}', gen_random_uuid(), 'subject.erased', 1, gen_random_uuid(),
                 now(), 'received', '{"subject_id":"{{subject}}"}');
             """);
        var tombstoned = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.Equal(subject, Assert.Single(tombstoned!.ErasedSubjects!));
        Assert.False(tombstoned.NeedsResolution);

        await AttemptAsync(org, "pending_create", candidate, mapped: false); // a later, live assignment
        var mixed = await WithRepository(r => r.ListProviderSubjectsAsync(org, candidate, CancellationToken.None));
        Assert.True(mixed!.NeedsResolution);
    }
}
