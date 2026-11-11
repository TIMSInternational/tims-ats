using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// The HR results view's profile: what each instrument's stored <c>scores</c> (the provider's full projection) becomes,
/// bounded and validated, and who gets it (company scope, valid results only).
/// </summary>
public sealed class ProviderResultProfileTests
{
    // Shapes as the local cross-system stack stored them (tims-suite /v1 results at `full`).
    private const string Lia = """
        {"global":{"level":{"code":"insufficient","label":"Insuficiente","ordinal":1,"scale_id":"lia.level"},"percentile":1.4},"battery":"full","norm_status":"provisional","subtests":[{"subtest":"pattern_recognition","completion":"finished","percentile":0,"level":{"code":"insufficient","ordinal":1}},{"subtest":"numerical_speed","completion":"finished","percentile":7,"level":{"code":"insufficient","ordinal":1}},{"subtest":"Bad Key","percentile":50},{"subtest":"working_memory","percentile":140}]}
        """;

    private const string English = """
        {"overall":{"cefr":{"code":"A1","label":"A1 · Acceso","ordinal":1},"score_pct":27.7},"speaking_scored_by_ai":false,"skills":[{"skill":"grammar","assessed":true,"cefr":{"code":"A1"},"score_pct":16.7,"items_scored":6},{"skill":"sentence_completion","assessed":true,"cefr":{"code":"B1"},"score_pct":50},{"skill":"speaking","assessed":false,"cefr":null,"score_pct":null,"not_assessed_reason":"consent_not_given"},{"skill":"reading","assessed":true,"cefr":{"code":"Z9"},"score_pct":33.3}]}
        """;

    private const string Personality = """
        {"variant":"laboral","dimensions":[{"dimension_id":"EI","first_pole":"E","second_pole":"I","first_count":7,"second_count":3,"preferred_pole":"E","clarity_pct":70,"balanced":false},{"dimension_id":"SN","first_pole":"S","second_pole":"N","first_count":5,"second_count":5,"preferred_pole":null,"clarity_pct":0,"balanced":true},{"dimension_id":"TF","first_pole":"T","second_pole":"T","first_count":6,"second_count":4,"clarity_pct":60}]}
        """;

    private const string Pca = """
        {"disc":{"primary_graph":"under_pressure","graphs":[{"graph":"work_adaptation","d":62,"i":48,"s":35,"c":55},{"graph":"under_pressure","d":70,"i":40,"s":30,"c":52},{"graph":"self_image","d":55,"i":50,"s":42,"c":49},{"graph":"fourth","d":1,"i":1,"s":1,"c":1}]},"competencies":[{"code":"tims-pca:orientacion_a_resultados","name":"Orientación a resultados","level":{"code":"l3","ordinal":3},"scale_max":4},{"code":"tims-pca:trabajo_en_equipo","name":"Trabajo en equipo","level":{"code":"l9","ordinal":9}},{"code":"<script>","name":"x","level":{"ordinal":2}}]}
        """;

    [Fact]
    public void Lia_keeps_the_global_percentile_and_valid_subtests_only()
    {
        var lia = ProviderResultProfiles.Parse("lia", Lia)!.Lia!;

        Assert.Equal(1.4, lia.GlobalPercentile);
        Assert.Equal("insufficient", lia.GlobalLevel);
        Assert.Equal("provisional", lia.NormStatus);
        Assert.Equal(["pattern_recognition", "numerical_speed", "working_memory"], lia.Subtests.Select(s => s.Subtest));
        Assert.Equal(7, lia.Subtests[1].Percentile);
        // Out of range: the subtest stays, its percentile does not.
        Assert.Null(lia.Subtests[2].Percentile);
    }

    [Fact]
    public void English_reports_each_skill_and_why_one_was_not_assessed()
    {
        var en = ProviderResultProfiles.Parse("english", English)!.English!;

        Assert.Equal("A1", en.OverallCefr);
        Assert.Equal(27.7, en.OverallScorePct);
        Assert.Equal(["grammar", "sentence_completion", "speaking", "reading"], en.Skills.Select(s => s.Skill));
        var speaking = en.Skills.Single(s => s.Skill == "speaking");
        Assert.False(speaking.Assessed);
        Assert.Equal("consent_not_given", speaking.NotAssessedReason);
        Assert.Null(speaking.ScorePct);
        // An unknown CEFR code is dropped, never passed through.
        Assert.Null(en.Skills.Single(s => s.Skill == "reading").Cefr);
    }

    [Fact]
    public void Personality_keeps_well_formed_dimensions_and_a_tie_has_no_preferred_pole()
    {
        var p = ProviderResultProfiles.Parse("personality", Personality)!.Personality!;

        Assert.Equal("laboral", p.Variant);
        Assert.Equal(["ei", "sn"], p.Dimensions.Select(d => d.Dimension));
        Assert.Equal("E", p.Dimensions[0].PreferredPole);
        Assert.Equal(70, p.Dimensions[0].ClarityPct);
        Assert.True(p.Dimensions[1].Balanced);
        Assert.Null(p.Dimensions[1].PreferredPole);
    }

    [Fact]
    public void Pca_keeps_three_graphs_the_primary_one_and_competencies_on_the_1_to_4_scale()
    {
        var pca = ProviderResultProfiles.Parse("pca", Pca)!.Pca!;

        Assert.Equal("under_pressure", pca.PrimaryGraph);
        Assert.Equal(["work_adaptation", "under_pressure", "self_image"], pca.Graphs.Select(g => g.Graph));
        Assert.Equal(70, pca.Graphs[1].D);
        var competency = Assert.Single(pca.Competencies);
        Assert.Equal("Orientación a resultados", competency.Name);
        Assert.Equal(3, competency.Level);
        Assert.Equal(4, competency.ScaleMax);
    }

    [Theory]
    [InlineData("lia", null)]
    [InlineData("lia", "")]
    [InlineData("lia", "not json")]
    [InlineData("lia", "[1,2]")]
    [InlineData("lia", "{}")]
    [InlineData("pca", """{"disc":{"graphs":"x"},"competencies":7}""")]
    [InlineData("personality", """{"dimensions":[]}""")]
    [InlineData("itcia", """{"overall":{"level":3}}""")]
    [InlineData("mi", """{"profile":[]}""")]
    public void Nothing_drawable_is_null(string instrument, string? json) =>
        Assert.Null(ProviderResultProfiles.Parse(instrument, json));

    [Fact]
    public void Lists_are_capped_and_names_truncated()
    {
        var many = string.Join(',', Enumerable.Range(0, 60).Select(i =>
            "{\"code\":\"tims-pca:c" + i + "\",\"name\":\"" + new string('n', 300) + "\",\"level\":{\"ordinal\":2}}"));
        var pca = ProviderResultProfiles.Parse("pca", "{\"competencies\":[" + many + "]}")!.Pca!;

        Assert.Equal(ProviderResultProfiles.MaxCompetencies, pca.Competencies.Count);
        Assert.All(pca.Competencies, c => Assert.Equal(ProviderResultProfiles.MaxNameLength, c.Name.Length));
        Assert.Empty(pca.Graphs);
        Assert.Null(pca.PrimaryGraph);
    }

    // ── who gets it ──────────────────────────────────────────────────────────────────────────

    private static readonly DateTimeOffset Now = new(2026, 11, 10, 13, 0, 0, TimeSpan.Zero);

    private static async Task<StaffProviderResult?> ViewAsync(bool hidesLevels, string validity = ProviderValidity.Valid)
    {
        var repository = new FakeRepository();
        var staff = new OneAttemptStaffRepository(new StaffResultRecord(
            Guid.NewGuid(), "selection", "1.0", null, validity, validity == ProviderValidity.Valid ? [] : ["proctoring"],
            false, null, null, null, 1m, Now.AddHours(-1), Pca));
        var list = await new ProviderStaffReadUseCase(repository, staff, new FakeProvider()).ListCandidateAttemptsAsync(
            FakeRepository.Org, FakeRepository.Candidate, hidesLevels, liaScoredAllowed: false,
            _ => Task.FromResult(true), Now, CancellationToken.None);
        return Assert.Single(list.Attempts).Result;
    }

    [Fact]
    public async Task A_company_scope_reader_gets_the_profile_of_a_valid_result()
    {
        var result = await ViewAsync(hidesLevels: false);

        Assert.NotNull(result!.Profile?.Pca);
        Assert.Null(result.Profile!.Lia);
    }

    [Fact]
    public async Task A_narrow_reader_never_gets_a_profile() =>
        Assert.Null((await ViewAsync(hidesLevels: true))!.Profile);

    [Theory]
    [InlineData(ProviderValidity.NeedsReview)]
    [InlineData(ProviderValidity.Voided)]
    public async Task A_result_that_is_not_valid_has_no_profile(string validity) =>
        Assert.Null((await ViewAsync(hidesLevels: false, validity))!.Profile);

    private sealed class OneAttemptStaffRepository(StaffResultRecord result) : IProviderStaffReadRepository
    {
        private const string Requirements =
            """{"assessments":[{"instrument":"pca","use":"advisory","reason":"Entrevista"}]}""";

        public Task<IReadOnlyDictionary<string, string>> GetVacancyPinnedVersionsAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyDictionary<string, string>>(new Dictionary<string, string>());

        public Task<StaffCandidateAttempts> ListCandidateAttemptsAsync(
            Guid organizationId, Guid candidateId, int max, CancellationToken cancellationToken)
        {
            var attempt = new AttemptRow(
                Guid.NewGuid(), FakeRepository.Org, FakeRepository.Candidate, FakeRepository.Vacancy, "pca",
                ProviderAttemptStates.ResultReady, "r", "es", 1m, [], null, Guid.NewGuid(), Guid.NewGuid(), "1.0", "c-1",
                ["assessment"], null, null, false, MissingConsents: []);
            return Task.FromResult(new StaffCandidateAttempts(
                false, [new StaffAttemptRecord(attempt, Now.AddDays(-1), Now.AddHours(-1), result)],
                new Dictionary<Guid, string?> { [FakeRepository.Vacancy] = Requirements }));
        }
    }
}
