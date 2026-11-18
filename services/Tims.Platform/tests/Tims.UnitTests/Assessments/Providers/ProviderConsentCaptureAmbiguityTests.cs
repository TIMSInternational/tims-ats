using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// Codex ATS r13 P1: a gateway 502/504 during a consent capture lifted the capture fence although the provider behind the
/// gateway could still store the consent, so a withdrawal running at the same moment could complete and leave that
/// consent active. Only a refusal the provider itself gave (4xx, except 409 idempotency_key_in_use) settles a capture
/// now (<see cref="ProviderFailure.SettlesConsentCapture"/>); any other outcome keeps the fence in flight until it is
/// stale, and the withdrawal pass that reads it stale lists the provider's consents and withdraws what landed.
/// </summary>
public sealed class ProviderConsentCaptureAmbiguityTests
{
    // The fake's database clock (FakeRepository.DbNow) starts here too, so fence staleness reads the same time.
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 14, 0, 0, TimeSpan.Zero);
    private static readonly CapturedConsent Assessment = new("assessment", "assessment-v2026-11-cr", "es");

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private Task<LaunchResult> Launch(
        Guid attemptId, IReadOnlyList<CapturedConsent> consents, DateTimeOffset? now = null,
        IReadOnlyList<string>? declined = null) =>
        new LaunchProviderAttemptUseCase(_repository, _provider).LaunchAsync(
            attemptId, "ana@example.com", consents, now ?? Now, CancellationToken.None, declinedOptional: declined,
            notice: LaunchProviderAttemptUseCaseTests.Notice);

    private static ProviderCall<ProviderConsentRecord> Gateway(int status) =>
        ProviderCall<ProviderConsentRecord>.Fail(new ProviderFailure(status, ProviderFailure.Unavailable, true, []));

    [Theory]
    [InlineData(null, ProviderFailure.Unavailable, false)] // timeout, outage, lost connection
    [InlineData(null, ProviderFailure.ContractViolation, false)] // a 2xx that broke the contract: it WAS stored
    [InlineData(500, ProviderFailure.Unavailable, false)]
    [InlineData(502, ProviderFailure.Unavailable, false)]
    [InlineData(503, ProviderFailure.Unavailable, false)]
    [InlineData(504, ProviderFailure.Unavailable, false)]
    [InlineData(409, ProviderFailure.IdempotencyKeyInUse, false)]
    [InlineData(400, "invalid_request", true)]
    [InlineData(404, "not_found", true)]
    [InlineData(408, "provider_error", true)] // the server never received the whole request
    [InlineData(409, "consent_required", true)]
    [InlineData(410, "subject_erased", true)]
    [InlineData(422, "unknown_consent_text_version", true)]
    [InlineData(429, "rate_limited", true)]
    public void Only_a_refusal_the_provider_itself_gave_settles_a_capture(int? status, string code, bool settles) =>
        Assert.Equal(settles, new ProviderFailure(status, code, status is null or >= 500 or 429, []).SettlesConsentCapture);

    [Theory]
    [InlineData(500)]
    [InlineData(502)]
    [InlineData(503)]
    [InlineData(504)]
    public async Task A_capture_answered_by_a_5xx_keeps_its_fence_and_is_a_retryable_failure(int status)
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnRecordConsent = () => Gateway(status);

        var result = await Launch(attempt.Id, [Assessment]);

        Assert.Equal(LaunchOutcome.ProviderUnavailable, result.Outcome);
        Assert.Equal(ProviderFailure.Unavailable, result.Detail);
        Assert.DoesNotContain("capture_ended", _repository.Writes);
        Assert.Equal((1, 1), (_repository.Captures[attempt.Id].Generation, _repository.Captures[attempt.Id].InFlight));
        Assert.False(Assert.Single(_repository.ConsentAudits).Recorded);
        Assert.DoesNotContain("launch", _provider.Calls);
    }

    // The finding's interleaving: the gateway answers 504 while the provider is still processing the capture behind it,
    // the candidate withdraws, and the provider commits the consent only after the withdrawal's first pass listed the
    // subject's consents. That pass must not complete; the pass that reads the fence stale lists the late consent,
    // withdraws it, and only then completes.
    [Fact]
    public async Task A_withdrawal_never_completes_while_a_capture_answered_504_may_still_land_and_withdraws_it_once_stale()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        var subjectId = attempt.ProviderSubjectId!.Value;
        _provider.OnRecordConsent = () => Gateway(504);

        var launch = await Launch(attempt.Id, [Assessment]);
        Assert.Equal(LaunchOutcome.ProviderUnavailable, launch.Outcome);

        _repository.WithdrawnCandidates.Add(attempt.CandidateId);
        var cascade = new ProviderConsentWithdrawalUseCase(_repository, _provider);
        var first = await cascade.StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);
        Assert.Equal(new WithdrawalPropagation(0, 1), first);
        Assert.Equal(ProviderWithdrawalStates.Pending, _repository.Attempts.Single().WithdrawalState);

        // The provider commits the capture the gateway gave up on.
        var late = new ProviderConsentRecord(Guid.NewGuid(), "assessment", "active");
        _provider.SubjectConsents[subjectId] = [late];

        _repository.DbNow += ProviderCleanup.ConsentCaptureStaleAfter + TimeSpan.FromSeconds(1);
        var sweep = await new ProviderWithdrawalSweepUseCase(_repository, cascade).RunAsync(Now, CancellationToken.None);

        Assert.Equal(1, sweep.Confirmed);
        Assert.Contains((subjectId, late.ConsentId), _provider.WithdrawnConsents);
        Assert.Equal("withdrawn", Assert.Single(_provider.SubjectConsents[subjectId]).Status);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single().WithdrawalState);
    }

    // A withdrawal staged while the capture is in flight, whose pass runs right after the 502: the launch's own re-check
    // re-runs the cascade, which must not complete either.
    [Fact]
    public async Task A_withdrawal_staged_during_a_capture_answered_502_stays_pending_after_the_launchs_own_recheck()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnRecordConsent = () =>
        {
            _repository.WithdrawnCandidates.Add(attempt.CandidateId);
            _repository.LaunchWithdrawn = true;
            return Gateway(502);
        };

        var result = await Launch(attempt.Id, [Assessment]);

        Assert.Equal(LaunchOutcome.ConsentWithdrawn, result.Outcome);
        Assert.DoesNotContain("capture_ended", _repository.Writes);
        Assert.Equal(ProviderWithdrawalStates.Pending, _repository.Attempts.Single().WithdrawalState);
        Assert.DoesNotContain("launch", _provider.Calls);
    }

    // A definitive refusal is unchanged: the fence ends at once, so a withdrawal right after it completes in one pass.
    [Theory]
    [InlineData(422, "unknown_consent_text_version", false, LaunchOutcome.ConsentRejected)]
    [InlineData(429, "rate_limited", true, LaunchOutcome.ProviderUnavailable)]
    public async Task A_definitive_refusal_still_ends_the_fence_and_never_holds_a_withdrawal(
        int status, string code, bool transient, LaunchOutcome outcome)
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnRecordConsent = () =>
            ProviderCall<ProviderConsentRecord>.Fail(new ProviderFailure(status, code, transient, []));

        var result = await Launch(attempt.Id, [Assessment]);

        Assert.Equal(outcome, result.Outcome);
        Assert.Equal(code, result.Detail);
        Assert.Contains("capture_ended", _repository.Writes);
        Assert.Equal((2, 0), (_repository.Captures[attempt.Id].Generation, _repository.Captures[attempt.Id].InFlight));

        _repository.WithdrawnCandidates.Add(attempt.CandidateId);
        var pass = await new ProviderConsentWithdrawalUseCase(_repository, _provider)
            .StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);
        Assert.Equal(new WithdrawalPropagation(1, 0), pass);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single().WithdrawalState);
    }

    // Nothing stays blocked: a retry that declines an optional purpose waits (retryable) while the 502'd capture may still
    // land, and launches once that capture is stale.
    [Fact]
    public async Task A_retry_with_a_decline_waits_out_the_unsettled_capture_and_then_launches()
    {
        var attempt = _repository.AddCreatedAttempt("english");
        _provider.OnRecordConsent = () => Gateway(502);
        Assert.Equal(LaunchOutcome.ProviderUnavailable, (await Launch(attempt.Id, [Assessment])).Outcome);
        _provider.OnRecordConsent = null;

        var waiting = await Launch(attempt.Id, [], declined: [ConsentPurposes.Voice]);
        Assert.Equal(LaunchOutcome.ProviderUnavailable, waiting.Outcome);
        Assert.Equal("consent_capture_in_flight", waiting.Detail);
        Assert.DoesNotContain("launch", _provider.Calls);

        var later = Now + ProviderCleanup.ConsentCaptureStaleAfter + TimeSpan.FromSeconds(1);
        var launched = await Launch(attempt.Id, [], later, declined: [ConsentPurposes.Voice]);
        Assert.Equal(LaunchOutcome.Launched, launched.Outcome);
    }
}
