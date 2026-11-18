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

    // The contract's own examples (tims-interop examples/assessments/result-itcia.json, result-mi.json), plus junk.
    private const string Itcia = """
        {"completion":"complete","global_level":{"scale_id":"itcia.level","code":"autonomo","ordinal":3,"label":"Autónomo"},"core_score":1.92,"categories":[{"category_id":"C2","score":1.8,"coverage":"complete","provisional":false},{"category_id":"C1","score":2.1,"coverage":"complete","provisional":false},{"category_id":"C4","score":1.7,"coverage":"partial","provisional":true},{"category_id":"C1","score":0.1,"coverage":"complete","provisional":false},{"category_id":"C9","score":2},{"category_id":"C5","score":4.5,"coverage":"odd","provisional":false}],"risk":{"flags":["R2","R2","R7","<b>"],"recommended_autonomy_level":{"scale_id":"itcia.level","code":"funcional","ordinal":2}}}
        """;

    private const string Mi = """
        {"all_intelligences_complete":false,"intelligences":[{"intelligence_id":"linguistica","sum_score":21,"band":{"scale_id":"mi.band","code":"fortaleza","ordinal":3,"label":"Fortaleza"},"answered":5,"expected":5},{"intelligence_id":"musical","sum_score":9,"band":{"scale_id":"mi.band","code":"por_desarrollar","ordinal":1},"answered":5,"expected":5},{"intelligence_id":"naturalista","sum_score":30,"band":{"code":"x","ordinal":7},"answered":5,"expected":5},{"intelligence_id":"emocional","sum_score":14,"band":{"code":"moderado","ordinal":2},"answered":3,"expected":5},{"intelligence_id":"linguistica","sum_score":5,"answered":5},{"intelligence_id":"telepatica","sum_score":20,"answered":5}],"dominant":{"intelligence_ids":["linguistica","telepatica","linguistica"],"tied":false,"no_differentiation":false}}
        """;

    [Fact]
    public void Itcia_keeps_the_level_the_evidence_per_category_and_the_risk_flags_bounded()
    {
        var itcia = ProviderResultProfiles.Parse("itcia", Itcia)!.Itcia!;

        Assert.Equal(3, itcia.GlobalLevel);
        Assert.Equal("autonomo", itcia.GlobalLevelCode);
        Assert.Equal(1.92, itcia.CoreScore);
        Assert.Equal("complete", itcia.Completion);
        // C1–C7 only, each once (the first wins), in catalogue order; a score off the 0–3 scale is dropped, not clamped.
        Assert.Equal(["C1", "C2", "C4", "C5"], itcia.Categories.Select(c => c.Category));
        Assert.Equal(2.1, itcia.Categories[0].Score);
        Assert.True(itcia.Categories.Single(c => c.Category == "C4").Provisional);
        Assert.Equal("partial", itcia.Categories.Single(c => c.Category == "C4").Coverage);
        Assert.Null(itcia.Categories.Single(c => c.Category == "C5").Score);
        Assert.Null(itcia.Categories.Single(c => c.Category == "C5").Coverage);
        Assert.Equal(["R2"], itcia.RiskFlags);
        Assert.Equal(2, itcia.RecommendedAutonomyLevel);
    }

    [Fact]
    public void Itcia_without_a_level_on_its_own_scale_has_none()
    {
        var itcia = ProviderResultProfiles.Parse(
            "itcia", """{"global_level":{"scale_id":"lia.level","code":"autonomo","ordinal":3},"core_score":null,"categories":[{"category_id":"C3","score":null,"coverage":"partial","provisional":true}]}""")!.Itcia!;

        Assert.Null(itcia.GlobalLevel);
        Assert.Null(itcia.GlobalLevelCode);
        Assert.Null(itcia.CoreScore);
        Assert.Equal(["C3"], itcia.Categories.Select(c => c.Category));
        Assert.Empty(itcia.RiskFlags);
    }

    [Fact]
    public void Mi_keeps_each_known_intelligence_once_and_never_scores_an_unanswered_one()
    {
        var mi = ProviderResultProfiles.Parse("mi", Mi)!.Mi!;

        Assert.False(mi.AllComplete);
        Assert.Equal(["linguistica", "musical", "naturalista", "emocional"], mi.Intelligences.Select(i => i.Intelligence));
        var linguistica = mi.Intelligences[0];
        Assert.Equal((21, 3, "fortaleza"), (linguistica.SumScore, linguistica.Band, linguistica.BandCode));
        // Off the 5–25 sum and the 1–3 band: dropped, not clamped.
        var naturalista = mi.Intelligences.Single(i => i.Intelligence == "naturalista");
        Assert.Null(naturalista.SumScore);
        Assert.Null(naturalista.Band);
        Assert.Null(naturalista.BandCode);
        // Three of five ratings: no sum and no band, whatever the payload says.
        var emocional = mi.Intelligences.Single(i => i.Intelligence == "emocional");
        Assert.Equal((null, null, 3), (emocional.SumScore, emocional.Band, emocional.Answered));
        Assert.Equal(["linguistica"], mi.Dominant);
    }

    [Fact]
    public void The_two_new_members_are_written_only_when_set()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(
            ProviderResultProfiles.Parse("lia", Lia), new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));

        Assert.DoesNotContain("itcia", json, StringComparison.Ordinal);
        Assert.DoesNotContain("\"mi\"", json, StringComparison.Ordinal);
        Assert.Contains("\"pca\":null", json, StringComparison.Ordinal);
    }

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

    // Codex ats run 7 [P2]: the PDF menu follows the report endpoints' own rule, not the profile; a result lowered to
    // summary has no profile and still has its native report.
    [Theory]
    [InlineData("lia", ProviderValidity.Valid, "summary", false, true)]
    [InlineData("lia", ProviderValidity.Valid, "full", false, true)]
    [InlineData("lia", ProviderValidity.NeedsReview, "summary", false, true)]
    [InlineData("lia", ProviderValidity.Valid, "full", true, false)] // D6: a narrow reader
    [InlineData("lia", ProviderValidity.Voided, "full", false, false)]
    [InlineData("lia", ProviderValidity.Valid, "status_only", false, false)]
    [InlineData("pca", ProviderValidity.Valid, "summary", false, false)] // a provider variant needs full
    [InlineData("pca", ProviderValidity.Valid, "full", false, true)]
    public async Task Reports_are_available_by_the_report_endpoints_rule(
        string instrument, string validity, string level, bool hidesLevels, bool expected)
    {
        var staff = new OneAttemptStaffRepository(
            new StaffResultRecord(
                Guid.NewGuid(), "selection", "1.0", null, validity, validity == ProviderValidity.Valid ? [] : ["proctoring"],
                false, null, null, null, 1m, Now.AddHours(-1), level == "full" ? Pca : "{}", level),
            instrument);
        var list = await new ProviderStaffReadUseCase(new FakeRepository(), staff, new FakeProvider()).ListCandidateAttemptsAsync(
            FakeRepository.Org, FakeRepository.Candidate, hidesLevels, liaScoredAllowed: false,
            _ => Task.FromResult(true), Now, CancellationToken.None);

        Assert.Equal(expected, Assert.Single(list.Attempts).Result!.ReportsAvailable);
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

    private sealed class OneAttemptStaffRepository(StaffResultRecord result, string instrument = "pca") : IProviderStaffReadRepository
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
                Guid.NewGuid(), FakeRepository.Org, FakeRepository.Candidate, FakeRepository.Vacancy, instrument,
                ProviderAttemptStates.ResultReady, "r", "es", 1m, [], null, Guid.NewGuid(), Guid.NewGuid(), "1.0", "c-1",
                ["assessment"], null, null, false, MissingConsents: []);
            return Task.FromResult(new StaffCandidateAttempts(
                false, [new StaffAttemptRecord(attempt, Now.AddDays(-1), Now.AddHours(-1), result)],
                new Dictionary<Guid, string?> { [FakeRepository.Vacancy] = Requirements }));
        }
    }
}
