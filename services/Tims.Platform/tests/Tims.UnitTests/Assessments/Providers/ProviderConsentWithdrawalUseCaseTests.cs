using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>Owner default D15: the #312 withdrawal reaches the provider, and ATS-initiated DSAR erasure.</summary>
public sealed class ProviderConsentWithdrawalUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 15, 0, 0, TimeSpan.Zero);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private ProviderConsentWithdrawalUseCase UseCase => new(_repository, _provider);

    private AttemptRow Staged(string state)
    {
        var attempt = _repository.AddCreatedAttempt("lia", state);
        _repository.WithdrawnCandidates.Add(attempt.CandidateId);
        return attempt;
    }

    [Fact]
    public async Task An_open_assignment_is_cancelled_and_every_active_consent_withdrawn_before_it_is_done()
    {
        var attempt = Staged(ProviderAttemptStates.Launched);
        var active = new ProviderConsentRecord(Guid.NewGuid(), "assessment", "active");
        var old = new ProviderConsentRecord(Guid.NewGuid(), "biometric", "withdrawn");
        _provider.SubjectConsents[attempt.ProviderSubjectId!.Value] = [active, old];

        var outcome = await UseCase.StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);

        Assert.Equal(new WithdrawalPropagation(1, 0), outcome);
        Assert.Equal([attempt.ProviderAssignmentId!.Value], _provider.Cancelled);
        Assert.Equal([(attempt.ProviderSubjectId.Value, active.ConsentId)], _provider.WithdrawnConsents);
        var row = _repository.Attempts.Single();
        Assert.Equal(ProviderAttemptStates.Cancelled, row.State);
        Assert.Equal(ProviderWithdrawalStates.Done, row.WithdrawalState);
    }

    [Fact]
    public async Task A_failed_cancel_keeps_the_attempt_pending_with_its_marker()
    {
        var attempt = Staged(ProviderAttemptStates.InProgress);
        _provider.OnCancelAssignment = _ => ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        var outcome = await UseCase.StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);

        Assert.Equal(new WithdrawalPropagation(0, 1), outcome);
        var row = _repository.Attempts.Single();
        Assert.Equal(ProviderWithdrawalStates.Pending, row.WithdrawalState);
        Assert.Equal(ProviderCleanup.CancelPending, row.LastErrorCode);
    }

    [Fact]
    public async Task A_failed_consent_withdrawal_keeps_the_attempt_pending()
    {
        var attempt = Staged(ProviderAttemptStates.Completed);
        _provider.SubjectConsents[attempt.ProviderSubjectId!.Value] = [new ProviderConsentRecord(Guid.NewGuid(), "assessment", "active")];
        _provider.OnWithdrawConsent = _ => ProviderCall<ProviderConsentRecord>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        var outcome = await UseCase.StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);

        Assert.Equal(0, outcome.Confirmed);
        Assert.Equal(ProviderWithdrawalStates.Pending, _repository.Attempts.Single().WithdrawalState);
        Assert.Equal(ProviderAttemptStates.Completed, _repository.Attempts.Single().State); // a finished sitting is not cancelled
    }

    [Fact]
    public async Task A_create_answered_after_the_withdrawal_is_found_by_lookup_and_cancelled_at_the_provider()
    {
        // The attempt was pending_create when the candidate withdrew; its create did land at the provider.
        var assign = new AssignProviderInstrumentsUseCase(_repository, _provider);
        _provider.OnCreateAssignment = request =>
        {
            _provider.ByExternalRef[request.ExternalRef] = FakeProvider.Created(request).Value!;
            return ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));
        };
        await assign.AssignAsync(FakeRepository.Org, Guid.NewGuid(),
            new AssignProviderInstrumentsInput(FakeRepository.Candidate, FakeRepository.Vacancy,
                [new AssignInstrumentItem("lia", null)], null, 1m, [], null), Now, CancellationToken.None);
        _repository.WithdrawnCandidates.Add(FakeRepository.Candidate);

        var outcome = await UseCase.StageAndPropagateAsync(FakeRepository.Org, FakeRepository.Candidate, Now, CancellationToken.None);

        var row = _repository.Attempts.Single();
        var orphan = _provider.ByExternalRef[row.Id.ToString()];
        Assert.Equal([orphan.AssignmentId], _provider.Cancelled);
        Assert.Equal(orphan.AssignmentId, row.ProviderAssignmentId);
        Assert.Equal(ProviderWithdrawalStates.Done, row.WithdrawalState);
        Assert.Equal(1, outcome.Confirmed);
    }

    [Fact]
    public async Task A_candidate_who_did_not_withdraw_is_never_staged()
    {
        _repository.AddCreatedAttempt("lia");

        var outcome = await UseCase.StageAndPropagateAsync(FakeRepository.Org, FakeRepository.Candidate, Now, CancellationToken.None);

        Assert.Equal(new WithdrawalPropagation(0, 0), outcome);
        Assert.Null(_repository.Attempts.Single().WithdrawalState);
        Assert.Empty(_provider.Calls);
    }

    // ---- ATS-initiated erasure (DELETE /v1/subjects/{id}) ---------------------------------------------------------

    private ProviderSubjectRightsUseCase Rights => new(_repository, _provider);

    [Fact]
    public async Task Erasure_asks_the_provider_to_erase_every_subject_and_records_each_accepted_request()
    {
        var first = _repository.AddCreatedAttempt("lia");
        var second = _repository.AddCreatedAttempt("english");

        var result = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(new ProviderErasureResult(ProviderErasureOutcome.Requested, 2, 2), result);
        Assert.Equal([first.ProviderSubjectId!.Value, second.ProviderSubjectId!.Value], _provider.ErasedSubjects);
        Assert.All(_repository.Attempts, a => Assert.Equal(Now, a.ErasureRequestedAt));
    }

    [Fact]
    public async Task An_erasure_the_provider_could_not_take_is_incomplete_and_not_recorded()
    {
        _repository.AddCreatedAttempt("lia");
        _provider.OnEraseSubject = _ => ProviderCall<ProviderErasureReceipt>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        var result = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.Incomplete, result.Outcome);
        Assert.Null(_repository.Attempts.Single().ErasureRequestedAt);
    }

    [Fact]
    public async Task An_already_erased_subject_counts_as_requested()
    {
        _repository.AddCreatedAttempt("lia");
        _provider.OnEraseSubject = _ => ProviderCall<ProviderErasureReceipt>.Fail(new ProviderFailure(410, "subject_erased", false, []));

        var result = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.Requested, result.Outcome);
        Assert.Contains("erasure_requested:already_erased", _repository.Writes);
    }

    [Fact]
    public async Task An_unknown_candidate_is_not_found_and_nothing_is_sent()
    {
        var result = await Rights.EraseAsync(FakeRepository.Org, Guid.NewGuid(), Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.CandidateNotFound, result.Outcome);
        Assert.Empty(_provider.Calls);
    }
}
