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

    // Codex release round 2 [P2]: a pass took the oldest 50 pending attempts and a failure left their order unchanged, so
    // 50 attempts that keep failing were re-selected by every sweep and a healthy attempt behind them never completed.
    [Fact]
    public async Task A_batch_that_keeps_failing_never_starves_a_healthy_withdrawal_behind_it()
    {
        var failing = new HashSet<Guid>();
        for (var i = 0; i < ProviderConsentWithdrawalUseCase.MaxAttemptsPerPass; i++)
        {
            failing.Add(_repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed).ProviderSubjectId!.Value);
        }

        var healthy = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        _repository.WithdrawnCandidates.Add(FakeRepository.Candidate);
        await _repository.StageConsentWithdrawalAsync(FakeRepository.Org, FakeRepository.Candidate, Now, CancellationToken.None);
        _provider.OnListConsents = subject => failing.Contains(subject)
            ? ProviderCall<IReadOnlyList<ProviderConsentRecord>>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true))
            : ProviderCall<IReadOnlyList<ProviderConsentRecord>>.Success([]);

        var first = await Sweep.RunAsync(Now, CancellationToken.None);   // the 50 oldest: all blocked, sent to the back
        var second = await Sweep.RunAsync(Now, CancellationToken.None);  // the healthy one is reached

        Assert.Equal(0, first.Confirmed);
        Assert.Equal(1, second.Confirmed);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single(a => a.Id == healthy.Id).WithdrawalState);
        Assert.Equal(ProviderConsentWithdrawalUseCase.MaxAttemptsPerPass, _repository.Attempts.Count(a => a.WithdrawalState == ProviderWithdrawalStates.Pending));
    }

    // Codex ATS r3 P1: provider calls slow enough to spend the pass budget cut the whole pass off before it completed or
    // deferred anything, so every sweep claimed the same oldest batch again and a healthy withdrawal behind it never
    // completed. Both ways a budget ends a call: a slow transient failure, and the call cancelled by the budget.
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_batch_that_spends_the_pass_budget_never_starves_a_healthy_withdrawal_behind_it(bool callThrows)
    {
        var slow = new HashSet<Guid>();
        for (var i = 0; i < ProviderConsentWithdrawalUseCase.MaxAttemptsPerPass; i++)
        {
            slow.Add(_repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed).ProviderSubjectId!.Value);
        }

        var healthy = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        _repository.WithdrawnCandidates.Add(FakeRepository.Candidate);
        await _repository.StageConsentWithdrawalAsync(FakeRepository.Org, FakeRepository.Candidate, Now, CancellationToken.None);
        // Wall-clock budget. It was 60 ms, and on a loaded CI runner the second pass's claim plus its one cheap call
        // overran it (the healthy withdrawal was then deferred, not completed). 1 s keeps the same shape with room for
        // runner pauses: the 50 transient failures (40 ms each, 2 s) or the first thrown call (2 s) still spend it.
        var budget = TimeSpan.FromSeconds(1);
        _provider.OnListConsents = subject =>
        {
            if (!slow.Contains(subject))
            {
                return ProviderCall<IReadOnlyList<ProviderConsentRecord>>.Success([]);
            }

            Thread.Sleep(callThrows ? budget * 2 : TimeSpan.FromMilliseconds(40));
            return callThrows
                ? throw new TaskCanceledException("cancelled by the pass budget")
                : ProviderCall<IReadOnlyList<ProviderConsentRecord>>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));
        };
        var sweep = new ProviderWithdrawalSweepUseCase(_repository, new ProviderConsentWithdrawalUseCase(_repository, _provider, budget));

        var first = await sweep.RunAsync(Now, CancellationToken.None);   // spends its budget on the 50 oldest
        var second = await sweep.RunAsync(Now, CancellationToken.None);  // the healthy one is reached and completed

        Assert.Equal(0, first.Confirmed);
        Assert.Contains("withdrawal_deferred:" + ProviderConsentWithdrawalUseCase.MaxAttemptsPerPass, _repository.Writes);
        Assert.Equal(1, second.Confirmed);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single(a => a.Id == healthy.Id).WithdrawalState);
        Assert.Empty(_repository.WithdrawalLeases);
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
