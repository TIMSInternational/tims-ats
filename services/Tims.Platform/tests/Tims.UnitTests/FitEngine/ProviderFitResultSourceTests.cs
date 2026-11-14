using Tims.Application.Assessments.Providers;
using Tims.Application.FitEngine;
using Tims.Domain.Assessments.Providers;
using Tims.Domain.FitEngine;

namespace Tims.UnitTests.FitEngine;

/// <summary>
/// The FIT v2 adapter over the provider connector: a field-for-field copy of each provider result into FIT's
/// <see cref="InstrumentResult"/>, with three guards (only provider instruments pass, a needs-review result carries no
/// value, the source tag is always <c>provider</c>), and its place in the FIT v2 kernel.
/// </summary>
public sealed class ProviderFitResultSourceTests
{
    private static readonly Guid Org = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Candidate = Guid.Parse("ca000000-0000-0000-0000-000000000001");
    private static readonly Guid Vacancy = Guid.Parse("7ac00000-0000-0000-0000-000000000001");
    private static readonly DateTimeOffset Completed = new(2026, 11, 9, 14, 38, 0, TimeSpan.Zero);

    private static ProviderInstrumentResult Provider(
        string instrument = ProviderInstruments.Lia,
        ProviderResultIntegrity integrity = ProviderResultIntegrity.Valid,
        double? percentile = 46.2,
        string? cefr = null,
        int? level = null,
        double? normalized = null,
        string source = "provider") =>
        new(instrument, "d0000000-0000-4000-8000-000000000001", source, integrity, Completed, normalized, percentile, cefr,
            level, "content-1", "norms-1");

    [Fact]
    public void A_valid_result_is_copied_field_for_field()
    {
        var copied = ProviderFitResultSource.ToInstrumentResult(
            Provider(ProviderInstruments.Itcia, percentile: 12, cefr: "B2", level: 4));

        Assert.Equal(ProviderInstruments.Itcia, copied.Instrument);
        Assert.Equal("d0000000-0000-4000-8000-000000000001", copied.ResultId);
        Assert.Equal("provider", copied.Source);
        Assert.Equal(ResultIntegrity.Valid, copied.Integrity);
        Assert.Equal(Completed, copied.CompletedAt);
        Assert.Equal(12, copied.GlobalPercentile);
        Assert.Equal("B2", copied.Cefr);
        Assert.Equal(4, copied.Level);
        Assert.Equal("content-1", copied.ContentVersion);
        Assert.Equal("norms-1", copied.NormVersion);
    }

    [Fact]
    public void A_needs_review_result_keeps_its_identity_and_versions_but_carries_no_value()
    {
        var copied = ProviderFitResultSource.ToInstrumentResult(Provider(
            ProviderInstruments.English, ProviderResultIntegrity.NeedsReview, percentile: 50, cefr: "C1", level: 3));

        Assert.Equal(ResultIntegrity.NeedsReview, copied.Integrity);
        Assert.Null(copied.GlobalPercentile);
        Assert.Null(copied.Cefr);
        Assert.Null(copied.Level);
        Assert.Equal("d0000000-0000-4000-8000-000000000001", copied.ResultId);
        Assert.Equal("content-1", copied.ContentVersion);
    }

    [Fact]
    public void The_ats_quiz_value_and_a_foreign_source_tag_never_pass()
    {
        var copied = ProviderFitResultSource.ToInstrumentResult(Provider(normalized: 99, source: "ats"));

        Assert.Null(copied.NormalizedScore);
        Assert.Equal("provider", copied.Source);
    }

    [Theory]
    [InlineData(FitInstruments.NativeQuiz)]
    [InlineData("LIA")]
    [InlineData("disc")]
    public async Task Only_provider_instruments_pass(string instrument)
    {
        var source = new ProviderFitResultSource(new StubProviderSource(
        [
            Provider(instrument, normalized: 100),
            Provider(ProviderInstruments.English, cefr: "B2", percentile: null),
        ]));

        var results = await source.GetResultsAsync(Org, Candidate, Vacancy, CancellationToken.None);

        var english = Assert.Single(results);
        Assert.Equal(ProviderInstruments.English, english.Instrument);
    }

    [Fact]
    public async Task It_asks_the_connector_for_exactly_this_tenant_candidate_and_vacancy()
    {
        var stub = new StubProviderSource([]);

        await new ProviderFitResultSource(stub).GetResultsAsync(Org, Candidate, Vacancy, CancellationToken.None);

        Assert.Equal((Org, Candidate, Vacancy), Assert.Single(stub.Calls));
    }

    // End to end through the pure FIT v2 kernel: the provider's LIA percentile feeds the assessment dimension, and a
    // provider result awaiting review is held apart, never read as a low score.
    [Fact]
    public async Task Through_the_kernel_a_valid_lia_scores_and_a_review_lia_is_held_apart()
    {
        IReadOnlyList<AssessmentRequirement> requirements =
            [new AssessmentRequirement(FitInstruments.Lia, FitInstrumentUses.Scored, new InstrumentMinimum(40, null, null, null), null, "análisis")];
        var weights = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["assessment"] = 0.2,
            ["interview"] = 0.2,
            ["experience"] = 0.2,
            ["education"] = 0.2,
            ["languages"] = 0.2,
        };
        var fitRequirements = new FitRequirements(null, null, null);

        var valid = await new ProviderFitResultSource(new StubProviderSource([Provider(percentile: 30)]))
            .GetResultsAsync(Org, Candidate, Vacancy, CancellationToken.None);
        var review = await new ProviderFitResultSource(
                new StubProviderSource([Provider(integrity: ProviderResultIntegrity.NeedsReview, percentile: 30)]))
            .GetResultsAsync(Org, Candidate, Vacancy, CancellationToken.None);

        var scored = FitV2Kernels.Evaluate(requirements, valid, weights, fitRequirements, null);
        var held = FitV2Kernels.Evaluate(requirements, review, weights, fitRequirements, null);

        Assert.Equal(75, scored.AssessmentScore); // 30 / 40 × 100
        var entry = Assert.Single(scored.Entries);
        Assert.Equal(FitInstrumentStatuses.Completed, entry.Status);
        Assert.Equal("provider", entry.Source);
        Assert.Equal("norms-1", entry.NormVersion);
        Assert.False(scored.ReviewPending);

        Assert.Null(held.AssessmentScore);
        Assert.Equal(FitInstrumentStatuses.NeedsReview, Assert.Single(held.Entries).Status);
        Assert.True(held.ReviewPending);
    }

    private sealed class StubProviderSource(IReadOnlyList<ProviderInstrumentResult> results) : IProviderAssessmentResultSource
    {
        public List<(Guid, Guid, Guid)> Calls { get; } = [];

        public Task<IReadOnlyList<ProviderInstrumentResult>> GetResultsAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
        {
            Calls.Add((organizationId, candidateId, vacancyId));
            return Task.FromResult(results);
        }
    }
}
