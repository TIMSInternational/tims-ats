using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// Codex ats round 13 [P2]: an unanswered create fence on an erased attempt is never ended (only a new create prunes
/// stale fences, and creates are refused under an erasure request), so it used to make EVERY later DSAR export POST
/// /v1/subjects for (tenant, candidate id). The provider forgot that external_ref at the erasure request; past its 24 h
/// idempotency window the POST creates a fresh subject for an erased person, which the export then reported as held data.
/// Now an export never resolves in that state (it is Incomplete), and a complete erasure retires the fences that were
/// already stale before it resolved, so resolution happens once.
/// </summary>
public sealed class ProviderSubjectRightsRound13Tests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 10, 0, 0, TimeSpan.Zero);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private ProviderSubjectRightsUseCase Rights => new(_repository, _provider);

    /// <summary>An erased attempt whose create never answered, with its fence gone stale.</summary>
    private AttemptRow ErasedAttemptWithStaleFence()
    {
        var attempt = _repository.AddCreatedAttempt("english", ProviderAttemptStates.PendingCreate);
        _repository.Replace(attempt.Id, a => a with { State = ProviderAttemptStates.Erased, ErasureRequestedAt = Now.AddDays(-3) });
        _repository.CreateFences[attempt.Id] = [_repository.DbNow - ProviderCreateFence.StaleAfter - TimeSpan.FromMinutes(1)];
        return attempt;
    }

    [Fact]
    public async Task An_export_never_posts_a_subject_when_only_an_erased_attempts_unanswered_create_calls_for_it()
    {
        ErasedAttemptWithStaleFence();

        var result = await Rights.ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderExportOutcome.Incomplete, result.Outcome);
        Assert.Null(result.Export);
        Assert.DoesNotContain("subject", _provider.Calls); // no POST /v1/subjects: it could create a new subject
        Assert.Empty(_provider.ExportedSubjects);
    }

    [Fact]
    public async Task A_complete_erasure_retires_the_stale_fence_so_later_exports_and_erasures_never_resolve_again()
    {
        var attempt = ErasedAttemptWithStaleFence();

        var erase = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        // The dead create's possible subject is resolved once and erased, then its fence is retired.
        Assert.Equal(ProviderErasureOutcome.Requested, erase.Outcome);
        Assert.Equal(1, _provider.Calls.Count(c => c == "subject"));
        Assert.Contains(_provider.SubjectId, _provider.ErasedSubjects);
        Assert.Empty(_repository.CreateFences[attempt.Id]);
        Assert.Contains("fences_retired:1", _repository.Writes);

        // Days later, past the provider's idempotency window: neither path posts a subject again.
        _repository.DbNow += TimeSpan.FromDays(2);
        _provider.Calls.Clear();
        var export = await Rights.ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);
        var again = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderExportOutcome.Exported, export.Outcome);
        Assert.Equal(ProviderErasureOutcome.Requested, again.Outcome);
        Assert.DoesNotContain("subject", _provider.Calls);
    }

    [Fact]
    public async Task An_incomplete_erasure_keeps_the_fence_so_the_retry_still_resolves()
    {
        var attempt = ErasedAttemptWithStaleFence();
        _provider.OnEraseSubject = _ => ProviderCall<ProviderErasureReceipt>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        var erase = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.Incomplete, erase.Outcome);
        Assert.Single(_repository.CreateFences[attempt.Id]);
        Assert.DoesNotContain(_repository.Writes, w => w.StartsWith("fences_retired", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_live_fence_is_never_retired_and_keeps_the_erasure_incomplete()
    {
        _repository.AddCreatedAttempt("lia");
        var pending = _repository.AddCreatedAttempt("english", ProviderAttemptStates.PendingCreate);
        Assert.NotNull(await _repository.BeginCreateAsync(FakeRepository.Org, pending.Id, CancellationToken.None));

        var erase = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.Incomplete, erase.Outcome);
        Assert.Single(_repository.CreateFences[pending.Id]);
    }

    // Codex ats round 13 run 2 [P2]: subject.erased is in the inbox but its worker has not erased the attempt yet. The
    // attempt still reads as live, so the export used to POST /v1/subjects, which past the idempotency window creates a
    // NEW subject for the erased person. A subject the provider confirmed erased is a stored erasure: no resolution.
    [Fact]
    public async Task An_export_or_erasure_never_posts_a_subject_for_an_attempt_whose_subject_the_provider_erased()
    {
        var attempt = _repository.AddCreatedAttempt("english", ProviderAttemptStates.ResultReady);
        _repository.ErasedSubjects.Add(attempt.ProviderSubjectId!.Value); // the tombstone, the attempt untouched

        var export = await Rights.ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);
        var erase = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderExportOutcome.Exported, export.Outcome);
        Assert.Empty(_provider.ExportedSubjects); // an erased subject is never exported
        Assert.Equal(ProviderErasureOutcome.Requested, erase.Outcome);
        Assert.DoesNotContain("subject", _provider.Calls);
    }

    // Codex ats round 13 run 3 [P1]: the provider erased the subject itself and its subject.erased was lost, so the ATS
    // still reads the attempt as live. The export used to POST /v1/subjects, which past the idempotency window creates a
    // new subject for the erased person. It now reads the recorded subject, which answers for itself (410: erased).
    [Fact]
    public async Task An_export_of_a_live_attempt_never_posts_a_subject_and_lists_one_erased_at_the_provider_as_erased()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.ResultReady);
        _provider.OnExportSubject = _ =>
            ProviderCall<ProviderHeldExport>.Fail(new ProviderFailure(410, "subject_erased", false, []));

        var result = await Rights.ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderExportOutcome.Exported, result.Outcome);
        var held = Assert.Single(result.Export!.ProviderExports);
        Assert.Equal((attempt.ProviderSubjectId!.Value, "erased"), (held.SubjectId, held.Status));
        Assert.DoesNotContain("subject", _provider.Calls);
    }

    // An unanswered create beside a live attempt whose subject the provider still holds: that subject IS the candidate's
    // one for (tenant, external_ref), so no other can exist and nothing is POSTed.
    [Fact]
    public async Task An_unanswered_create_beside_a_held_live_subject_needs_no_post()
    {
        var live = _repository.AddCreatedAttempt("lia");
        var pending = _repository.AddCreatedAttempt("english", ProviderAttemptStates.PendingCreate);
        Assert.NotNull(await _repository.BeginCreateAsync(FakeRepository.Org, pending.Id, CancellationToken.None));

        var result = await Rights.ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderExportOutcome.Exported, result.Outcome);
        Assert.Contains(live.ProviderSubjectId!.Value, _provider.ExportedSubjects);
        Assert.DoesNotContain("subject", _provider.Calls);
    }

    // The provider erased the live attempt's subject (410; its webhook lost) and a create is unanswered: a POST could
    // create a new subject for the erased person, and only a POST could find another, so the export is Incomplete.
    [Fact]
    public async Task An_unanswered_create_after_the_provider_erased_the_live_subject_makes_the_export_incomplete()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.CreateFences[attempt.Id] = [_repository.DbNow];
        _provider.OnExportSubject = _ =>
            ProviderCall<ProviderHeldExport>.Fail(new ProviderFailure(410, "subject_erased", false, []));

        var result = await Rights.ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderExportOutcome.Incomplete, result.Outcome);
        Assert.DoesNotContain("subject", _provider.Calls);
    }

    // A create that crashed before recording any subject: a live attempt with none, and no subject was ever recorded for
    // the candidate. The POST is the only way to find what the provider may hold (possibly names and email), and the
    // assignment needs that subject anyway, so the export resolves and exports it.
    [Fact]
    public async Task A_create_that_crashed_before_recording_a_subject_is_resolved_and_exported()
    {
        var pending = _repository.AddCreatedAttempt("english", ProviderAttemptStates.PendingCreate);
        _repository.Replace(pending.Id, a => a with { ProviderSubjectId = null });
        _repository.CreateFences[pending.Id] = [_repository.DbNow - ProviderCreateFence.StaleAfter - TimeSpan.FromMinutes(1)];

        var result = await Rights.ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderExportOutcome.Exported, result.Outcome);
        Assert.Contains("subject", _provider.Calls);
        Assert.Equal([_provider.SubjectId], _provider.ExportedSubjects);
    }

    // A subject the provider still holds under an erasure REQUEST no longer stands for (tenant, external_ref): the
    // provider forgot that link at the request. So it does not stop the resolution a crashed live create calls for.
    [Fact]
    public async Task A_held_subject_under_an_erasure_request_does_not_stand_for_the_candidates_current_subject()
    {
        var old = _repository.AddCreatedAttempt("lia");
        _repository.Replace(old.Id, a => a with { ErasureRequestedAt = Now.AddDays(-3) });
        var pending = _repository.AddCreatedAttempt("english", ProviderAttemptStates.PendingCreate);
        _repository.Replace(pending.Id, a => a with { ProviderSubjectId = null });
        _repository.CreateFences[pending.Id] = [_repository.DbNow];

        var result = await Rights.ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderExportOutcome.Exported, result.Outcome);
        Assert.Contains("subject", _provider.Calls);
        Assert.Equal([old.ProviderSubjectId!.Value, _provider.SubjectId], _provider.ExportedSubjects);
    }

    // The erasure still resolves by (tenant, candidate id) while a live attempt exists: it erases whatever it finds.
    [Fact]
    public async Task An_erasure_still_resolves_while_the_candidate_has_a_live_attempt()
    {
        _repository.AddCreatedAttempt("lia");

        var erase = await Rights.EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderErasureOutcome.Requested, erase.Outcome);
        Assert.Contains("subject", _provider.Calls);
    }
}
