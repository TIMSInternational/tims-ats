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

    [Fact]
    public async Task An_export_still_resolves_while_the_candidate_has_an_attempt_no_erasure_touched()
    {
        ErasedAttemptWithStaleFence();
        _repository.AddCreatedAttempt("lia"); // a later, live assignment: its subject is the candidate's current one

        var result = await Rights.ExportAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

        Assert.Equal(ProviderExportOutcome.Exported, result.Outcome);
        Assert.Contains("subject", _provider.Calls);
    }
}
