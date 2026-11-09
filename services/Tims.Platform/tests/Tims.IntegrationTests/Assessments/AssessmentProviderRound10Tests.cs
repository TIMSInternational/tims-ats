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
        Assert.True(await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)));

        // The candidate withdraws while the create is in flight: no new create may begin, and completion is refused.
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET state = 'cancelled', withdrawal_state = 'pending' WHERE id = '{attempt}'");
        Assert.False(await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)));
        var fence = Assert.Single(await WithRepository(r => r.ReadWithdrawalFencesAsync(org, [attempt], CancellationToken.None)));
        Assert.True(fence.CreateInFlight);
        Assert.False(fence.CreateStale);
        Assert.Equal(0, await WithRepository(r => r.MarkWithdrawalDoneAsync(org, [fence], Now, CancellationToken.None)));

        // Once the announcement is stale (no create can still land), the fence no longer blocks.
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET create_started_at = now() - interval '11 minutes' WHERE id = '{attempt}'");
        var stale = Assert.Single(await WithRepository(r => r.ReadWithdrawalFencesAsync(org, [attempt], CancellationToken.None)));
        Assert.True(stale.CreateStale);
        Assert.Equal(1, await WithRepository(r => r.MarkWithdrawalDoneAsync(org, [stale], Now, CancellationToken.None)));
    }

    [Fact]
    public async Task A_recorded_create_answer_clears_the_fence()
    {
        var org = await OrgAsync();
        var attempt = await AttemptAsync(org, "pending_create", mapped: false);
        await WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None));
        var subject = Guid.NewGuid();

        await WithRepository(r => r.MarkCreatedAsync(org, attempt, new ProviderAssignment(
            Guid.NewGuid(), Guid.NewGuid(), subject, "lia", "1.0", "content-1", "created", ["assessment"], [], Now.AddDays(7),
            attempt.ToString()), Now, CancellationToken.None));

        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT create_started_at IS NULL FROM assessment_provider_attempts WHERE id = '{attempt}'"));
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
}
