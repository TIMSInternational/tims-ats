using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// Round-12 fixes at the use-case level (the SQL is pinned against Postgres in
/// Tims.IntegrationTests/Assessments/AssessmentProviderRound12Tests and FitEngine/FitV2ProviderTests):
/// <list type="bullet">
/// <item>Codex round 11 P1 (ProviderResultIntake.cs:31): a <c>result_not_visible</c> answer deletes a copy stored earlier,
/// so staff reads and FIT stop using it.</item>
/// <item>Codex round 11 P1 (create fence): each create ends only its OWN fence, so an erasure that runs while a second,
/// overlapping create of the same attempt is in flight stays incomplete instead of reporting the candidate erased.</item>
/// </list>
/// </summary>
public sealed class ProviderRound12Tests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 15, 0, 0, TimeSpan.Zero);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private ParsedProviderResult ResultFor(AttemptRow attempt, Guid resultId)
    {
        var json = ProviderResultParserTests.Result("lia", "LiaResultV1", ProviderResultParserTests.LiaScores("full", 46.2),
            ProviderResultParserTests.Summary(), "valid", null);
        json["result_id"] = resultId.ToString();
        json["assignment_id"] = attempt.ProviderAssignmentId.ToString();
        json["subject_id"] = attempt.ProviderSubjectId.ToString();
        json["vacancy"]!["external_vacancy_ref"] = attempt.VacancyId.ToString();
        return ProviderResultParserTests.Parse(json);
    }

    private Task<ResultIntake> Fetch(AttemptRow attempt, Guid resultId) =>
        ProviderResultIntake.FetchAndStoreAsync(_repository, _provider, FakeRepository.Org, _provider.TenantId, attempt, resultId,
            Now, CancellationToken.None);

    [Fact]
    public async Task A_result_no_longer_visible_deletes_the_copy_stored_before()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        var resultId = Guid.NewGuid();
        _provider.OnGetResult = id => ProviderCall<ParsedProviderResult>.Success(ResultFor(attempt, id));
        Assert.Equal(InboxStatuses.Processed, (await Fetch(attempt, resultId)).Status);
        Assert.Equal(resultId, Assert.Single(_repository.StoredResults).ResultId);

        // The tenant lowered its tenant_hr visibility: the provider now answers result_not_visible for the same result.
        _provider.OnGetResult = _ =>
            ProviderCall<ParsedProviderResult>.Fail(new ProviderFailure(403, "result_not_visible", false, []));
        var intake = await Fetch(attempt, resultId);

        Assert.Equal(new ResultIntake(InboxStatuses.Processed, "result_not_visible", false), intake);
        Assert.Contains("hide:" + resultId, _repository.Writes);
        Assert.Empty(_repository.StoredResults);
        Assert.Equal(ProviderAttemptStates.ResultReady, _repository.Attempts.Single().State);
    }

    [Fact]
    public async Task An_overlapping_create_keeps_its_own_fence_so_an_erasure_in_between_stays_incomplete()
    {
        var assign = new AssignProviderInstrumentsUseCase(_repository, _provider);
        var input = new AssignProviderInstrumentsInput(FakeRepository.Candidate, FakeRepository.Vacancy,
            [new AssignInstrumentItem("lia", null)], null, 1m, [], null, ProviderAgeBands.Adult);
        ProviderErasureResult? during = null;
        var creates = 0;
        _provider.OnCreateAssignment = request =>
        {
            if (++creates == 1)
            {
                // While THIS create is in flight, a second assign of the same attempt (a double submit) runs to the end
                // and records its answer; then an erasure runs. This first create may still create a provider subject.
                var second = assign.AssignAsync(FakeRepository.Org, Guid.NewGuid(), input, Now, CancellationToken.None)
                    .GetAwaiter().GetResult();
                Assert.Equal(ProviderAttemptStates.Created, Assert.Single(second.Response!.Items).State);
                during = new ProviderSubjectRightsUseCase(_repository, _provider)
                    .EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None)
                    .GetAwaiter().GetResult();
            }

            return FakeProvider.Created(request);
        };

        await assign.AssignAsync(FakeRepository.Org, Guid.NewGuid(), input, Now, CancellationToken.None);

        Assert.Equal(2, creates);
        Assert.NotNull(during);
        Assert.Equal(ProviderErasureOutcome.Incomplete, during.Outcome);
        // The first create's answer named another assignment than the one recorded: its fence stays (unanswered), so
        // the next export or erasure resolves the candidate's subject by external_ref again.
        var attempt = _repository.Attempts.Single();
        Assert.Single(_repository.CreateFences[attempt.Id]);
        var facts = await _repository.ListProviderSubjectsAsync(FakeRepository.Org, FakeRepository.Candidate, CancellationToken.None);
        Assert.True(facts!.NeedsResolution);
    }

    [Fact]
    public async Task A_definitive_refusal_ends_only_its_own_create_fence()
    {
        var assign = new AssignProviderInstrumentsUseCase(_repository, _provider);
        var input = new AssignProviderInstrumentsInput(FakeRepository.Candidate, FakeRepository.Vacancy,
            [new AssignInstrumentItem("lia", null)], null, 1m, [], null, ProviderAgeBands.Adult);
        _repository.AfterReserve = () =>
        {
            // Another create of the same attempt is already in flight (announced, not answered).
            var other = _repository.Attempts.Single();
            _repository.BeginCreateAsync(FakeRepository.Org, other.Id, CancellationToken.None).GetAwaiter().GetResult();
            _repository.DbNow += TimeSpan.FromSeconds(1);
        };
        _provider.OnCreateAssignment = _ =>
            ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(422, "validation_failed", false, []));

        await assign.AssignAsync(FakeRepository.Org, Guid.NewGuid(), input, Now, CancellationToken.None);

        var attempt = _repository.Attempts.Single();
        Assert.Equal(ProviderAttemptStates.Cancelled, attempt.State);
        Assert.Single(_repository.CreateFences[attempt.Id]); // the other create's fence is untouched
    }

    // ── The ATS notice acknowledgment (round 12: it was "not recorded; needs counsel text") ──

    private Task<LaunchResult> Launch(AttemptRow attempt, NoticeAcknowledgment? notice, params CapturedConsent[] consents) =>
        new LaunchProviderAttemptUseCase(_repository, _provider)
            .LaunchAsync(attempt.Id, "ana@example.com", consents, Now, CancellationToken.None, notice: notice);

    [Fact]
    public async Task A_sitting_not_started_launches_only_with_the_current_notice_and_records_it_first()
    {
        var attempt = _repository.AddCreatedAttempt("lia");

        var result = await Launch(attempt, new NoticeAcknowledgment(AtsNotice.CurrentVersion, "en"),
            new CapturedConsent("assessment", "2026-11-09-assessment-v1", "en"));

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Equal([(attempt.Id, AtsNotice.CurrentVersion, "en")], _repository.NoticeAcknowledgments);
        // On record before any consent is captured or anything is launched.
        Assert.True(_repository.Writes.IndexOf("notice:" + AtsNotice.CurrentVersion) < _repository.Writes.IndexOf("launched"));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("2026-01-01-ats-notice-v0", "es")]
    [InlineData(AtsNotice.CurrentVersion, "fr")]
    public async Task A_sitting_not_started_without_the_current_notice_is_refused_and_nothing_is_sent(string? version, string? locale)
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        var notice = version is null ? null : new NoticeAcknowledgment(version, locale!);

        var result = await Launch(attempt, notice, new CapturedConsent("assessment", "2026-11-09-assessment-v1", "es"));

        Assert.Equal(LaunchOutcome.NoticeRequired, result.Outcome);
        Assert.Empty(_repository.NoticeAcknowledgments);
        Assert.Empty(_provider.Calls);
        Assert.Empty(_repository.ConsentAudits);
    }

    [Fact]
    public async Task A_sitting_in_progress_resumes_without_the_notice()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);

        var result = await Launch(attempt, null);

        Assert.Equal(LaunchOutcome.Launched, result.Outcome);
        Assert.Empty(_repository.NoticeAcknowledgments);
    }
}

