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

    // Codex release review, round 2 [P1]: a pass lists no active consent; a launch that announced its capture before the
    // withdrawal stores one after that listing. The pass must not complete the attempt, so a later pass withdraws it.
    [Fact]
    public async Task A_consent_capture_in_flight_keeps_the_attempt_pending_and_a_later_pass_withdraws_its_consent()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        var subject = attempt.ProviderSubjectId!.Value;
        Assert.True(await _repository.BeginConsentCaptureAsync(FakeRepository.Org, attempt.Id, Now, CancellationToken.None));
        _repository.WithdrawnCandidates.Add(attempt.CandidateId);
        _provider.OnListConsents = id =>
        {
            // The listing runs before the capture lands; the capture lands right after it.
            _provider.OnListConsents = null;
            var snapshot = ProviderCall<IReadOnlyList<ProviderConsentRecord>>.Success([]);
            _provider.SubjectConsents[subject] = [new ProviderConsentRecord(Guid.NewGuid(), "assessment", "active")];
            return snapshot;
        };

        var first = await UseCase.StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);

        Assert.Equal(new WithdrawalPropagation(0, 1), first);
        Assert.Equal(ProviderWithdrawalStates.Pending, _repository.Attempts.Single().WithdrawalState);
        Assert.Equal("active", Assert.Single(_provider.SubjectConsents[subject]).Status);

        // The launch gets the provider's answer and ends its capture; the next pass completes the cascade.
        await _repository.EndConsentCaptureAsync(FakeRepository.Org, attempt.Id, Now, CancellationToken.None);
        var second = await UseCase.PropagateAsync(FakeRepository.Org, Now, CancellationToken.None);

        Assert.Equal(new WithdrawalPropagation(1, 0), second);
        Assert.Equal("withdrawn", Assert.Single(_provider.SubjectConsents[subject]).Status);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single().WithdrawalState);
    }

    // The fence must be read BEFORE the listing: a capture that lands after the listing and ends before a later fence
    // read would look finished to that read, and the cascade would complete without its consent.
    [Fact]
    public async Task A_capture_that_lands_and_ends_during_the_listing_keeps_the_attempt_pending()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        var subject = attempt.ProviderSubjectId!.Value;
        Assert.True(await _repository.BeginConsentCaptureAsync(FakeRepository.Org, attempt.Id, Now, CancellationToken.None));
        _repository.WithdrawnCandidates.Add(attempt.CandidateId);
        _provider.OnListConsents = id =>
        {
            _provider.OnListConsents = null;
            var snapshot = ProviderCall<IReadOnlyList<ProviderConsentRecord>>.Success([]);
            _provider.SubjectConsents[subject] = [new ProviderConsentRecord(Guid.NewGuid(), "assessment", "active")];
            _repository.EndConsentCaptureAsync(FakeRepository.Org, attempt.Id, Now, CancellationToken.None).GetAwaiter().GetResult();
            return snapshot;
        };

        var outcome = await UseCase.StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);

        Assert.Equal(new WithdrawalPropagation(0, 1), outcome);
        Assert.Equal(ProviderWithdrawalStates.Pending, _repository.Attempts.Single().WithdrawalState);
        Assert.Equal("active", Assert.Single(_provider.SubjectConsents[subject]).Status);
    }

    // A capture that begins or ends after the pass read its fence (here: a stale capture's launch resuming and ending it)
    // changes the generation, so the pass cannot complete on a listing that may predate that consent.
    [Fact]
    public async Task A_capture_that_ends_after_the_fence_was_read_keeps_the_attempt_pending()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        Assert.True(await _repository.BeginConsentCaptureAsync(FakeRepository.Org, attempt.Id, Now, CancellationToken.None));
        _repository.WithdrawnCandidates.Add(attempt.CandidateId);
        _repository.DbNow += ProviderCleanup.ConsentCaptureStaleAfter + TimeSpan.FromMinutes(1); // stale at the read
        _repository.AfterReadFences = () =>
            _repository.EndConsentCaptureAsync(FakeRepository.Org, attempt.Id, Now, CancellationToken.None).GetAwaiter().GetResult();

        var outcome = await UseCase.StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);

        Assert.Equal(new WithdrawalPropagation(0, 1), outcome);
        Assert.Equal(ProviderWithdrawalStates.Pending, _repository.Attempts.Single().WithdrawalState);
    }

    [Fact]
    public async Task A_capture_left_in_flight_is_completed_once_it_is_stale()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        Assert.True(await _repository.BeginConsentCaptureAsync(FakeRepository.Org, attempt.Id, Now, CancellationToken.None));
        _repository.WithdrawnCandidates.Add(attempt.CandidateId);

        var fresh = await UseCase.StageAndPropagateAsync(FakeRepository.Org, attempt.CandidateId, Now, CancellationToken.None);
        _repository.DbNow += ProviderCleanup.ConsentCaptureStaleAfter + TimeSpan.FromSeconds(1);
        var stale = await UseCase.PropagateAsync(FakeRepository.Org, Now, CancellationToken.None);

        Assert.Equal(new WithdrawalPropagation(0, 1), fresh);
        Assert.Equal(new WithdrawalPropagation(1, 0), stale);
        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single().WithdrawalState);
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
                [new AssignInstrumentItem("lia", null)], null, 1m, [], null, ProviderAgeBands.Adult), Now, CancellationToken.None);
        _repository.WithdrawnCandidates.Add(FakeRepository.Candidate);

        var outcome = await UseCase.StageAndPropagateAsync(FakeRepository.Org, FakeRepository.Candidate, Now, CancellationToken.None);

        var row = _repository.Attempts.Single();
        var orphan = _provider.ByExternalRef[row.Id.ToString()];
        Assert.Equal([orphan.AssignmentId], _provider.Cancelled);
        Assert.Equal(orphan.AssignmentId, row.ProviderAssignmentId);
        // Round 12: the create itself never recorded an answer, so its own fence stays until it is stale; finding the
        // assignment ends no create's fence. The cascade completes on the first pass after that.
        Assert.Equal(ProviderWithdrawalStates.Pending, row.WithdrawalState);
        Assert.Equal(0, outcome.Confirmed);

        _repository.DbNow += ProviderCreateFence.StaleAfter + TimeSpan.FromMinutes(1);
        var later = await UseCase.PropagateAsync(FakeRepository.Org, Now, CancellationToken.None);

        Assert.Equal(ProviderWithdrawalStates.Done, _repository.Attempts.Single().WithdrawalState);
        Assert.Equal(1, later.Confirmed);
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

        // Two recorded subjects plus the one the provider holds for (tenant, candidate id), resolved idempotently.
        Assert.Equal(new ProviderErasureResult(ProviderErasureOutcome.Requested, 3, 3), result);
        Assert.Equal([first.ProviderSubjectId!.Value, second.ProviderSubjectId!.Value, _provider.SubjectId], _provider.ErasedSubjects);
        Assert.All(_repository.Attempts, a => Assert.Equal(Now, a.ErasureRequestedAt));
    }

    [Fact]
    public async Task A_subject_created_by_a_failed_assignment_is_still_found_and_erased()
    {
        // The provider created the subject (with names and email: the org enables PCA), then the create failed. Since
        // round 10 the subject is recorded on the attempt as soon as it is resolved; a process that died before that
        // record is still covered by the erasure's own resolution of (tenant, candidate id).
        _provider.OnCreateAssignment = _ => ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));
        await new AssignProviderInstrumentsUseCase(_repository, _provider).AssignAsync(FakeRepository.Org, Guid.NewGuid(),
            new AssignProviderInstrumentsInput(FakeRepository.Candidate, FakeRepository.Vacancy,
                [new AssignInstrumentItem("lia", null)], null, 1m, [], null, ProviderAgeBands.Adult), Now, CancellationToken.None);
        Assert.Equal(_provider.SubjectId, _repository.Attempts.Single().ProviderSubjectId);
        // An outage leaves the create fence up (the provider may still act on that create); while it is live the erasure
        // stays incomplete (Codex ats-final run 2), so this runs once it is stale.
        _repository.DbNow += ProviderCreateFence.StaleAfter + TimeSpan.FromMinutes(1);

        var result = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.Requested, result.Outcome);
        Assert.Equal([_provider.SubjectId], _provider.ErasedSubjects);
        Assert.Equal(Now, _repository.Attempts.Single().ErasureRequestedAt);
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

    // Codex release review, round 3 [P1]: a subject the provider confirms it no longer holds emits no subject.erased
    // event, so the ATS's stored results for it must be erased locally at once, not left for an event that never comes.
    [Theory]
    [InlineData(410, "subject_erased")]
    [InlineData(404, "not_found")]
    public async Task A_confirmed_gone_subject_is_erased_locally_at_once(int status, string code)
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnEraseSubject = _ => ProviderCall<ProviderErasureReceipt>.Fail(new ProviderFailure(status, code, false, []));

        var result = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.Requested, result.Outcome);
        Assert.Contains(attempt.ProviderSubjectId!.Value, _repository.LocallyErasedSubjects);
        Assert.Equal(_provider.ErasedSubjects, _repository.LocallyErasedSubjects); // every subject the provider confirmed gone
    }

    // Codex ats-final run 1 [P1]: an ACCEPTED erasure used to wait for subject.erased to delete the ATS's stored results.
    // That event can be lost (its delivery exhausts its retries) and the poller skips attempts under an erasure request,
    // so the ATS kept the results indefinitely after answering 202. The local copy is now erased at once.
    [Fact]
    public async Task An_accepted_erasure_erases_the_ats_copy_at_once_without_waiting_for_subject_erased()
    {
        var attempt = _repository.AddCreatedAttempt("lia");

        var result = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.Requested, result.Outcome);
        Assert.Contains(attempt.ProviderSubjectId!.Value, _repository.LocallyErasedSubjects);
        // Every subject whose erasure the provider accepted.
        Assert.Equal(_provider.ErasedSubjects, _repository.LocallyErasedSubjects);
    }

    // Codex ats-final run 2 [P1]: the marker and the local deletion are separate transactions, so the deletion runs FIRST:
    // an interruption between them must leave the results deleted, never stored behind a marker the poller skips.
    [Fact]
    public async Task An_interruption_after_the_providers_acceptance_still_leaves_the_ats_copy_erased()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.MarkErasureRequestedFails = true;

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None));

        Assert.Contains(attempt.ProviderSubjectId!.Value, _repository.LocallyErasedSubjects);
        Assert.Null(_repository.Attempts.Single().ErasureRequestedAt); // the retry records it
    }

    // Codex ats-final run 2 [P1]: a create whose fence committed before the erasure's markers can still create a NEW
    // provider subject (the provider forgot the erased one's external_ref). Seen after the markers, it keeps the erasure
    // incomplete (503: retry) instead of reporting every subject erased.
    [Fact]
    public async Task A_create_in_flight_when_the_erasure_lands_keeps_it_incomplete()
    {
        _repository.AddCreatedAttempt("lia");
        var pending = _repository.AddCreatedAttempt("english", ProviderAttemptStates.PendingCreate);
        Assert.NotNull(await _repository.BeginCreateAsync(FakeRepository.Org, pending.Id, CancellationToken.None));

        var result = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.Incomplete, result.Outcome);
        // The create can no longer begin again: its attempt is under the erasure marker.
        Assert.Null(await _repository.BeginCreateAsync(FakeRepository.Org, pending.Id, CancellationToken.None));
    }

    // Codex ats-final run 3 [P1]: a RE-SEND of a failed create (its attempt already records subject S) begins its fence;
    // the erasure deletes S and erases the attempt; the re-send's EnsureSubject then creates S2 (the provider forgot S's
    // external_ref), which RecordSubjectAsync never records over S. Once the fence is stale, the next erasure must still
    // resolve (tenant, candidate id) and erase S2, not report the candidate erased.
    [Fact]
    public async Task A_subject_a_resend_creates_after_the_erasure_is_resolved_and_erased_by_the_next_run()
    {
        var pending = _repository.AddCreatedAttempt("english", ProviderAttemptStates.PendingCreate);
        var first = pending.ProviderSubjectId!.Value;
        Assert.NotNull(await _repository.BeginCreateAsync(FakeRepository.Org, pending.Id, CancellationToken.None));

        var during = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);
        Assert.Equal(ProviderErasureOutcome.Incomplete, during.Outcome);
        Assert.Equal(ProviderAttemptStates.Erased, _repository.Attempts.Single().State);

        // The re-send's late EnsureSubject made S2; its process died before any answer, so the fence goes stale.
        var late = Guid.NewGuid();
        _provider.SubjectId = late;
        _repository.DbNow += ProviderCreateFence.StaleAfter + TimeSpan.FromMinutes(1);

        var after = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.Requested, after.Outcome);
        Assert.Contains(first, _provider.ErasedSubjects);
        Assert.Contains(late, _provider.ErasedSubjects);
    }

    [Fact]
    public async Task A_create_fence_gone_stale_without_a_recorded_subject_is_resolved_and_erased_on_retry()
    {
        var pending = _repository.AddCreatedAttempt("english", ProviderAttemptStates.PendingCreate);
        _repository.Replace(pending.Id, a => a with { ProviderSubjectId = null, ErasureRequestedAt = Now });
        _repository.CreateFences[pending.Id] = [_repository.DbNow - ProviderCreateFence.StaleAfter - TimeSpan.FromMinutes(1)];

        var result = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        // The dead create may have made a subject no attempt names: resolved by (tenant, candidate id) and erased.
        Assert.Equal(ProviderErasureOutcome.Requested, result.Outcome);
        Assert.Contains("subject", _provider.Calls);
        Assert.Equal([_provider.SubjectId], _provider.ErasedSubjects);
    }

    [Fact]
    public async Task An_erasure_the_provider_did_not_accept_erases_nothing_locally()
    {
        _repository.AddCreatedAttempt("lia");
        _provider.OnEraseSubject = _ => ProviderCall<ProviderErasureReceipt>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Empty(_repository.LocallyErasedSubjects);
    }

    [Fact]
    public async Task An_unknown_candidate_is_not_found_and_nothing_is_sent()
    {
        var result = await Rights.EraseAsync(FakeRepository.Org, Guid.NewGuid(), Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.CandidateNotFound, result.Outcome);
        Assert.Empty(_provider.Calls);
    }

    [Fact]
    public async Task A_staff_cancel_left_unconfirmed_is_confirmed_by_the_cascade_and_never_holds_it_forever()
    {
        // Codex ATS P1: a staff cancel whose lookup failed carries the cleanup marker with no ids. The cascade's own
        // definitive lookup (no create in flight) confirms it; otherwise the marker would keep the withdrawal pending.
        var row = new AttemptRow(Guid.NewGuid(), FakeRepository.Org, FakeRepository.Candidate, FakeRepository.Vacancy, "lia",
            ProviderAttemptStates.Cancelled, "Razón válida", "es", 1m, [], null, null, null, "1.0", null, [], null,
            ProviderCleanup.CancelPending, false, WithdrawalState: ProviderWithdrawalStates.Pending);
        _repository.Attempts.Add(row);

        var outcome = await UseCase.PropagateAsync(FakeRepository.Org, Now, CancellationToken.None);

        Assert.Equal(1, outcome.Confirmed);
        var after = _repository.Attempts.Single();
        Assert.Null(after.LastErrorCode);
        Assert.Equal(ProviderWithdrawalStates.Done, after.WithdrawalState);
    }
}
