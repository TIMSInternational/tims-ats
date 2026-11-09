using Tims.Application.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// D15 DSAR access includes what the PROVIDER holds: each of the candidate's provider subjects is exported with
/// <c>GET /v1/subjects/{id}/export</c>, and the whole export fails closed (nothing returned or audited) when any of them
/// cannot be read. Only a confirmed absence (410, or a 404 the client confirmed) is an answer.
/// </summary>
public sealed class ProviderSubjectExportUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 14, 0, 0, TimeSpan.Zero);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private Task<ProviderSubjectExportResult> Export(Guid? candidate = null) => new ProviderSubjectRightsUseCase(_repository, _provider)
        .ExportAsync(FakeRepository.Org, candidate ?? FakeRepository.Candidate, Guid.NewGuid(), Now, CancellationToken.None);

    [Fact]
    public async Task The_export_includes_the_providers_own_export_of_every_subject_of_the_candidate()
    {
        var first = _repository.AddCreatedAttempt("lia");
        var second = _repository.AddCreatedAttempt("english");

        var result = await Export();

        Assert.Equal(ProviderExportOutcome.Exported, result.Outcome);
        // The two recorded subjects plus the one the provider resolves for (tenant, candidate id).
        Assert.Equal([first.ProviderSubjectId!.Value, second.ProviderSubjectId!.Value, _provider.SubjectId], _provider.ExportedSubjects);
        Assert.All(result.Export!.ProviderExports, held =>
        {
            Assert.Equal("exported", held.Status);
            Assert.Equal(held.SubjectId.ToString(), held.Export!.Value.GetProperty("subject").GetProperty("subject_id").GetString());
        });
        Assert.Equal([3], _repository.ExportAudits);
    }

    [Theory]
    [InlineData(null, "provider_not_found_unconfirmed", true)] // a 404 the subject lookup did not confirm
    [InlineData(503, "provider_unavailable", true)]
    [InlineData(403, "insufficient_scope", false)] // the client lacks subjects:export
    public async Task An_unreadable_provider_export_fails_the_whole_export_closed(int? status, string code, bool transient)
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnExportSubject = subject => subject == attempt.ProviderSubjectId
            ? ProviderCall<ProviderHeldExport>.Fail(new ProviderFailure(status, code, transient, []))
            : ProviderCall<ProviderHeldExport>.Success(new ProviderHeldExport(subject, FakeProvider.ExportJson(subject)));

        var result = await Export();

        Assert.Equal(new ProviderSubjectExportResult(ProviderExportOutcome.Incomplete, null), result);
        Assert.Empty(_repository.ExportAudits); // nothing returned, nothing audited
    }

    [Theory]
    [InlineData(410, "erased")]
    [InlineData(404, "not_found")]
    public async Task A_subject_the_provider_confirms_it_no_longer_holds_is_listed_without_an_export(int status, string expected)
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnExportSubject = subject => subject == attempt.ProviderSubjectId
            ? ProviderCall<ProviderHeldExport>.Fail(new ProviderFailure(status, status == 410 ? "subject_erased" : "not_found", false, []))
            : ProviderCall<ProviderHeldExport>.Success(new ProviderHeldExport(subject, FakeProvider.ExportJson(subject)));

        var result = await Export();

        Assert.Equal(ProviderExportOutcome.Exported, result.Outcome);
        var held = Assert.Single(result.Export!.ProviderExports, h => h.SubjectId == attempt.ProviderSubjectId);
        Assert.Equal((expected, (System.Text.Json.JsonElement?)null), (held.Status, held.Export));
        Assert.Equal([1], _repository.ExportAudits); // only the resolved subject was exported
    }

    [Fact]
    public async Task A_candidate_with_attempts_and_an_unconfigured_provider_is_not_exported_partially()
    {
        _repository.AddCreatedAttempt("lia");
        _provider.IsConfigured = false;

        var result = await Export();

        Assert.Equal(ProviderExportOutcome.ProviderUnconfigured, result.Outcome);
        Assert.Empty(_provider.ExportedSubjects);
        Assert.Empty(_repository.ExportAudits);
    }

    [Fact]
    public async Task A_candidate_without_attempts_is_exported_without_calling_the_provider()
    {
        var result = await Export();

        Assert.Equal(ProviderExportOutcome.Exported, result.Outcome);
        Assert.Empty(result.Export!.ProviderExports);
        Assert.Empty(_provider.Calls);
        Assert.Equal([0], _repository.ExportAudits);
    }

    [Fact]
    public async Task An_unknown_candidate_is_not_found()
    {
        var result = await Export(Guid.NewGuid());

        Assert.Equal(ProviderExportOutcome.CandidateNotFound, result.Outcome);
        Assert.Empty(_provider.Calls);
    }
}
