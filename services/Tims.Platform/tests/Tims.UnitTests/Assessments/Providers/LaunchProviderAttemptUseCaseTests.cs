using System.Text.Json.Nodes;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>AS-5 launch: the candidate identity, the #312 gate on every launch and per-purpose consent.</summary>
public sealed class LaunchProviderAttemptUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 14, 0, 0, TimeSpan.Zero);
    private static readonly CapturedConsent Assessment = new("assessment", "assessment-v2026-11-cr", "es");

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private Task<LaunchResult> Launch(Guid attemptId, string email = "ana@example.com", params CapturedConsent[] consents) =>
        new LaunchProviderAttemptUseCase(_repository, _provider).LaunchAsync(attemptId, email, consents, Now, CancellationToken.None);

    // D16: the hosted player's single-use URL and the origins that may frame it; never a candidate token. The player
    // returns the candidate to the org's portal dashboard.
    [Fact]
    public async Task The_candidate_launches_the_hosted_player_and_is_returned_to_the_portal()
    {
        var attempt = _repository.AddCreatedAttempt("lia");

        var result = await Launch(attempt.Id);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Equal("native", result.Launch!.Delivery);
        Assert.Equal(FakeProvider.PlayerUrl, result.Launch.HostedUrl);
        Assert.Equal(["https://ats.example.com"], result.Launch.FrameAncestors);
        Assert.DoesNotContain(result.Launch.HostedUrl, result.Launch.ToString()); // the launch code never reaches a log line
        Assert.Equal(["/careers/invu/dashboard"], _provider.LaunchReturnPaths);
        Assert.Contains("launched", _repository.Writes);
    }

    // A portal that frames the player asks for no return URL: the player ends on its own screen in the frame, instead of
    // navigating the frame to the portal (which refuses to be framed).
    [Fact]
    public async Task An_embedded_launch_asks_for_no_return_path()
    {
        var attempt = _repository.AddCreatedAttempt("lia");

        var result = await new LaunchProviderAttemptUseCase(_repository, _provider)
            .LaunchAsync(attempt.Id, "ana@example.com", [], Now, CancellationToken.None, embedded: true);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Equal([null], _provider.LaunchReturnPaths);
    }

    [Theory]
    [InlineData("""{"embedded":true}""", true, true)]
    [InlineData("""{"embedded":false,"consents":[]}""", true, false)]
    [InlineData("""{"embedded":"yes"}""", false, false)]
    [InlineData("""{"embedded":true,"other":1}""", false, false)]
    public void The_launch_body_accepts_an_optional_boolean_embedded_flag(string json, bool valid, bool embedded)
    {
        var ok = LaunchProviderAttemptUseCase.TryParseBody(JsonNode.Parse(json), out _, out var parsed);

        Assert.Equal(valid, ok);
        Assert.Equal(embedded, parsed);
    }

    [Fact]
    public async Task An_organization_without_a_slug_launches_without_a_return_path()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.OrganizationSlug = null;

        var result = await Launch(attempt.Id);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Equal([null], _provider.LaunchReturnPaths);
    }

    // The #312 check runs again INSIDE the candidate lock, right before the provider call: a withdrawal that committed
    // after the early check (no consents to capture, so no capture re-check) launches nothing.
    [Fact]
    public async Task A_withdrawal_committed_after_the_early_check_is_seen_under_the_lock_and_nothing_is_launched()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.BeforeLockedLaunchChecks = () => _repository.WithdrawnCandidates.Add(attempt.CandidateId);

        var result = await Launch(attempt.Id);

        Assert.Equal(LaunchOutcome.ConsentWithdrawn, result.Outcome);
        Assert.DoesNotContain("launch", _provider.Calls);
        Assert.DoesNotContain("launched", _repository.Writes);
    }

    // A same-email sibling's withdrawal takes only its own candidate lock, so it can stage this attempt during the call:
    // the URL is then never handed to the candidate (the cascade cancels the assignment, revoking the unused code).
    [Fact]
    public async Task A_sibling_withdrawal_staging_the_attempt_during_the_call_hands_out_nothing()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.DuringLockedLaunchCall = () =>
            _repository.Attempts[0] = _repository.Attempts[0] with { WithdrawalState = ProviderWithdrawalStates.Pending };

        var result = await Launch(attempt.Id);

        Assert.Equal(LaunchOutcome.ConsentWithdrawn, result.Outcome);
        Assert.Null(result.Launch);
        Assert.Contains("launch", _provider.Calls);
        Assert.DoesNotContain("launched", _repository.Writes);
    }

    // Codex release round A2 [P2]: an accepted erasure of the attempt's provider subject stops every later launch, before
    // any consent is captured, and also when the erasure is accepted while the provider call is in flight.
    [Fact]
    public async Task An_attempt_under_an_accepted_erasure_captures_and_launches_nothing()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.Attempts[0] = attempt with { ErasureRequestedAt = Now.AddMinutes(-1) };

        var result = await Launch(attempt.Id, consents: [Assessment]);

        Assert.Equal(LaunchOutcome.NotFound, result.Outcome);
        Assert.Empty(_provider.Calls);
        Assert.DoesNotContain("capture_begun", _repository.Writes);
    }

    [Fact]
    public async Task An_erasure_accepted_during_the_provider_call_hands_out_nothing()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.DuringLockedLaunchCall = () => _repository.Attempts[0] = _repository.Attempts[0] with { ErasureRequestedAt = Now };

        var result = await Launch(attempt.Id);

        Assert.Equal(LaunchOutcome.NotFound, result.Outcome);
        Assert.Null(result.Launch);
        Assert.DoesNotContain("launched", _repository.Writes);
    }

    [Fact]
    public async Task An_attempt_that_finished_before_the_lock_was_taken_is_not_launched()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.BeforeLockedLaunchChecks = () =>
            _repository.Attempts[0] = _repository.Attempts[0] with { State = ProviderAttemptStates.Completed };

        var result = await Launch(attempt.Id);

        Assert.Equal(LaunchOutcome.NotLaunchable, result.Outcome);
        Assert.DoesNotContain("launch", _provider.Calls);
    }

    [Fact]
    public async Task Recorded_consents_are_no_longer_shown_as_missing_and_a_consent_required_replaces_the_list()
    {
        var attempt = _repository.AddCreatedAttempt("english");
        _repository.Attempts[0] = attempt with { MissingConsents = ["assessment", "voice"] };

        await Launch(attempt.Id, consents: [Assessment]);
        Assert.Equal(["voice"], _repository.Attempts[0].MissingConsents);

        _provider.OnLaunch = _ => ProviderCall<ProviderLaunch>.Fail(new ProviderFailure(409, "consent_required", false, ["voice", "ai_scoring"]));
        var refused = await Launch(attempt.Id);

        Assert.Equal(LaunchOutcome.ConsentRequired, refused.Outcome);
        Assert.Equal(["voice", "ai_scoring"], _repository.Attempts[0].MissingConsents);
    }

    [Fact]
    public async Task Withdrawn_recruitment_consent_blocks_launch_before_any_provider_call()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.LaunchWithdrawn = true;

        var result = await Launch(attempt.Id, consents: [Assessment]);

        Assert.Equal(LaunchOutcome.ConsentWithdrawn, result.Outcome);
        Assert.Empty(_provider.Calls); // no consent recorded, no token minted
        Assert.DoesNotContain("launched", _repository.Writes);
    }

    [Fact]
    public async Task A_link_out_launch_refused_for_missing_subject_data_patches_the_subject_and_launches_once_more()
    {
        var attempt = _repository.AddCreatedAttempt("pca");
        var launches = 0;
        _provider.OnLaunch = _ => ++launches == 1
            ? ProviderCall<ProviderLaunch>.Fail(new ProviderFailure(422, ProviderFailure.SubjectDataRequired, false, []))
            : ProviderCall<ProviderLaunch>.Success(new ProviderLaunch("link_out", Now.AddDays(1), "https://provider.example.com/sit/1", []));

        var result = await Launch(attempt.Id);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        var (subjectId, update) = Assert.Single(_provider.SubjectUpdates);
        Assert.Equal(attempt.ProviderSubjectId, subjectId);
        Assert.Equal(new ProviderSubjectUpdate("Ana", "Pérez", "ana@example.com"), update);
        Assert.Equal(2, launches);
    }

    [Fact]
    public async Task A_consent_recorded_after_the_withdrawal_cascade_finished_is_withdrawn_and_nothing_is_launched()
    {
        // The launch passes the #312 check; then the withdrawal commits and its whole cascade completes ("done");
        // then the launch records a fresh consent at the provider.
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed) with { State = ProviderAttemptStates.Created };
        _repository.Attempts[0] = attempt;
        var reads = 0;
        _repository.BeforeLoadLaunchContext = () =>
        {
            if (++reads == 2)
            {
                _repository.LaunchWithdrawn = true;
                _repository.Attempts[0] = _repository.Attempts[0] with
                {
                    State = ProviderAttemptStates.Cancelled,
                    WithdrawalState = ProviderWithdrawalStates.Done,
                };
            }
        };

        var result = await Launch(attempt.Id, consents: [Assessment]);

        Assert.Equal(LaunchOutcome.ConsentWithdrawn, result.Outcome);
        var recorded = Assert.Single(_provider.SubjectConsents[attempt.ProviderSubjectId!.Value]);
        Assert.Equal("withdrawn", recorded.Status);
        Assert.DoesNotContain("launch", _provider.Calls);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single().WithdrawalState);
    }

    // Codex release review, round 1 [P1]: a FAILED capture returned before the re-check above. The first consent is
    // stored, the withdrawal's cascade has already finished, the second capture fails: the first consent must still be
    // withdrawn (the cascade is re-opened), and nothing is launched.
    [Fact]
    public async Task A_failed_capture_after_a_stored_one_still_withdraws_it_when_the_cascade_already_finished()
    {
        var attempt = _repository.AddCreatedAttempt("english", ProviderAttemptStates.Completed) with { State = ProviderAttemptStates.Created };
        _repository.Attempts[0] = attempt;
        var subjectId = attempt.ProviderSubjectId!.Value;
        var captures = 0;
        _provider.OnRecordConsent = () =>
        {
            if (++captures == 2)
            {
                return ProviderCall<ProviderConsentRecord>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, transient: true));
            }

            var record = new ProviderConsentRecord(Guid.NewGuid(), "assessment", "active");
            _provider.SubjectConsents[subjectId] = [record];
            return ProviderCall<ProviderConsentRecord>.Success(record);
        };
        var reads = 0;
        _repository.BeforeLoadLaunchContext = () =>
        {
            if (++reads == 2)
            {
                _repository.LaunchWithdrawn = true;
                _repository.Attempts[0] = _repository.Attempts[0] with
                {
                    State = ProviderAttemptStates.Cancelled,
                    WithdrawalState = ProviderWithdrawalStates.Done,
                };
            }
        };

        var result = await Launch(attempt.Id, consents: [Assessment, new CapturedConsent("voice", "voice-v2026-11-cr", "es")]);

        Assert.Equal(LaunchOutcome.ConsentWithdrawn, result.Outcome);
        Assert.Equal(2, captures);
        Assert.Equal("withdrawn", Assert.Single(_provider.SubjectConsents[subjectId]).Status);
        Assert.DoesNotContain("launch", _provider.Calls);
        // The failed capture got no answer, so the provider may still store it: the capture stays in flight and the
        // cascade stays pending until it is stale; then it completes.
        Assert.Equal(ProviderWithdrawalStates.Pending, _repository.Attempts.Single().WithdrawalState);
        Assert.DoesNotContain("capture_ended", _repository.Writes);
        _repository.DbNow += ProviderCleanup.ConsentCaptureStaleAfter + TimeSpan.FromSeconds(1);
        await new ProviderConsentWithdrawalUseCase(_repository, _provider).PropagateAsync(FakeRepository.Org, Now, CancellationToken.None);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single().WithdrawalState);
    }

    // Codex release review, round 2 [P1]: a request cancelled after the provider stored the consent never reaches the
    // re-check. The capture was announced before it was sent, so a later withdrawal's cascade still withdraws it and
    // does not complete while the capture may be in flight.
    [Fact]
    public async Task A_launch_cancelled_after_the_provider_stored_its_consent_leaves_the_capture_announced()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        var subjectId = attempt.ProviderSubjectId!.Value;
        _provider.OnRecordConsent = () =>
        {
            _provider.SubjectConsents[subjectId] = [new ProviderConsentRecord(Guid.NewGuid(), "assessment", "active")];
            throw new OperationCanceledException();
        };

        await Assert.ThrowsAsync<OperationCanceledException>(() => Launch(attempt.Id, consents: [Assessment]));

        Assert.Equal((1, 1), (_repository.Captures[attempt.Id].Generation, _repository.Captures[attempt.Id].InFlight));
        _repository.WithdrawnCandidates.Add(attempt.CandidateId);
        var cascade = new ProviderConsentWithdrawalUseCase(_repository, _provider);
        await cascade.StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);
        Assert.Equal("withdrawn", Assert.Single(_provider.SubjectConsents[subjectId]).Status);
        Assert.Equal(ProviderWithdrawalStates.Pending, _repository.Attempts.Single().WithdrawalState);
        _repository.DbNow += ProviderCleanup.ConsentCaptureStaleAfter + TimeSpan.FromSeconds(1);
        await cascade.PropagateAsync(FakeRepository.Org, Now, CancellationToken.None);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single().WithdrawalState);
    }

    [Fact]
    public async Task A_capture_is_announced_before_it_is_sent_and_ended_once_the_provider_answered()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        var order = new List<string>();
        _provider.OnRecordConsent = () =>
        {
            order.Add("capture_sent_after:" + string.Join(",", _repository.Writes.Where(w => w.StartsWith("capture_", StringComparison.Ordinal))));
            return ProviderCall<ProviderConsentRecord>.Success(new ProviderConsentRecord(Guid.NewGuid(), "assessment", "active"));
        };

        var result = await Launch(attempt.Id, consents: [Assessment]);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Equal(["capture_sent_after:capture_begun"], order);
        Assert.Equal((2, 0), (_repository.Captures[attempt.Id].Generation, _repository.Captures[attempt.Id].InFlight));
    }

    [Fact]
    public async Task A_launch_whose_attempt_entered_a_withdrawal_after_the_check_captures_and_launches_nothing()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        // The context read sees no withdrawal; the withdrawal's staging commits right after it.
        _repository.AfterLoadLaunchContext = () =>
            _repository.Attempts[0] = _repository.Attempts[0] with { WithdrawalState = ProviderWithdrawalStates.Pending };

        var result = await Launch(attempt.Id, consents: [Assessment]);

        Assert.Equal(LaunchOutcome.ConsentWithdrawn, result.Outcome);
        Assert.Contains("capture_refused", _repository.Writes);
        Assert.DoesNotContain(_provider.Calls, c => c.StartsWith("consent:", StringComparison.Ordinal));
        Assert.DoesNotContain("launch", _provider.Calls);
    }

    [Fact]
    public async Task A_failed_capture_without_a_withdrawal_keeps_its_outcome_and_launches_nothing()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnRecordConsent = () =>
            ProviderCall<ProviderConsentRecord>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, transient: true));
        var reads = 0;
        _repository.BeforeLoadLaunchContext = () => reads++;

        var result = await Launch(attempt.Id, consents: [Assessment]);

        Assert.Equal(LaunchOutcome.ProviderUnavailable, result.Outcome);
        Assert.Equal(2, reads); // the #312 re-check ran after the failed capture
        Assert.DoesNotContain("launch", _provider.Calls);
        Assert.Null(_repository.Attempts.Single().WithdrawalState);
    }

    // The amended contract: 409 idempotency_key_in_use means a request with this key is still being processed at the
    // provider, so the capture may still be stored. It is transient (503 to the candidate) and NOT an answer: the
    // announcement stays in flight, so a withdrawal's cascade cannot complete before it is stale.
    [Fact]
    public async Task A_capture_answered_idempotency_key_in_use_stays_announced_and_is_transient()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnRecordConsent = () => ProviderCall<ProviderConsentRecord>.Fail(
            new ProviderFailure(409, ProviderFailure.IdempotencyKeyInUse, true, []) { RetryAfter = TimeSpan.FromSeconds(30) });

        var result = await Launch(attempt.Id, consents: [Assessment]);

        Assert.Equal(LaunchOutcome.ProviderUnavailable, result.Outcome);
        Assert.DoesNotContain("capture_ended", _repository.Writes);
        Assert.Equal((1, 1), (_repository.Captures[attempt.Id].Generation, _repository.Captures[attempt.Id].InFlight));
        Assert.DoesNotContain("launch", _provider.Calls);
    }

    [Fact]
    public async Task An_attempt_already_in_the_withdrawal_cascade_cannot_be_launched()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.Attempts[0] = attempt with { WithdrawalState = ProviderWithdrawalStates.Pending };

        var result = await Launch(attempt.Id);

        Assert.Equal(LaunchOutcome.ConsentWithdrawn, result.Outcome);
        Assert.Empty(_provider.Calls);
    }

    [Fact]
    public async Task Another_persons_email_cannot_launch_the_attempt_and_learns_nothing()
    {
        var attempt = _repository.AddCreatedAttempt("lia");

        Assert.Equal(LaunchOutcome.NotFound, (await Launch(attempt.Id, "intruder@example.com")).Outcome);
        Assert.Equal(LaunchOutcome.NotFound, (await Launch(Guid.NewGuid())).Outcome);
        Assert.Empty(_provider.Calls);
    }

    [Fact]
    public async Task The_email_match_ignores_case_and_surrounding_spaces()
    {
        var attempt = _repository.AddCreatedAttempt("lia");

        Assert.Equal(LaunchOutcome.Launched, (await Launch(attempt.Id, "  ANA@Example.com ")).Outcome);
    }

    [Fact]
    public async Task An_inactive_candidate_cannot_launch()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.CandidateActive = false;

        Assert.Equal(LaunchOutcome.NotFound, (await Launch(attempt.Id)).Outcome);
    }

    [Fact]
    public async Task Each_consent_is_recorded_per_purpose_with_its_audit_row_as_the_host_record()
    {
        var attempt = _repository.AddCreatedAttempt("english");

        var result = await Launch(attempt.Id, consents: [Assessment, new CapturedConsent("voice", "voice-v2026-11-cr", "es")]);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Equal(["consent:assessment", "consent:voice", "launch"], _provider.Calls);
        Assert.Equal(2, _repository.ConsentAudits.Count);
        foreach (var (audit, call) in _repository.ConsentAudits.Zip(_provider.Consents))
        {
            Assert.Equal(audit.AuditId.ToString(), call.Request.HostRecordRef);
            Assert.Equal($"ats-consent-{audit.AuditId:N}", call.Key);
            Assert.Equal(attempt.ProviderSubjectId, call.SubjectId);
            Assert.Equal(FakeRepository.Vacancy.ToString(), call.Request.ExternalVacancyRef);
            Assert.True(audit.Recorded);
        }
    }

    [Fact]
    public async Task A_missing_consent_comes_back_as_the_list_of_purposes_to_ask_for()
    {
        var attempt = _repository.AddCreatedAttempt("itcia");
        _provider.OnLaunch = _ => ProviderCall<ProviderLaunch>.Fail(new ProviderFailure(409, "consent_required", false, ["ai_scoring"]));

        var result = await Launch(attempt.Id, consents: [Assessment]);

        Assert.Equal(LaunchOutcome.ConsentRequired, result.Outcome);
        Assert.Equal(["ai_scoring"], result.Missing);
        Assert.DoesNotContain("launched", _repository.Writes);
    }

    [Fact]
    public async Task A_refused_consent_record_stops_the_launch_and_is_still_audited()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnRecordConsent = () => ProviderCall<ProviderConsentRecord>.Fail(new ProviderFailure(422, "unknown_consent_text_version", false, []));

        var result = await Launch(attempt.Id, consents: [Assessment]);

        Assert.Equal(LaunchOutcome.ConsentRejected, result.Outcome);
        Assert.DoesNotContain("launch", _provider.Calls);
        Assert.False(Assert.Single(_repository.ConsentAudits).Recorded);
    }

    [Fact]
    public async Task Finished_pending_and_expired_attempts_do_not_launch()
    {
        Assert.Equal(LaunchOutcome.NotLaunchable,
            (await Launch(_repository.AddCreatedAttempt("lia", ProviderAttemptStates.ResultReady).Id)).Outcome);
        Assert.Equal(LaunchOutcome.NotReady,
            (await Launch(_repository.AddCreatedAttempt("lia", ProviderAttemptStates.PendingCreate).Id)).Outcome);
        Assert.Equal(LaunchOutcome.Expired,
            (await Launch(_repository.AddCreatedAttempt("lia", expiresAt: Now.AddSeconds(-1)).Id)).Outcome);
        Assert.Empty(_provider.Calls);
    }

    [Fact]
    public async Task A_session_in_progress_resumes_after_the_assignment_expiry_and_the_provider_decides()
    {
        // expires_at bounds only when a sitting can START: a candidate who started before it and reloads after it
        // still has time on the session's own deadline.
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress, expiresAt: Now.AddSeconds(-1));

        Assert.Equal(LaunchOutcome.Launched, (await Launch(attempt.Id)).Outcome);
        Assert.NotEmpty(_provider.Calls);
    }

    [Fact]
    public async Task A_provider_side_expiry_is_recorded()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnLaunch = _ => ProviderCall<ProviderLaunch>.Fail(new ProviderFailure(410, "assignment_expired", false, []));

        Assert.Equal(LaunchOutcome.Expired, (await Launch(attempt.Id)).Outcome);
        Assert.Contains("expired", _repository.Writes);
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("""{}""", true)]
    [InlineData("""{"consents":[{"purpose":"assessment","textVersion":"assessment-v2026-11-cr","locale":"es"}]}""", true)]
    [InlineData("""{"consents":[{"purpose":"assessment","textVersion":"v1","locale":"es"},{"purpose":"assessment","textVersion":"v2","locale":"es"}]}""", false)]
    [InlineData("""{"consents":[{"purpose":"marketing","textVersion":"v1","locale":"es"}]}""", false)]
    [InlineData("""{"consents":[{"purpose":"assessment","textVersion":"v1 with spaces","locale":"es"}]}""", false)]
    [InlineData("""{"consents":[],"candidateId":"c0000000-0000-4000-8000-000000000001"}""", false)]
    public void The_body_is_parsed_strictly(string? json, bool ok)
    {
        Assert.Equal(ok, LaunchProviderAttemptUseCase.TryParseBody(json is null ? null : JsonNode.Parse(json), out _));
    }
}
