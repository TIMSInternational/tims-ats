using System.Text.Json.Nodes;
using Tims.Application.FitEngine;
using Tims.Domain.Access;
using Tims.Domain.FitEngine;
using Xunit;

namespace Tims.UnitTests.FitEngine;

/// <summary>
/// Owner default D6 (2026-11-08): a narrow-scoped reader sees "below minimum", never the exact level nor a derived
/// fit that reveals it. Pins the scope cut, the redaction of the entry and of the dimension it feeds, the
/// recomputed overall (from what remains) and the re-sort, simulateWeights over the redacted breakdown, and that
/// v1 rows, met minimums, English (languages only, D3) and wide-scoped readers are untouched.
/// </summary>
public sealed class FitV2VisibilityTests
{
    private static readonly Guid OrgId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid VacancyId = Guid.Parse("7ac00000-0000-0000-0000-000000000001");

    private const string Weights =
        """{"assessment":0.5,"interview":0,"experience":0.5,"education":0,"languages":0}""";

    // LIA scored, min 40, score 50 (p = 20): assessment 50, experience 100 → overall 75.
    private const string BelowLia =
        """{"assessment":50,"interview":null,"experience":100,"education":null,"languages":null,"llmJudgment":null,"fitVersion":2,"reviewPending":false,"assessments":[{"instrument":"lia","use":"scored","status":"completed","score":50,"gate":null,"min":{"globalPercentile":40}}]}""";

    private const string MetLia =
        """{"assessment":100,"interview":null,"experience":60,"education":null,"languages":null,"llmJudgment":null,"fitVersion":2,"reviewPending":false,"assessments":[{"instrument":"lia","use":"scored","status":"completed","score":100,"gate":null,"min":{"globalPercentile":40}}]}""";

    [Theory]
    [InlineData(AccessScope.Own, true)]
    [InlineData(AccessScope.Team, true)]
    [InlineData(AccessScope.Unit, true)]
    [InlineData(AccessScope.Company, false)]
    [InlineData(AccessScope.Organization, false)]
    public void OnlyCompanyAndOrganizationScopeSeeTheLevel(AccessScope scope, bool hides) =>
        Assert.Equal(hides, FitV2Visibility.HidesBelowMinimum(scope));

    [Fact]
    public void BelowMinimum_DropsTheScoreAndTheAssessmentDimension_MarksBelowMinimum()
    {
        var redacted = FitV2Visibility.RedactBelowMinimum(JsonNode.Parse(BelowLia), out var hidden)!;

        Assert.True(hidden);
        Assert.Null(redacted["assessment"]);
        var entry = redacted["assessments"]![0]!;
        Assert.Null(entry["score"]);
        Assert.True(entry["belowMinimum"]!.GetValue<bool>());
        Assert.Equal(100, redacted["experience"]!.GetValue<double>());
    }

    [Fact]
    public void MetMinimum_V1Row_AndNoMinimum_AreUntouched()
    {
        var met = JsonNode.Parse(MetLia);
        Assert.Same(met, FitV2Visibility.RedactBelowMinimum(met, out var metHidden));
        Assert.False(metHidden);

        var v1 = JsonNode.Parse("""{"assessment":12,"interview":null,"experience":null,"education":null,"languages":null,"llmJudgment":null}""");
        Assert.Same(v1, FitV2Visibility.RedactBelowMinimum(v1, out var v1Hidden));
        Assert.False(v1Hidden);

        var noMin = JsonNode.Parse("""{"assessment":40,"fitVersion":2,"assessments":[{"instrument":"native_quiz","use":"scored","score":40,"min":null}]}""");
        Assert.Same(noMin, FitV2Visibility.RedactBelowMinimum(noMin, out var noMinHidden));
        Assert.False(noMinHidden);
    }

    [Fact]
    public void EnglishBelowMinimum_HidesItsScore_ButKeepsTheAssessmentDimension()
    {
        var row = JsonNode.Parse("""{"assessment":100,"languages":0,"fitVersion":2,"assessments":[{"instrument":"english","use":"scored","score":50,"min":{"cefr":"B2"}},{"instrument":"lia","use":"scored","score":100,"min":{"globalPercentile":40}}]}""");

        var redacted = FitV2Visibility.RedactBelowMinimum(row, out var hidden)!;

        Assert.True(hidden);
        Assert.Null(redacted["assessments"]![0]!["score"]);
        Assert.Equal(100, redacted["assessment"]!.GetValue<double>());
        Assert.Equal(0, redacted["languages"]!.GetValue<double>());
        Assert.Equal(50, row!["assessments"]![0]!["score"]!.GetValue<double>()); // the input is not mutated
    }

    [Fact]
    public async Task Ranking_NarrowReader_GetsRedactedRow_OverallFromWhatRemains_AndReSorted()
    {
        var repo = new Repo(
            Row("ca000000-0000-0000-0000-000000000001", 75, BelowLia),
            Row("ca000000-0000-0000-0000-000000000002", 80, MetLia));
        var useCase = new FitEngineReadUseCase(repo);

        var hr = await useCase.GetRankingForVacancyAsync(OrgId, VacancyId, hideBelowMinimum: false, CancellationToken.None);
        Assert.Equal(75, hr[0].OverallScore);
        Assert.Equal(50, hr[0].Breakdown!["assessments"]![0]!["score"]!.GetValue<double>());

        var lead = await useCase.GetRankingForVacancyAsync(OrgId, VacancyId, hideBelowMinimum: true, CancellationToken.None);
        var below = Assert.Single(lead, r => r.CandidateId.EndsWith("01", StringComparison.Ordinal));
        Assert.Equal(100, below.OverallScore); // experience only: the 75 would invert to assessment 50 → p 20
        Assert.True(below.IsPartial);
        Assert.Null(below.Breakdown!["assessment"]);
        Assert.Null(below.Breakdown!["assessments"]![0]!["score"]);
        Assert.Equal(below, lead[0]); // re-sorted on the numbers this reader sees (100 > 80)
        Assert.Equal(80, lead[1].OverallScore);
    }

    // Codex r10 run 2 [P2]: two rows that tie once redacted must not keep the stored (hidden-score) order.
    [Fact]
    public async Task Ranking_And_Simulate_NarrowReader_BreakRedactedTiesByCandidateId_NotByTheHiddenScore()
    {
        const string LowerLia =
            """{"assessment":30,"interview":null,"experience":100,"education":null,"languages":null,"llmJudgment":null,"fitVersion":2,"reviewPending":false,"assessments":[{"instrument":"lia","use":"scored","status":"completed","score":30,"gate":null,"min":{"globalPercentile":40}}]}""";
        // Fetched by stored overall DESC: the higher hidden LIA (02, overall 75) before the lower (01, overall 65).
        var repo = new Repo(
            Row("ca000000-0000-0000-0000-000000000002", 75, BelowLia),
            Row("ca000000-0000-0000-0000-000000000001", 65, LowerLia));
        var useCase = new FitEngineReadUseCase(repo);
        var weights = new Dictionary<string, double>
        {
            ["assessment"] = 0.5,
            ["interview"] = 0,
            ["experience"] = 0.5,
            ["education"] = 0,
            ["languages"] = 0,
        };

        var ranking = await useCase.GetRankingForVacancyAsync(OrgId, VacancyId, hideBelowMinimum: true, CancellationToken.None);
        var simulated = await useCase.SimulateWeightsAsync(OrgId, VacancyId, weights, true, CancellationToken.None);

        Assert.Equal(ranking[0].OverallScore, ranking[1].OverallScore); // both show experience only
        Assert.EndsWith("01", ranking[0].CandidateId, StringComparison.Ordinal);
        Assert.Equal(simulated[0].SimulatedScore, simulated[1].SimulatedScore);
        Assert.EndsWith("01", simulated[0].CandidateId, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Simulate_NarrowReader_CannotReadTheHiddenDimensionBack()
    {
        var repo = new Repo(Row("ca000000-0000-0000-0000-000000000001", 75, BelowLia));
        var useCase = new FitEngineReadUseCase(repo);
        var allOnAssessment = new Dictionary<string, double>
        {
            ["assessment"] = 1,
            ["interview"] = 0,
            ["experience"] = 0,
            ["education"] = 0,
            ["languages"] = 0,
        };

        var hr = await useCase.SimulateWeightsAsync(OrgId, VacancyId, allOnAssessment, false, CancellationToken.None);
        Assert.Equal(50, hr[0].SimulatedScore);

        var lead = await useCase.SimulateWeightsAsync(OrgId, VacancyId, allOnAssessment, true, CancellationToken.None);
        Assert.NotEqual(50, lead[0].SimulatedScore);
        Assert.True(lead[0].IsPartial);
    }

    private static FitScoreForVacancyData Row(string candidateId, double overall, string breakdown) =>
        new(Guid.NewGuid(), overall, breakdown, false, DateTimeOffset.UnixEpoch, Guid.Parse(candidateId), "A", "B",
            Weights);

    private sealed class Repo(params FitScoreForVacancyData[] rows) : IFitEngineReadRepository
    {
        public Task<IReadOnlyList<FitScoreForVacancyData>> GetFitScoresForVacancyAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<FitScoreForVacancyData>>(rows);

        public Task<IReadOnlyList<WeightProfileData>> ListWeightProfilesAsync(
            Guid organizationId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<WeightProfileData>>([]);

        public List<CandidateFitScoreData> CandidateRows { get; } = [];

        public Task<IReadOnlyList<CandidateFitScoreData>> GetFitScoresForCandidateAsync(
            Guid organizationId, Guid candidateId, int max, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<CandidateFitScoreData>>(CandidateRows.Take(max).ToList());

        public Task<IReadOnlyList<FitReviewStateData>> GetReviewStatesAsync(
            Guid organizationId, IReadOnlyCollection<Guid> fitScoreIds, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<FitReviewStateData>>([]);

        public Task<ExplainFitRowData?> GetFitScoreForExplainAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<ExplainFitRowData?>(null);
    }
}
