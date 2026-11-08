using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// Codex release review, round 3 [P1]: the #312 cascade had no retry of its own. A pending attempt waited for a webhook
/// or another withdrawal, and a completed assignment never emits one. The sweep retries without any trigger.
/// </summary>
public sealed class ProviderWithdrawalSweepUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 16, 0, 0, TimeSpan.Zero);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private ProviderConsentWithdrawalUseCase Cascade => new(_repository, _provider);

    private ProviderWithdrawalSweepUseCase Sweep => new(_repository, Cascade);

    [Fact]
    public async Task An_attempt_left_pending_by_an_outage_is_completed_by_the_sweep_without_any_other_trigger()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        var subject = attempt.ProviderSubjectId!.Value;
        _provider.SubjectConsents[subject] = [new ProviderConsentRecord(Guid.NewGuid(), "assessment", "active")];
        _repository.WithdrawnCandidates.Add(attempt.CandidateId);
        _provider.OnWithdrawConsent = _ => ProviderCall<ProviderConsentRecord>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));
        await Cascade.StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);
        Assert.Equal(ProviderWithdrawalStates.Pending, _repository.Attempts.Single().WithdrawalState);

        _provider.OnWithdrawConsent = null; // the provider is back; nothing else happens (no webhook, no withdrawal)
        var outcome = await Sweep.RunAsync(Now, CancellationToken.None);

        Assert.Equal(new WithdrawalSweep(1, 1, 0), outcome);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single().WithdrawalState);
        Assert.Equal("withdrawn", Assert.Single(_provider.SubjectConsents[subject]).Status);
    }

    [Fact]
    public async Task More_pending_attempts_than_one_pass_takes_are_all_completed_in_one_sweep()
    {
        for (var i = 0; i < 120; i++)
        {
            _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        }

        _repository.WithdrawnCandidates.Add(FakeRepository.Candidate);
        await _repository.StageConsentWithdrawalAsync(FakeRepository.Org, FakeRepository.Candidate, Now, CancellationToken.None);

        var outcome = await Sweep.RunAsync(Now, CancellationToken.None);

        Assert.Equal(new WithdrawalSweep(1, 120, 0), outcome);
        Assert.All(_repository.Attempts, a => Assert.Equal(ProviderWithdrawalStates.Done, a.WithdrawalState));
        Assert.Equal(4, _repository.PendingListings); // 50 + 50 + 20, then an empty pass
    }

    [Fact]
    public async Task A_blocked_pass_is_not_repeated_within_one_sweep()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        _provider.SubjectConsents[attempt.ProviderSubjectId!.Value] = [new ProviderConsentRecord(Guid.NewGuid(), "assessment", "active")];
        _repository.WithdrawnCandidates.Add(attempt.CandidateId);
        await _repository.StageConsentWithdrawalAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);
        _provider.OnWithdrawConsent = _ => ProviderCall<ProviderConsentRecord>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        var outcome = await Sweep.RunAsync(Now, CancellationToken.None);

        Assert.Equal(new WithdrawalSweep(1, 0, 0), outcome);
        Assert.Equal(1, _repository.PendingListings);
        Assert.Equal(ProviderWithdrawalStates.Pending, _repository.Attempts.Single().WithdrawalState);
    }

    [Fact]
    public async Task A_failing_organization_does_not_stop_the_others()
    {
        var failing = Guid.Parse("99999999-9999-9999-9999-999999999999");
        _repository.ExtraPendingOrganizations.Add(failing);
        _repository.FailingOrganization = failing;
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        _repository.WithdrawnCandidates.Add(attempt.CandidateId);
        await _repository.StageConsentWithdrawalAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);

        var outcome = await Sweep.RunAsync(Now, CancellationToken.None);

        Assert.Equal(new WithdrawalSweep(2, 1, 1), outcome);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single().WithdrawalState);
    }

    [Fact]
    public async Task Cancellation_stops_the_sweep_instead_of_being_counted_as_a_failure()
    {
        _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        _repository.WithdrawnCandidates.Add(FakeRepository.Candidate);
        await _repository.StageConsentWithdrawalAsync(FakeRepository.Org, FakeRepository.Candidate, Now, CancellationToken.None);
        using var cts = new CancellationTokenSource();
        _provider.OnListConsents = _ =>
        {
            cts.Cancel();
            throw new OperationCanceledException(cts.Token);
        };

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Sweep.RunAsync(Now, cts.Token));
    }
}
