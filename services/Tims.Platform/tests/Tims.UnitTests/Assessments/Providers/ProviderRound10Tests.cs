using System.Text;
using System.Text.Json.Nodes;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// Round-10 release fixes: the webhook inbox as a work queue (2xx after verify + commit, processing in the worker),
/// optional English speaking consents, a stored erasure as terminal for DSAR, the create fence of the #312 cascade and the
/// cascade's lease.
/// </summary>
public sealed class ProviderRound10Tests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 14, 38, 10, TimeSpan.Zero);
    private static readonly Guid Owner = Guid.Parse("0f0f0f0f-0000-4000-8000-000000000002");

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private static (byte[] Body, Guid EventId) Envelope(string type, JsonObject data)
    {
        var id = Guid.NewGuid();
        var envelope = new JsonObject
        {
            ["event_id"] = id.ToString(),
            ["event_type"] = type,
            ["event_version"] = 1,
            ["occurred_at"] = "2026-11-09T14:38:06Z",
            ["producer"] = "tims-assessments",
            ["tenant_id"] = "3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12",
            ["data"] = data,
        };
        return (Encoding.UTF8.GetBytes(envelope.ToJsonString()), id);
    }

    private Task<WebhookResult> Receive(byte[] body, Guid eventId, string type, ProviderInboxSignal? signal = null) =>
        new ProviderWebhookUseCase(_repository, _provider, signal).HandleAsync(
            body, WebhookSignature.BuildHeader(FakeProvider.Secret, Now.ToUnixTimeSeconds(), body),
            eventId.ToString(), type, 1, Now, CancellationToken.None);

    // ── 1. Webhooks: acknowledge after verify + inbox insert, process in the worker ─────────────────────────────────

    [Fact]
    public async Task The_webhook_request_only_verifies_and_records_the_event_the_worker_applies_it()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);
        var (body, eventId) = Envelope("assignment.expired", new JsonObject
        {
            ["assignment_id"] = attempt.ProviderAssignmentId.ToString(),
            ["expired_at"] = "2026-11-09T14:38:05Z",
        });
        var signal = new ProviderInboxSignal();
        var woken = signal.WaitAsync(TimeSpan.FromMinutes(5), TimeProvider.System, CancellationToken.None);

        var ack = await Receive(body, eventId, "assignment.expired", signal);

        // 2xx with nothing applied and no provider call in the request: the inbox row is the durable record, and the
        // worker is woken at once.
        Assert.Equal(WebhookOutcome.Queued, ack.Outcome);
        Assert.Empty(_repository.Writes);
        Assert.Empty(_provider.Calls);
        Assert.Equal(InboxStatuses.Received, _repository.Inbox[eventId]);
        Assert.NotNull(_repository.InboxRows[eventId].NextAt);
        await woken.WaitAsync(TimeSpan.FromSeconds(5));

        var run = await new ProviderInboxWorkerUseCase(_repository, _provider).RunAsync(Owner, Now, CancellationToken.None);

        Assert.Equal(1, run.Processed);
        Assert.Equal(InboxStatuses.Processed, _repository.Inbox[eventId]);
        Assert.Null(_repository.InboxRows[eventId].NextAt); // final: never claimed again
        Assert.Equal(["advance:expired"], _repository.Writes);
    }

    [Fact]
    public async Task An_event_recorded_before_a_crash_is_processed_by_the_next_worker_run()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);
        var (body, eventId) = Envelope("session.completed", new JsonObject
        {
            ["assignment_id"] = attempt.ProviderAssignmentId.ToString(),
            ["completed_at"] = "2026-11-09T14:38:05Z",
        });
        await Receive(body, eventId, "session.completed");

        // The process that acknowledged it dies here. A later run, on any instance, finds the row due.
        var run = await new ProviderInboxWorkerUseCase(_repository, _provider).RunAsync(Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(1, run.Processed);
        Assert.Equal(["advance:completed"], _repository.Writes);
    }

    [Fact]
    public async Task A_transient_failure_reschedules_the_event_with_backoff_and_does_not_lose_it()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);
        var (body, eventId) = Envelope("result.ready", new JsonObject
        {
            ["result_id"] = Guid.NewGuid().ToString(),
            ["assignment_id"] = attempt.ProviderAssignmentId.ToString(),
        });
        await Receive(body, eventId, "result.ready"); // the fake's default GetResult is an outage

        var run = await new ProviderInboxWorkerUseCase(_repository, _provider).RunAsync(Owner, Now, CancellationToken.None);

        Assert.Equal(1, run.Rescheduled);
        var row = _repository.InboxRows[eventId];
        Assert.Equal(InboxStatuses.Failed, _repository.Inbox[eventId]);
        Assert.Equal(Now + ProviderInboxProcessing.FirstRetryDelay, row.NextAt);
        Assert.Null(row.LeaseOwner);
    }

    [Fact]
    public async Task A_processing_exception_is_rescheduled_not_dropped()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);
        var (body, eventId) = Envelope("assignment.started", new JsonObject
        {
            ["assignment_id"] = attempt.ProviderAssignmentId.ToString(),
        });
        await Receive(body, eventId, "assignment.started");
        _repository.ThrowOnFindByAssignment = true;

        var run = await new ProviderInboxWorkerUseCase(_repository, _provider).RunAsync(Owner, Now, CancellationToken.None);

        Assert.Equal(1, run.Rescheduled);
        Assert.Equal("processing_error", _repository.InboxRows[eventId].Code);
        Assert.NotNull(_repository.InboxRows[eventId].NextAt);
    }

    [Fact]
    public void Retries_back_off_exponentially_up_to_an_hour_and_stop_after_72_hours()
    {
        var received = Now;
        Assert.Equal(Now.AddSeconds(30), ProviderInboxProcessing.NextRetryAt(1, received, Now));
        Assert.Equal(Now.AddMinutes(1), ProviderInboxProcessing.NextRetryAt(2, received, Now));
        Assert.Equal(Now.AddMinutes(32), ProviderInboxProcessing.NextRetryAt(7, received, Now));
        Assert.Equal(Now.AddHours(1), ProviderInboxProcessing.NextRetryAt(8, received, Now));
        Assert.Equal(Now.AddHours(1), ProviderInboxProcessing.NextRetryAt(500, received, Now));
        Assert.Null(ProviderInboxProcessing.NextRetryAt(80, received, Now.AddHours(71.5)));
    }

    // ── 2. English speaking: optional voice and ai_scoring consents ─────────────────────────────────────────────────

    [Fact]
    public async Task An_english_attempt_offers_voice_and_ai_scoring_as_optional_until_the_candidate_decides()
    {
        var attempt = _repository.AddCreatedAttempt("english");
        var portal = new ProviderPortalUseCase(_repository, _provider);

        var listed = await portal.ListAsync("invu", "ana@example.com", Now, CancellationToken.None);
        var templates = await portal.ConsentTemplatesAsync(attempt.Id, "ana@example.com", "es", Now, CancellationToken.None);

        var item = Assert.Single(listed.Attempts);
        Assert.Equal(ProviderPortalStatuses.ConsentNeeded, item.Status);
        Assert.Empty(item.MissingConsents);
        Assert.Equal([ConsentPurposes.Voice, ConsentPurposes.AiScoring], item.OptionalConsents);
        Assert.Equal([ConsentPurposes.Voice, ConsentPurposes.AiScoring], templates.OptionalPurposes);
        Assert.Equal([ConsentPurposes.Voice, ConsentPurposes.AiScoring], templates.Templates.Select(t => t.Purpose));

        // A LIA attempt offers nothing optional.
        Assert.Empty(OptionalConsents.For(ProviderInstruments.Lia));
    }

    [Fact]
    public async Task A_launch_records_the_optional_purposes_granted_and_declined_and_hr_sees_why_speaking_is_missing()
    {
        var attempt = _repository.AddCreatedAttempt("english");
        var launch = new LaunchProviderAttemptUseCase(_repository, _provider);

        var result = await launch.LaunchAsync(
            attempt.Id, "ana@example.com", [new CapturedConsent(ConsentPurposes.AiScoring, "v1", "es")], Now,
            CancellationToken.None, declinedOptional: [ConsentPurposes.Voice]);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        var decision = Assert.Single(_repository.OptionalDecisions);
        Assert.Equal([ConsentPurposes.AiScoring], decision.Granted);
        Assert.Equal([ConsentPurposes.Voice], decision.Declined);
        var row = _repository.Attempts.Single();
        Assert.Empty(row.PendingOptionalConsents);
        Assert.Equal(ProviderPortalStatuses.Ready, ProviderPortalStatuses.For(row, Now));
        Assert.Equal("no_voice_consent",
            OptionalConsents.SpeakingNotAssessedReason(row.Instrument, row.DeclinedOptionalConsents ?? []));
    }

    [Fact]
    public async Task A_declined_purpose_an_instrument_does_not_offer_as_optional_is_ignored()
    {
        var attempt = _repository.AddCreatedAttempt("lia");

        await new LaunchProviderAttemptUseCase(_repository, _provider).LaunchAsync(
            attempt.Id, "ana@example.com", [], Now, CancellationToken.None, declinedOptional: [ConsentPurposes.Voice]);

        Assert.Empty(_repository.OptionalDecisions);
    }

    [Fact]
    public void The_launch_body_accepts_declined_consents_and_refuses_one_both_accepted_and_declined()
    {
        var ok = JsonNode.Parse("""{"consents":[{"purpose":"assessment","textVersion":"v1","locale":"es"}],"declinedConsents":["voice","ai_scoring"]}""");
        var both = JsonNode.Parse("""{"consents":[{"purpose":"voice","textVersion":"v1","locale":"es"}],"declinedConsents":["voice"]}""");
        var unknown = JsonNode.Parse("""{"declinedConsents":["sms"]}""");

        Assert.True(LaunchProviderAttemptUseCase.TryParseBody(ok, out _, out _, out var declined));
        Assert.Equal([ConsentPurposes.Voice, ConsentPurposes.AiScoring], declined);
        Assert.False(LaunchProviderAttemptUseCase.TryParseBody(both, out _, out _, out _));
        Assert.False(LaunchProviderAttemptUseCase.TryParseBody(unknown, out _, out _, out _));
    }

    [Theory]
    [InlineData(new[] { "voice" }, "no_voice_consent")]
    [InlineData(new[] { "ai_scoring" }, "no_ai_scoring_consent")]
    [InlineData(new[] { "voice", "ai_scoring" }, "no_voice_consent")]
    [InlineData(new string[0], null)]
    public void Hr_is_told_which_declined_consent_left_speaking_unassessed(string[] declined, string? expected) =>
        Assert.Equal(expected, OptionalConsents.SpeakingNotAssessedReason(ProviderInstruments.English, declined));

    // ── 3. DSAR after a provider erasure ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_dsar_export_after_an_accepted_erasure_never_resolves_a_fresh_provider_subject()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.Attempts[0] = attempt with { ErasureRequestedAt = Now.AddDays(-2) };

        var result = await new ProviderSubjectRightsUseCase(_repository, _provider)
            .ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderExportOutcome.Exported, result.Outcome);
        Assert.Empty(_provider.Subjects); // no POST /v1/subjects: it would create a new, empty subject
        Assert.Equal([attempt.ProviderSubjectId!.Value], _provider.ExportedSubjects);
    }

    [Fact]
    public async Task A_subject_whose_erasure_completed_is_terminal_for_export_and_erasure()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.Attempts[0] = attempt with { State = ProviderAttemptStates.Erased, ErasureRequestedAt = Now.AddDays(-2) };
        _repository.ErasedSubjects.Add(attempt.ProviderSubjectId!.Value);
        var rights = new ProviderSubjectRightsUseCase(_repository, _provider);

        var export = await rights.ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);
        var erase = await rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal("erased", Assert.Single(export.Export!.ProviderExports).Status);
        Assert.Equal(ProviderErasureOutcome.Requested, erase.Outcome);
        Assert.Empty(_provider.Subjects);
        Assert.Empty(_provider.ExportedSubjects);
        Assert.Empty(_provider.ErasedSubjects);
    }

    // ── 4a. The create fence of the #312 cascade ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_withdrawal_while_a_create_is_in_flight_keeps_the_attempt_pending_until_the_create_is_found()
    {
        // The create is announced, then the candidate withdraws and the cascade runs BEFORE the create reaches the
        // provider: its lookup by external_ref finds nothing. Then the process dies without recording the answer.
        var assign = new AssignProviderInstrumentsUseCase(_repository, _provider);
        ProviderAssignmentRequest? sent = null;
        _repository.AfterBeginCreate = () =>
        {
            _repository.WithdrawnCandidates.Add(FakeRepository.Candidate);
            var pass = new ProviderConsentWithdrawalUseCase(_repository, _provider)
                .StageAndPropagateAsync(FakeRepository.Org, FakeRepository.Candidate, Now, CancellationToken.None)
                .GetAwaiter().GetResult();
            Assert.Equal(0, pass.Confirmed);
        };
        _provider.OnCreateAssignment = request =>
        {
            sent = request;
            _provider.ByExternalRef[request.ExternalRef] = FakeProvider.Created(request).Value!;
            return ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));
        };

        await assign.AssignAsync(FakeRepository.Org, Guid.NewGuid(),
            new AssignProviderInstrumentsInput(FakeRepository.Candidate, FakeRepository.Vacancy,
                [new AssignInstrumentItem("lia", null)], null, 1m, [], null, ProviderAgeBands.Adult), Now, CancellationToken.None);

        var row = _repository.Attempts.Single();
        Assert.NotNull(sent);
        Assert.Equal(ProviderWithdrawalStates.Pending, row.WithdrawalState); // NOT done: the create could still land

        // The next pass (the sweep) finds the orphan by external_ref, records and cancels it, and only then completes.
        var next = await new ProviderConsentWithdrawalUseCase(_repository, _provider)
            .PropagateAsync(FakeRepository.Org, Now, CancellationToken.None);

        row = _repository.Attempts.Single();
        Assert.Equal(1, next.Confirmed);
        Assert.Equal(ProviderWithdrawalStates.Done, row.WithdrawalState);
        Assert.Equal([_provider.ByExternalRef[row.Id.ToString()].AssignmentId], _provider.Cancelled);
    }

    [Fact]
    public async Task A_withdrawal_staged_before_the_first_provider_call_sends_no_subject_and_no_create()
    {
        // Codex r10 run 1 [P1]: the reservation commits, the candidate withdraws, then the request resumes. Nothing,
        // not even the subject with its names and email, may reach the provider.
        _repository.Binding = _repository.Binding! with { EnabledInstruments = [ProviderInstruments.Lia, ProviderInstruments.Pca] };
        _repository.AfterReserve = () =>
        {
            _repository.WithdrawnCandidates.Add(FakeRepository.Candidate);
            _repository.StageConsentWithdrawalAsync(FakeRepository.Org, FakeRepository.Candidate, Now, CancellationToken.None)
                .GetAwaiter().GetResult();
        };

        await new AssignProviderInstrumentsUseCase(_repository, _provider).AssignAsync(FakeRepository.Org, Guid.NewGuid(),
            new AssignProviderInstrumentsInput(FakeRepository.Candidate, FakeRepository.Vacancy,
                [new AssignInstrumentItem("lia", null)], null, 1m, [], null, ProviderAgeBands.Adult), Now, CancellationToken.None);

        Assert.Empty(_provider.Subjects);
        Assert.Empty(_provider.Assignments);
        Assert.Contains("create_refused", _repository.Writes);
    }

    [Fact]
    public async Task A_subject_resolved_by_an_unanswered_create_is_recorded_so_the_cascade_reaches_its_consents()
    {
        _provider.OnCreateAssignment = _ => ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        await new AssignProviderInstrumentsUseCase(_repository, _provider).AssignAsync(FakeRepository.Org, Guid.NewGuid(),
            new AssignProviderInstrumentsInput(FakeRepository.Candidate, FakeRepository.Vacancy,
                [new AssignInstrumentItem("lia", null)], null, 1m, [], null, ProviderAgeBands.Adult), Now, CancellationToken.None);

        var row = _repository.Attempts.Single();
        Assert.Null(row.ProviderAssignmentId);
        Assert.Equal(_provider.SubjectId, row.ProviderSubjectId);
    }

    [Fact]
    public async Task Declining_an_optional_purpose_withdraws_an_active_provider_consent_for_it_before_the_launch()
    {
        // Codex r10 run 1 [P1]: an earlier attempt of this subject granted voice; the candidate now declines it.
        var attempt = _repository.AddCreatedAttempt("english");
        var granted = Guid.NewGuid();
        var other = Guid.NewGuid();
        _provider.SubjectConsents[attempt.ProviderSubjectId!.Value] =
        [
            new ProviderConsentRecord(granted, ConsentPurposes.Voice, "active"),
            new ProviderConsentRecord(other, ConsentPurposes.Assessment, "active"),
        ];

        var result = await new LaunchProviderAttemptUseCase(_repository, _provider).LaunchAsync(
            attempt.Id, "ana@example.com", [], Now, CancellationToken.None, declinedOptional: [ConsentPurposes.Voice]);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Equal([(attempt.ProviderSubjectId.Value, granted)], _provider.WithdrawnConsents);
        Assert.Equal([ConsentPurposes.Voice], Assert.Single(_repository.OptionalDecisions).Declined);
    }

    [Fact]
    public async Task A_decline_the_provider_cannot_confirm_records_nothing_and_launches_nothing()
    {
        var attempt = _repository.AddCreatedAttempt("english");
        _provider.SubjectConsents[attempt.ProviderSubjectId!.Value] = [new ProviderConsentRecord(Guid.NewGuid(), ConsentPurposes.Voice, "active")];
        _provider.OnWithdrawConsent = _ => ProviderCall<ProviderConsentRecord>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        var result = await new LaunchProviderAttemptUseCase(_repository, _provider).LaunchAsync(
            attempt.Id, "ana@example.com", [], Now, CancellationToken.None, declinedOptional: [ConsentPurposes.Voice]);

        Assert.Equal(LaunchOutcome.ProviderUnavailable, result.Outcome);
        // The decline is on record (the next launch enforces it again); no sitting started meanwhile.
        Assert.Equal([ConsentPurposes.Voice], Assert.Single(_repository.OptionalDecisions).Declined);
        Assert.DoesNotContain(_provider.Calls, c => c == "launch");
    }

    [Fact]
    public async Task A_grant_recorded_by_another_tab_after_this_decline_wins_and_is_not_withdrawn()
    {
        // Codex r10 run 2 [P1]: tab A declines voice; before A's launch takes its locks, tab B captures voice and records
        // the grant. The provider must then hold exactly what was recorded LAST: voice active, attempt "granted".
        var attempt = _repository.AddCreatedAttempt("english");
        var subject = attempt.ProviderSubjectId!.Value;
        var voice = Guid.NewGuid();
        _repository.BeforeLockedLaunchChecks = () =>
        {
            _provider.SubjectConsents[subject] = [new ProviderConsentRecord(voice, ConsentPurposes.Voice, "active")];
            _repository.RecordOptionalConsentDecisionsAsync(FakeRepository.Org, attempt.Id, [ConsentPurposes.Voice], [],
                CancellationToken.None).GetAwaiter().GetResult();
        };

        var result = await new LaunchProviderAttemptUseCase(_repository, _provider).LaunchAsync(
            attempt.Id, "ana@example.com", [], Now, CancellationToken.None, declinedOptional: [ConsentPurposes.Voice]);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Empty(_provider.WithdrawnConsents);
        Assert.Equal([ConsentPurposes.Voice], _repository.Attempts.Single().GrantedOptionalConsents);
        Assert.Null(OptionalConsents.SpeakingNotAssessedReason("english", _repository.Attempts.Single().DeclinedOptionalConsents!));
    }

    [Fact]
    public async Task A_decline_is_not_enforced_while_another_tabs_capture_may_still_land()
    {
        // Codex r10 run 3 [P1]: tab B announced a capture and its request is still in flight; tab A declines voice. A's
        // withdrawal could run before B's capture lands, so A retries instead of launching against a reactivated consent.
        var attempt = _repository.AddCreatedAttempt("english");
        _repository.DbNow = Now;
        _repository.BeforeLockedLaunchChecks = () =>
            _repository.BeginConsentCaptureAsync(FakeRepository.Org, attempt.Id, Now, CancellationToken.None).GetAwaiter().GetResult();

        var result = await new LaunchProviderAttemptUseCase(_repository, _provider).LaunchAsync(
            attempt.Id, "ana@example.com", [], Now, CancellationToken.None, declinedOptional: [ConsentPurposes.Voice]);

        Assert.Equal(LaunchOutcome.ProviderUnavailable, result.Outcome);
        Assert.Equal("consent_capture_in_flight", result.Detail);
        Assert.DoesNotContain(_provider.Calls, c => c == "launch");
    }

    [Fact]
    public async Task A_recorded_decline_is_enforced_under_the_launch_lock_even_against_a_later_capture()
    {
        // The decline was recorded earlier; another tab's capture then landed at the provider without recording a grant.
        // Any later launch, under its locks, withdraws it again: the recorded decision is what the sitting gets.
        var attempt = _repository.AddCreatedAttempt("english") with { DeclinedOptionalConsents = [ConsentPurposes.Voice] };
        _repository.Attempts[0] = attempt;
        var voice = Guid.NewGuid();
        _provider.SubjectConsents[attempt.ProviderSubjectId!.Value] = [new ProviderConsentRecord(voice, ConsentPurposes.Voice, "active")];

        var result = await new LaunchProviderAttemptUseCase(_repository, _provider).LaunchAsync(
            attempt.Id, "ana@example.com", [], Now, CancellationToken.None);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Equal([(attempt.ProviderSubjectId.Value, voice)], _provider.WithdrawnConsents);
    }

    [Fact]
    public async Task A_stale_create_announcement_no_longer_blocks_the_cascade()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Cancelled) with
        {
            ProviderAssignmentId = null,
            ProviderSubjectId = null,
            WithdrawalState = ProviderWithdrawalStates.Pending,
        };
        _repository.Attempts[0] = attempt;
        _repository.CreatesInFlight[attempt.Id] = _repository.DbNow - ProviderCreateFence.StaleAfter - TimeSpan.FromSeconds(1);

        var pass = await new ProviderConsentWithdrawalUseCase(_repository, _provider)
            .PropagateAsync(FakeRepository.Org, Now, CancellationToken.None);

        Assert.Equal(1, pass.Confirmed);
    }

    [Fact]
    public async Task A_create_of_an_attempt_already_in_a_withdrawal_is_never_sent()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.PendingCreate) with
        {
            ProviderAssignmentId = null,
            ProviderSubjectId = null,
            WithdrawalState = ProviderWithdrawalStates.Pending,
        };
        _repository.Attempts[0] = attempt;

        Assert.False(await _repository.BeginCreateAsync(FakeRepository.Org, attempt.Id, CancellationToken.None));
    }

    // ── 7. The cascade's lease ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Two_concurrent_cascade_passes_never_work_on_the_same_attempt()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Cancelled) with
        {
            WithdrawalState = ProviderWithdrawalStates.Pending,
        };
        _repository.Attempts[0] = attempt;
        var first = new ProviderConsentWithdrawalUseCase(_repository, _provider);
        var second = new ProviderConsentWithdrawalUseCase(_repository, _provider);
        WithdrawalPropagation? inner = null;
        // While the first pass holds its claim (it is listing the subject's consents), a second instance's pass runs.
        _provider.OnListConsents = _ =>
        {
            _provider.OnListConsents = null;
            inner = second.PropagateAsync(FakeRepository.Org, Now, CancellationToken.None).GetAwaiter().GetResult();
            return ProviderCall<IReadOnlyList<ProviderConsentRecord>>.Success([]);
        };

        var outer = await first.PropagateAsync(FakeRepository.Org, Now, CancellationToken.None);

        Assert.Equal(new WithdrawalPropagation(0, 0), inner); // claimed nothing: no duplicate provider calls
        Assert.Equal(1, outer.Confirmed);
        Assert.Single(_provider.Calls, c => c == "list_consents");
        Assert.Empty(_repository.WithdrawalLeases); // released when the pass ended
    }
}
