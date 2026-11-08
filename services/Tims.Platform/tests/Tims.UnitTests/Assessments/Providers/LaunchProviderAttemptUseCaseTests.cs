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

    [Fact]
    public async Task The_candidate_launches_and_gets_the_provider_token()
    {
        var attempt = _repository.AddCreatedAttempt("lia");

        var result = await Launch(attempt.Id);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Equal("native", result.Launch!.Delivery);
        Assert.NotNull(result.Launch.CandidateToken);
        Assert.DoesNotContain(result.Launch.CandidateToken!, result.Launch.ToString()); // never printable into a log line
        Assert.Contains("launched", _repository.Writes);
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
            : ProviderCall<ProviderLaunch>.Success(new ProviderLaunch("link_out", null, Now.AddDays(1), "https://assessments.example.com",
                "https://provider.example.com/sit/1"));

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
