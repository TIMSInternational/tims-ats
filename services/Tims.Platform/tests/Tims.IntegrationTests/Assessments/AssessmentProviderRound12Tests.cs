using Microsoft.EntityFrameworkCore;
using System.Text;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure;
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
    public async Task A_result_no_longer_visible_deletes_the_stored_copy_and_keeps_the_latest_result_for_polling()
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
            // The latest result id is KEPT (Codex r12 P2): the poller re-reads it, so a result made visible again
            // comes back even when its webhook is lost. Staff and FIT read the deleted result rows, not this id.
            $"SELECT latest_result_id = '{result}' AND state = 'result_ready' FROM assessment_provider_attempts WHERE id = '{attempt}'"));
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

        var hidden = Guid.NewGuid();
        Assert.Equal(0, await WithRepository(r => r.HideResultAsync(org, row!, hidden, Now, CancellationToken.None)));

        Assert.Equal("result_ready", await fixture.ScalarAsync(
            $"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        // Hidden on its first fetch (never stored): its id is recorded so the poller can bring it back if it is made
        // visible again and that webhook is lost (Codex r12 run 2 P2).
        Assert.Equal(hidden, await fixture.ScalarAsync(
            $"SELECT latest_result_id FROM assessment_provider_attempts WHERE id = '{attempt}'"));
    }

    // ── 3. The platform owner's unbind ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_unbind_is_refused_while_work_is_open_then_deactivates_with_an_audit_row_and_keeps_the_tenant()
    {
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var attempt = await PendingAttemptAsync(org, candidate);
        var actor = Guid.NewGuid();

        var state = await WithRepository(r => r.GetBindingStateAsync(org, CancellationToken.None));
        Assert.True(state.Bound);
        Assert.True(state.Active);
        Assert.Equal(1, state.OpenWork.Cancellable);

        var blocked = await WithRepository(r => r.DeactivateBindingAsync(org, actor, Now, CancellationToken.None));
        Assert.True(blocked!.Any);
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT is_active FROM assessment_provider_bindings WHERE organization_id = '{org}'"));

        await fixture.ExecuteAsync($"UPDATE assessment_provider_attempts SET state = 'cancelled' WHERE id = '{attempt}'");
        var done = await WithRepository(r => r.DeactivateBindingAsync(org, actor, Now, CancellationToken.None));
        Assert.False(done!.Any);
        Assert.Equal(false, await fixture.ScalarAsync(
            $"SELECT is_active FROM assessment_provider_bindings WHERE organization_id = '{org}'"));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE organization_id = '{org}' AND action = 'assessment_provider_binding_unset' AND actor_id = '{actor}'"));

        // Unbound: nothing in force any more, but DSAR still reaches the provider tenant.
        Assert.Null(await WithRepository(r => r.DeactivateBindingAsync(org, actor, Now, CancellationToken.None)));
        Assert.Null(await WithRepository(r => r.GetActiveBindingAsync(org, CancellationToken.None)));
        Assert.NotNull(await WithRepository(r => r.GetBindingAsync(org, CancellationToken.None)));
        Assert.False((await WithRepository(r => r.GetBindingStateAsync(org, CancellationToken.None))).Active);
    }

    [Fact]
    public async Task A_cancel_whose_lost_create_cannot_be_ruled_out_blocks_the_unbind_until_it_is_confirmed()
    {
        // Codex ATS P1: the create reached the provider, its answer was lost, and the lookup at cancel time failed. The
        // attempt is cancelled here with the cleanup marker and NO ids, and that alone must keep the binding in place:
        // after an unbind every event for the assignment would be ignored.
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var attempt = await PendingAttemptAsync(org, candidate);
        var provider = new ProviderEndpointTests.FakeProvider
        {
            OnLookup = _ => ProviderCall<ProviderAssignmentLookup>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true)),
        };
        var row = await WithRepository(r => r.FindAttemptAsync(org, attempt, CancellationToken.None));
        var cancel = await WithRepository(r => new CancelProviderAttemptUseCase(r, provider)
            .CancelAsync(org, Guid.NewGuid(), row!, Now, CancellationToken.None));
        Assert.Equal(ProviderCancelOutcome.Cancelled, cancel.Outcome);
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT state = 'cancelled' AND provider_assignment_id IS NULL AND last_error_code = 'provider_cancel_pending' FROM assessment_provider_attempts WHERE id = '{attempt}'"));

        var blocked = await WithRepository(r => r.DeactivateBindingAsync(org, Guid.NewGuid(), Now, CancellationToken.None));
        Assert.Equal(0, blocked!.Cancellable);
        Assert.Equal(1, blocked.CancelPending);
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT is_active FROM assessment_provider_bindings WHERE organization_id = '{org}'"));

        // Once untouched for the poll interval it is on the poller's queue (pre-tenant listing).
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET updated_at = now() - interval '1 hour' WHERE id = '{attempt}'");
        var queue = await WithRepository(r => r.ListUnconfirmedCancelsAsync(500, CancellationToken.None));
        Assert.Contains(new UnconfirmedCancel(org, attempt), queue);

        // The provider answers now: the landed create is recorded and cancelled there, and the marker is cleared.
        var tenant = (await WithRepository(r => r.GetBindingAsync(org, CancellationToken.None)))!.ProviderTenantId;
        var landed = Assignment(attempt, Guid.NewGuid()) with { TenantId = tenant };
        provider.OnLookup = _ => ProviderCall<ProviderAssignmentLookup>.Success(new ProviderAssignmentLookup(landed));
        var current = await WithRepository(r => r.FindAttemptAsync(org, attempt, CancellationToken.None));
        var confirmation = await WithRepository(r => ProviderCancelConfirmation.ConfirmAsync(
            r, provider, org, current!, Now, CancellationToken.None));
        Assert.True(confirmation.Confirmed);
        Assert.Equal([landed.AssignmentId], provider.CancelledAssignments);
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT state = 'cancelled' AND provider_assignment_id = '{landed.AssignmentId}' AND last_error_code IS NULL FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        Assert.DoesNotContain(new UnconfirmedCancel(org, attempt),
            await WithRepository(r => r.ListUnconfirmedCancelsAsync(500, CancellationToken.None)));

        var done = await WithRepository(r => r.DeactivateBindingAsync(org, Guid.NewGuid(), Now, CancellationToken.None));
        Assert.False(done!.Any);
    }

    [Fact]
    public async Task A_create_announced_after_the_cancels_fence_read_keeps_the_cancel_pending()
    {
        // Codex ATS r2 P1: the cancel reads no fence; the assign request then announces its create; the cancel's lookup
        // comes back empty (the create has not landed yet) and it would cancel with no marker. The create then lands
        // with its answer lost: after ten minutes nothing would block the unbind. The locked write re-checks the fences.
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var attempt = await PendingAttemptAsync(org, candidate);
        var announced = false;
        var provider = new ProviderEndpointTests.FakeProvider
        {
            OnLookup = _ =>
            {
                if (!announced)
                {
                    announced = true;
                    WithRepository(r => r.BeginCreateAsync(org, attempt, CancellationToken.None)).GetAwaiter().GetResult();
                }

                return ProviderCall<ProviderAssignmentLookup>.Success(new ProviderAssignmentLookup(null));
            },
        };
        var row = await WithRepository(r => r.FindAttemptAsync(org, attempt, CancellationToken.None));

        var cancel = await WithRepository(r => new CancelProviderAttemptUseCase(r, provider)
            .CancelAsync(org, Guid.NewGuid(), row!, Now, CancellationToken.None));

        Assert.Equal(ProviderCancelOutcome.Cancelled, cancel.Outcome);
        Assert.True(announced);
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT state = 'cancelled' AND provider_assignment_id IS NULL AND last_error_code = 'provider_cancel_pending' FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        // Even once that fence is stale, the marker keeps the unbind refused until a lookup confirms it.
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET create_fences = ARRAY[now() - interval '1 hour'] WHERE id = '{attempt}'");
        var blocked = await WithRepository(r => r.DeactivateBindingAsync(org, Guid.NewGuid(), Now, CancellationToken.None));
        Assert.Equal(1, blocked!.CancelPending);
    }

    [Fact]
    public async Task A_withdrawal_claim_never_leases_more_than_it_asked_for()
    {
        // Codex ATS r2 P2: the same `id IN (... LIMIT n FOR UPDATE SKIP LOCKED)` shape over-claimed in the poller.
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        for (var i = 0; i < 6; i++)
        {
            var pending = await PendingAttemptAsync(org, candidate);
            await fixture.ExecuteAsync(
                $"UPDATE assessment_provider_attempts SET state = 'cancelled', withdrawal_state = 'pending', instrument = 'lia', vacancy_id = gen_random_uuid() WHERE id = '{pending}'");
        }

        for (var batch = 0; batch < 3; batch++)
        {
            var claimed = await WithRepository(r => r.ClaimPendingWithdrawalsAsync(org, Guid.NewGuid(), 1, CancellationToken.None));
            Assert.Single(claimed);
        }

        Assert.Equal(3L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_attempts WHERE organization_id = '{org}' AND withdrawal_lease_owner IS NOT NULL"));
    }

    [Fact]
    public async Task A_definitive_empty_lookup_confirms_an_unconfirmed_cancel_but_never_over_recorded_ids()
    {
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var absent = await PendingAttemptAsync(org, candidate);
        var mapped = await PendingAttemptAsync(org, candidate);
        await fixture.ExecuteAsync(
            $"""
             UPDATE assessment_provider_attempts SET state = 'cancelled', last_error_code = 'provider_cancel_pending'
              WHERE id IN ('{absent}', '{mapped}');
             UPDATE assessment_provider_attempts SET provider_assignment_id = gen_random_uuid() WHERE id = '{mapped}';
             """);

        await WithRepository(async r =>
        {
            await r.ConfirmCancelAbsentAsync(org, absent, Now, CancellationToken.None);
            await r.ConfirmCancelAbsentAsync(org, mapped, Now, CancellationToken.None);
            return 0;
        });

        Assert.Equal(DBNull.Value, await fixture.ScalarAsync(
            $"SELECT last_error_code FROM assessment_provider_attempts WHERE id = '{absent}'") ?? DBNull.Value);
        Assert.Equal("provider_cancel_pending", await fixture.ScalarAsync(
            $"SELECT last_error_code FROM assessment_provider_attempts WHERE id = '{mapped}'"));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE organization_id = '{org}' AND action = 'assessment_provider_cancel_confirmed_absent'"));
    }

    [Fact]
    public async Task An_unbind_waits_for_a_reserve_in_flight_counts_its_attempt_and_a_later_reserve_writes_nothing()
    {
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var binding = (await WithRepository(r => r.GetActiveBindingAsync(org, CancellationToken.None)))!;

        // A reserve in flight: it holds the binding lock (shared) and has inserted its attempt, not yet committed.
        await using var reserve = new Npgsql.NpgsqlConnection(fixture.ConnectionString);
        await reserve.OpenAsync();
        await using var tx = await reserve.BeginTransactionAsync();
        await using (var command = new Npgsql.NpgsqlCommand(
            $"""
             SELECT pg_advisory_xact_lock_shared(hashtextextended('assessment-provider-binding:{org}', 0));
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, assigned_by_id, age_band)
             VALUES (gen_random_uuid(), '{org}', '{org}', '{candidate}', gen_random_uuid(), 'lia', 'pending_create',
                 'selection', 'Análisis de datos', 'es', 1, gen_random_uuid(), '18_plus');
             """, reserve, tx))
        {
            await command.ExecuteNonQueryAsync();
        }

        var unbind = WithRepository(r => r.DeactivateBindingAsync(org, Guid.NewGuid(), Now, CancellationToken.None));
        await Task.Delay(500);
        Assert.False(unbind.IsCompleted); // waits for the reserve
        await tx.CommitAsync();
        var work = await unbind;
        Assert.Equal(1, work!.Cancellable); // the reserve's attempt is seen: nothing unbound

        await fixture.ExecuteAsync($"UPDATE assessment_provider_attempts SET state = 'cancelled' WHERE organization_id = '{org}'");
        Assert.False((await WithRepository(r => r.DeactivateBindingAsync(org, Guid.NewGuid(), Now, CancellationToken.None)))!.Any);

        // A reserve that read the binding before the unbind finds it no longer in force, and writes nothing.
        var outcome = await WithRepository(r => r.ReserveAttemptsAsync(org, Guid.NewGuid(), binding, candidate, Guid.NewGuid(),
            [new NewAttempt("lia", "Análisis de datos", "es", 1m, [], null, "18_plus")], Now, CancellationToken.None));
        Assert.True(outcome.BindingInactive);
        Assert.Empty(outcome.Attempts);
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_attempts WHERE organization_id = '{org}'"));
    }

    // ── 4. Round 13: privacy events after an unbind; the capture fence ends with the decision ───────────────────────

    private static byte[] Event(Guid eventId, string type, Guid tenant, string data) =>
        Encoding.UTF8.GetBytes(
            $$"""{"event_id":"{{eventId}}","event_type":"{{type}}","event_version":1,"occurred_at":"2026-11-09T14:38:06Z","producer":"tims-assessments","tenant_id":"{{tenant}}","data":{{data}}}""");

    private Task<WebhookResult> Deliver(Guid tenant, string type, string data)
    {
        var eventId = Guid.NewGuid();
        var body = Event(eventId, type, tenant, data);
        return WithRepository(r => new ProviderWebhookUseCase(r, new ProviderEndpointTests.FakeProvider()).HandleAsync(
            body, WebhookSignature.BuildHeader(ProviderEndpointTests.WebhookSecret, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), body),
            eventId.ToString(), type, 1, DateTimeOffset.UtcNow, CancellationToken.None));
    }

    [Fact]
    public async Task After_an_unbind_a_subject_erased_still_enters_the_inbox_and_erases_the_retained_scores()
    {
        // Codex r12 P1: the webhook lookup required an ACTIVE binding, so after a safe unbind (which retains completed
        // results) a subject.erased was acknowledged as unknown_tenant and the erased subject's scores stayed with staff
        // and FIT. (Since Codex r13 the poller also repairs a LOST subject.erased: see section 5.)
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var (attempt, subject, result, vacancy) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 latest_result_id, assigned_by_id, age_band)
             VALUES ('{attempt}', '{org}', '{org}', '{candidate}', '{vacancy}', 'lia', 'result_ready',
                 'selection', 'Análisis de datos', 'es', 1, '{subject}', gen_random_uuid(), '{result}', gen_random_uuid(), '18_plus');
             INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
                 result_schema, instrument, instrument_version, content_version, content_sha256, norm_version, scoring_version,
                 scoring_method, purpose, validity_status, completion, global_percentile, time_multiplier_applied,
                 rendered_for, rendered_level, completed_at, scored_at)
             VALUES (gen_random_uuid(), '{org}', '{attempt}', '{result}', 1, 'LiaResultV1', 'lia', '1.0', 'content-1', repeat('a', 64),
                     'norms-1', 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', 46.2, 1, 'tenant_hr', 'full',
                     now(), now());
             """);
        var tenant = (Guid)(await fixture.ScalarAsync(
            $"SELECT provider_tenant_id FROM assessment_provider_bindings WHERE organization_id = '{org}'"))!;
        var fit = Assert.Single(await WithRepository(r => r.GetFitRowsAsync(org, candidate, vacancy, CancellationToken.None)));
        Assert.Equal(result, fit.ProviderResultId); // FIT reads the retained score before the erasure

        // The safe unbind: a result_ready attempt is not open work, so the binding is deactivated with its results retained.
        Assert.False((await WithRepository(r => r.DeactivateBindingAsync(org, Guid.NewGuid(), Now, CancellationToken.None)))!.Any);
        Assert.Equal(new ProviderTenantOwner(org, false),
            await WithRepository(r => r.FindOrganizationByProviderTenantAsync(tenant, CancellationToken.None)));

        // A lifecycle event for the unbound binding is still refused, and never recorded.
        var started = await Deliver(tenant, ProviderEventTypes.AssignmentStarted, $$"""{"assignment_id":"{{Guid.NewGuid()}}"}""");
        Assert.Equal(new WebhookResult(WebhookOutcome.Ignored, "binding_inactive"), started);

        var erased = await Deliver(tenant, ProviderEventTypes.SubjectErased, $$"""{"subject_id":"{{subject}}"}""");
        Assert.Equal(WebhookOutcome.Queued, erased.Outcome);
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_webhook_inbox WHERE organization_id = '{org}'"));

        // The inbox worker's step: claim the row and apply it.
        var owner = Guid.NewGuid();
        var claimed = await WithRepository(r => r.ClaimInboxEventAsync(org, owner, CancellationToken.None));
        var processed = await WithRepository(r => new ProviderInboxProcessor(r, new ProviderEndpointTests.FakeProvider())
            .ProcessAsync(org, claimed!.Envelope, Now, CancellationToken.None));
        Assert.Equal(new InboxProcessing(InboxStatuses.Processed, null, false), processed);

        Assert.Equal(0L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
        Assert.Equal("erased", await fixture.ScalarAsync(
            $"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        var after = Assert.Single(await WithRepository(r => r.GetFitRowsAsync(org, candidate, vacancy, CancellationToken.None)));
        Assert.Null(after.ProviderResultId); // FIT (and the staff read, from the same result rows) no longer has a score
        Assert.Null(after.GlobalPercentile);
        Assert.Equal(ProviderAttemptStates.Erased, after.AttemptState);
    }

    // ── 5. Codex r13 P1: a provider erasure whose subject.erased never arrived is applied by the poller ──────────────

    /// <summary>A result_ready attempt with one stored result, stale enough for the revision poll to claim it.</summary>
    private async Task<(Guid Org, Guid Candidate, Guid Vacancy, Guid Attempt, Guid Subject, Guid Result)> PollableResultAsync(
        int completedDaysAgo = 1) =>
        await PollableResultInAsync(await OrgAsync(), completedDaysAgo);

    private async Task<(Guid Org, Guid Candidate, Guid Vacancy, Guid Attempt, Guid Subject, Guid Result)> PollableResultInAsync(
        Guid org, int completedDaysAgo)
    {
        var candidate = await CandidateAsync(org);
        var (attempt, subject, result, vacancy) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 latest_result_id, assigned_by_id, age_band, completed_at, updated_at)
             VALUES ('{attempt}', '{org}', '{org}', '{candidate}', '{vacancy}', 'lia', 'result_ready',
                 'selection', 'Análisis de datos', 'es', 1, '{subject}', gen_random_uuid(), '{result}', gen_random_uuid(), '18_plus',
                 now() - make_interval(days => {completedDaysAgo}), now() - interval '7 hours');
             INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
                 result_schema, instrument, instrument_version, content_version, content_sha256, norm_version, scoring_version,
                 scoring_method, purpose, validity_status, completion, global_percentile, time_multiplier_applied,
                 rendered_for, rendered_level, completed_at, scored_at)
             VALUES (gen_random_uuid(), '{org}', '{attempt}', '{result}', 1, 'LiaResultV1', 'lia', '1.0', 'content-1', repeat('a', 64),
                     'norms-1', 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', 46.2, 1, 'tenant_hr', 'full',
                     now(), now());
             """);
        return (org, candidate, vacancy, attempt, subject, result);
    }

    private async Task<bool> ClaimAndPollAsync(Guid org, Guid attempt, ProviderEndpointTests.FakeProvider provider)
    {
        var owner = Guid.NewGuid();
        var claimed = Assert.Single(await WithRepository(r => r.ClaimPollableAttemptsAsync(org, owner, 5, CancellationToken.None)));
        Assert.Equal(attempt, claimed.Attempt.Id);
        var changed = await WithRepository(r => new ProviderAttemptPollUseCase(r, provider)
            .PollOneAsync(org, claimed, Now, CancellationToken.None));
        await WithRepository(async r =>
        {
            await r.ReleasePollLeaseAsync(org, attempt, owner, CancellationToken.None);
            return 0;
        });
        return changed;
    }

    [Fact]
    public async Task A_provider_erasure_without_its_webhook_is_confirmed_by_the_subject_lookup_and_erases_the_scores()
    {
        var (org, candidate, vacancy, attempt, subject, result) = await PollableResultAsync();
        Assert.Equal(result, Assert.Single(
            await WithRepository(r => r.GetFitRowsAsync(org, candidate, vacancy, CancellationToken.None))).ProviderResultId);
        var provider = new ProviderEndpointTests.FakeProvider
        {
            OnGetAssignment = _ => ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(404, "not_found", false, [])),
            OnGetSubject = id => id == subject
                ? ProviderCall<ProviderSubject>.Fail(new ProviderFailure(410, "subject_erased", false, []))
                : ProviderCall<ProviderSubject>.Success(new ProviderSubject(id, "active")),
        };

        Assert.True(await ClaimAndPollAsync(org, attempt, provider));

        Assert.Contains("get_subject", provider.Calls);
        Assert.Equal(0L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
        Assert.Equal("erased", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        var after = Assert.Single(await WithRepository(r => r.GetFitRowsAsync(org, candidate, vacancy, CancellationToken.None)));
        Assert.Null(after.ProviderResultId); // FIT (and the staff read, from the same rows) no longer has the score
        Assert.Null(after.GlobalPercentile);
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"""
             SELECT count(*) FROM audit_logs WHERE organization_id = '{org}' AND action = 'assessment_provider_subject_erased'
                AND entity_id = '{attempt}' AND metadata::jsonb ->> 'via' = 'poll'
             """));
        // Idempotent: an erased attempt is never claimed again, so the erasure is applied (and audited) once.
        Assert.Empty(await WithRepository(r => r.ClaimPollableAttemptsAsync(org, Guid.NewGuid(), 5, CancellationToken.None)));
    }

    [Fact]
    public async Task A_gone_assignment_whose_subject_is_still_active_keeps_the_scores()
    {
        var (org, candidate, vacancy, attempt, _, result) = await PollableResultAsync();
        var provider = new ProviderEndpointTests.FakeProvider
        {
            OnGetAssignment = _ => ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(404, "not_found", false, [])),
        };

        Assert.False(await ClaimAndPollAsync(org, attempt, provider));

        Assert.Contains("get_subject", provider.Calls);
        Assert.Equal(1L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
        Assert.Equal("result_ready", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        Assert.Equal(result, Assert.Single(
            await WithRepository(r => r.GetFitRowsAsync(org, candidate, vacancy, CancellationToken.None))).ProviderResultId);
        Assert.Equal(0L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE organization_id = '{org}' AND action = 'assessment_provider_subject_erased'"));
    }

    // ── 6. Codex r13 P1 (second pass): the erasure sweep covers results past the 30-day revision window ───────────

    /// <summary>
    /// The fixture's database is shared, so every OTHER subject holding a result is made not due (and recently attempted):
    /// the sweep's listing then reaches exactly this test's subjects, whatever else the collection stored.
    /// </summary>
    private Task OnlyTheseSubjectsAreDueAsync(IReadOnlyList<Guid> subjects) =>
        fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_subject_checks (organization_id, provider_subject_id, last_attempted_at, next_check_at)
             SELECT DISTINCT a.organization_id, a.provider_subject_id, now(), now() + interval '30 days'
               FROM assessment_provider_attempts a JOIN assessment_provider_results r ON r.attempt_id = a.id
              WHERE a.provider_subject_id IS NOT NULL
                AND a.provider_subject_id <> ALL (ARRAY[{string.Join(", ", subjects.Select(x => $"'{x}'::uuid"))}])
             ON CONFLICT (organization_id, provider_subject_id) DO UPDATE
                SET last_attempted_at = now(), next_check_at = now() + interval '30 days';
             """);

    private Task OnlyThisSubjectIsDueAsync(Guid subject) => OnlyTheseSubjectsAreDueAsync([subject]);

    private Task<ErasureSweep> SweepAsync(IAssessmentProvider provider) =>
        WithRepository(r => new ProviderErasureSweepUseCase(r, provider, ProviderErasureSweepSettings.Default)
            .RunAsync(Now, CancellationToken.None));

    [Fact]
    public async Task A_lost_subject_erased_for_a_result_older_than_the_revision_window_is_erased_by_the_sweep()
    {
        var (org, candidate, vacancy, attempt, subject, result) = await PollableResultAsync(completedDaysAgo: 45);
        await OnlyThisSubjectIsDueAsync(subject);
        // The D17 poller cannot reach it: past the 30-day window the attempt is not claimable at all.
        Assert.Empty(await WithRepository(r => r.ClaimPollableAttemptsAsync(org, Guid.NewGuid(), 5, CancellationToken.None)));
        Assert.Equal(result, Assert.Single(
            await WithRepository(r => r.GetFitRowsAsync(org, candidate, vacancy, CancellationToken.None))).ProviderResultId);
        var provider = new ProviderEndpointTests.FakeProvider
        {
            OnGetSubject = id => id == subject
                ? ProviderCall<ProviderSubject>.Fail(new ProviderFailure(410, "subject_erased", false, []))
                : ProviderCall<ProviderSubject>.Success(new ProviderSubject(id, "active")),
        };

        var outcome = await SweepAsync(provider);

        Assert.Equal((1, 1, 0), (outcome.Checked, outcome.Erased, outcome.Failed));
        Assert.Equal(0L, await fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_results WHERE attempt_id = '{attempt}'"));
        Assert.Equal("erased", await fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        var after = Assert.Single(await WithRepository(r => r.GetFitRowsAsync(org, candidate, vacancy, CancellationToken.None)));
        Assert.Null(after.ProviderResultId);
        Assert.Null(after.GlobalPercentile);
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"""
             SELECT count(*) FROM audit_logs WHERE organization_id = '{org}' AND action = 'assessment_provider_subject_erased'
                AND entity_id = '{attempt}' AND metadata::jsonb ->> 'via' = 'sweep'
             """));
        // With no stored result left, the subject is never listed again.
        Assert.Equal(new ErasureSweep(0, 0, 0), await SweepAsync(provider));
    }

    [Fact]
    public async Task The_sweep_asks_about_a_subject_once_per_interval_and_an_outage_gives_the_check_back()
    {
        var (org, candidate, vacancy, _, subject, result) = await PollableResultAsync(completedDaysAgo: 90);
        await OnlyThisSubjectIsDueAsync(subject);
        var answer = "503";
        var provider = new ProviderEndpointTests.FakeProvider
        {
            OnGetSubject = id => answer == "503"
                ? ProviderCall<ProviderSubject>.Fail(new ProviderFailure(503, ProviderFailure.Unavailable, true, []))
                : ProviderCall<ProviderSubject>.Success(new ProviderSubject(id, "active")),
        };

        // An outage: recorded as a failure; not asked again until its backoff has passed.
        Assert.Equal(new ErasureSweep(1, 0, 1), await SweepAsync(provider));
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT last_checked_at IS NULL AND consecutive_failures = 1 FROM assessment_provider_subject_checks WHERE organization_id = '{org}' AND provider_subject_id = '{subject}'"));
        Assert.Equal(new ErasureSweep(0, 0, 0), await SweepAsync(provider));
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_subject_checks SET next_check_at = now() - interval '1 second' WHERE provider_subject_id = '{subject}'");

        // An active subject: due again only after the interval, so the following run (well inside 7 days) does not ask.
        answer = "active";
        Assert.Equal(new ErasureSweep(1, 0, 0), await SweepAsync(provider));
        Assert.Equal(new ErasureSweep(0, 0, 0), await SweepAsync(provider));
        Assert.Equal(result, Assert.Single(
            await WithRepository(r => r.GetFitRowsAsync(org, candidate, vacancy, CancellationToken.None))).ProviderResultId);

        // Once the interval has passed it is due again.
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_subject_checks SET next_check_at = now() - interval '1 second' WHERE provider_subject_id = '{subject}'");
        Assert.Equal(new ErasureSweep(1, 0, 0), await SweepAsync(provider));
    }

    [Fact]
    public async Task A_subject_whose_lookup_always_fails_never_starves_the_others_across_capped_runs()
    {
        // Codex r13 run 3 P1: a failed check restored its old stamp, so under the per-run cap the same failing subject was
        // listed first on every run and nobody behind it was ever asked. Now the claim sends it to the back of the queue.
        var org = await OrgAsync();
        var failing = (await PollableResultInAsync(org, completedDaysAgo: 60)).Subject;
        var others = new List<Guid>();
        for (var i = 0; i < 3; i++)
        {
            others.Add((await PollableResultInAsync(org, completedDaysAgo: 60)).Subject);
        }

        await OnlyTheseSubjectsAreDueAsync([failing, .. others]);
        // All four are due; the failing subject is first in line (the oldest attempt of all), the others behind it.
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_subject_checks (organization_id, provider_subject_id, last_attempted_at, next_check_at)
             VALUES ('{org}', '{failing}', now() - interval '1 year', now() - interval '1 day'),
                    ('{org}', '{others[0]}', now() - interval '20 days', now() - interval '1 day'),
                    ('{org}', '{others[1]}', now() - interval '19 days', now() - interval '1 day'),
                    ('{org}', '{others[2]}', now() - interval '18 days', now() - interval '1 day');
             """);
        var asked = new List<Guid>();
        var provider = new ProviderEndpointTests.FakeProvider
        {
            OnGetSubject = id =>
            {
                asked.Add(id);
                return id == failing
                    ? ProviderCall<ProviderSubject>.Fail(new ProviderFailure(503, ProviderFailure.Unavailable, true, []))
                    : ProviderCall<ProviderSubject>.Success(new ProviderSubject(id, "active"));
            },
        };
        var capOne = new ProviderErasureSweepSettings(TimeSpan.FromDays(7), 1);

        for (var run = 0; run < 6; run++)
        {
            await WithRepository(r => new ProviderErasureSweepUseCase(r, provider, capOne).RunAsync(Now, CancellationToken.None));
        }

        Assert.Equal([failing, .. others], asked.Take(4)); // one per capped run: the failing one first, then every other
        Assert.Equal(1, asked.Count(id => id == failing)); // and the failing one waits out its backoff meanwhile
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"""
             SELECT count(*) FROM assessment_provider_subject_checks
              WHERE provider_subject_id = '{failing}' AND consecutive_failures = 1 AND last_checked_at IS NULL
                AND next_check_at BETWEEN last_attempted_at + interval '14 minutes' AND last_attempted_at + interval '16 minutes'
             """));
    }

    [Fact]
    public async Task The_backoff_doubles_per_consecutive_failure_and_never_exceeds_the_interval()
    {
        var org = await OrgAsync();
        var subject = (await PollableResultInAsync(org, completedDaysAgo: 60)).Subject;
        await OnlyTheseSubjectsAreDueAsync([subject]);
        var provider = new ProviderEndpointTests.FakeProvider
        {
            OnGetSubject = _ => ProviderCall<ProviderSubject>.Fail(new ProviderFailure(503, ProviderFailure.Unavailable, true, [])),
        };
        var settings = new ProviderErasureSweepSettings(TimeSpan.FromHours(1), 10);
        var waits = new List<double>();
        for (var failure = 0; failure < 4; failure++)
        {
            await WithRepository(r => new ProviderErasureSweepUseCase(r, provider, settings).RunAsync(Now, CancellationToken.None));
            waits.Add(Convert.ToDouble(await fixture.ScalarAsync(
                $"SELECT extract(epoch FROM next_check_at - last_attempted_at) FROM assessment_provider_subject_checks WHERE provider_subject_id = '{subject}'")));
            await fixture.ExecuteAsync(
                $"UPDATE assessment_provider_subject_checks SET next_check_at = now() - interval '1 second' WHERE provider_subject_id = '{subject}'");
        }

        Assert.Equal([900d, 1800d, 3600d, 3600d], waits.Select(w => Math.Round(w))); // 15, 30, then capped at the 1-hour interval

        // A conclusive answer resets the failures and makes it due one interval later.
        provider.OnGetSubject = id => ProviderCall<ProviderSubject>.Success(new ProviderSubject(id, "active"));
        await WithRepository(r => new ProviderErasureSweepUseCase(r, provider, settings).RunAsync(Now, CancellationToken.None));
        Assert.Equal(true, await fixture.ScalarAsync(
            $"""
             SELECT consecutive_failures = 0 AND last_checked_at = last_attempted_at
                    AND next_check_at = last_attempted_at + interval '1 hour'
               FROM assessment_provider_subject_checks WHERE provider_subject_id = '{subject}'
             """));
    }

    [Fact]
    public async Task The_subject_checks_table_forces_rls_grants_no_delete_and_hides_other_orgs()
    {
        const string table = AssessmentProviderDbContext.SubjectChecksTable;
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = '{table}' AND relkind = 'r'"));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM pg_policies WHERE tablename = '{table}' AND policyname = 'tenant_isolation'"));
        foreach (var role in new[] { "anon", "authenticated" })
        {
            foreach (var privilege in new[] { "SELECT", "INSERT", "UPDATE", "DELETE" })
            {
                Assert.Equal(false, await fixture.ScalarAsync($"SELECT has_table_privilege('{role}', '{table}', '{privilege}')"));
            }
        }

        Assert.Equal(false, await fixture.ScalarAsync($"SELECT has_table_privilege('app_tenant', '{table}', 'DELETE')"));

        // A claim under one org's scope writes that org's row only; another org's scope neither sees nor claims it.
        var (orgA, orgB, subject) = (await OrgAsync(), await OrgAsync(), Guid.NewGuid());
        Assert.NotNull(await WithRepository(r => r.ClaimSubjectErasureCheckAsync(orgA, subject, CancellationToken.None)));
        Assert.Null(await WithRepository(r => r.ClaimSubjectErasureCheckAsync(orgA, subject, CancellationToken.None)));
        await using (var db = fixture.NewContext())
        {
            await using var scope = await TenantScope.BeginAsync(db, orgB);
            Assert.False(await db.SubjectChecks.AnyAsync(c => c.ProviderSubjectId == subject));
            await scope.CommitAsync();
        }

        Assert.NotNull(await WithRepository(r => r.ClaimSubjectErasureCheckAsync(orgB, subject, CancellationToken.None)));
        Assert.Equal(2L, await fixture.ScalarAsync($"SELECT count(*) FROM {table} WHERE provider_subject_id = '{subject}'"));
    }

    [Fact]
    public async Task Ending_a_capture_with_its_decisions_waits_for_the_attempt_lock_and_commits_both_together()
    {
        // Codex r12 P2: the fence and the decision are one locked write. A launch holding the attempt lock (another tab
        // enforcing a decline) is waited for; once it is released, the fence is ended and the grant recorded at once.
        var org = await OrgAsync();
        var candidate = await CandidateAsync(org);
        var attempt = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 assigned_by_id, age_band, declined_optional_consents)
             VALUES ('{attempt}', '{org}', '{org}', '{candidate}', gen_random_uuid(), 'english', 'created',
                 'selection', 'Atención al cliente', 'es', 1, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '18_plus',
                 ARRAY['voice']);
             """);
        Assert.True(await WithRepository(r => r.BeginConsentCaptureAsync(org, attempt, Now, CancellationToken.None)));

        await using var other = new Npgsql.NpgsqlConnection(fixture.ConnectionString);
        await other.OpenAsync();
        await using var tx = await other.BeginTransactionAsync();
        await using (var command = new Npgsql.NpgsqlCommand(
            $"SELECT pg_advisory_xact_lock(hashtextextended('assessment-provider-attempt:{attempt}', 0))", other, tx))
        {
            await command.ExecuteNonQueryAsync();
        }

        var end = WithRepository(async r =>
        {
            await r.EndConsentCaptureAndRecordDecisionsAsync(org, attempt, ["voice"], [], Now, CancellationToken.None);
            return 0;
        });
        await Task.Delay(500);
        Assert.False(end.IsCompleted); // waits for the launch holding the attempt lock
        Assert.Equal(true, await fixture.ScalarAsync(
            $"SELECT consent_captures_in_flight = 1 AND declined_optional_consents = ARRAY['voice'] FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        await tx.CommitAsync();
        await end;

        Assert.Equal(true, await fixture.ScalarAsync(
            $"""
             SELECT consent_captures_in_flight = 0 AND consent_capture_started_at IS NULL
                    AND granted_optional_consents = ARRAY['voice'] AND cardinality(declined_optional_consents) = 0
               FROM assessment_provider_attempts WHERE id = '{attempt}'
             """));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE entity_id = '{attempt}' AND action = 'assessment_provider_optional_consents_recorded'"));
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE entity_id = '{attempt}' AND action = 'assessment_provider_consent_capture_ended'"));
    }
}
