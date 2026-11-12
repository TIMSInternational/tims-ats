using System.Text.Json.Nodes;
using Tims.Application.Assessments.Providers;
using Tims.Application.FitEngine;
using Tims.Domain.Assessments.Providers;
using Tims.Domain.FitEngine;

namespace Tims.UnitTests.FitEngine;

/// <summary>
/// TIMS 2026-11-12: a PCA is judged on TIMS's own PCA-vs-JCA fit to the vacancy's TIMS position code (contract
/// <c>vacancy.job_code</c> → <c>PcaResultV1.scores.job_fit</c>), never on its DISC values. The arithmetic of a scored or
/// gated PCA is pinned by the golden fixtures (contracts/fit-v2-fixtures/evaluate.json); these cover the rest of the path.
/// </summary>
public sealed class FitV2PcaJobFitTests
{
    private static JsonArray Entries(string json) => JsonNode.Parse(json)!.AsArray();

    // ── the requirement ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_scored_or_gated_pca_without_a_position_code_is_dropped_and_says_why()
    {
        var (kept, issues) = FitRequirementsInput.NormalizeAssessments(Entries("""
            [{"instrument":"pca","use":"scored","reason":"ajuste"},
             {"instrument":"pca","use":"gate","jobCode":"194225","min":{"jobFit":70},"reason":"ajuste"}]
            """));

        Assert.Single(kept);
        Assert.Equal("gate", kept[0]!["use"]!.GetValue<string>());
        Assert.Equal("194225", kept[0]!["jobCode"]!.GetValue<string>());
        Assert.Equal(70, kept[0]!["min"]!["jobFit"]!.GetValue<double>());
        Assert.Contains(issues, i => i.Index == 0 && i.Code == FitRequirementIssueCodes.JobCodeRequired && i.Dropped);
        // PCA is no longer coerced to advisory: no use_coerced_to_advisory finding for it.
        Assert.DoesNotContain(issues, i => i.Code == FitRequirementIssueCodes.UseCoercedToAdvisory);
    }

    [Fact]
    public void An_invalid_position_code_drops_the_pca_entry_and_a_code_on_another_instrument_is_ignored()
    {
        var (kept, issues) = FitRequirementsInput.NormalizeAssessments(Entries("""
            [{"instrument":"pca","use":"advisory","jobCode":"19 42"},
             {"instrument":"pca","use":"advisory","jobCode":7},
             {"instrument":"lia","use":"scored","min":{"globalPercentile":40},"jobCode":"194225","reason":"razonamiento"}]
            """));

        var lia = Assert.Single(kept)!.AsObject();
        Assert.Equal("lia", lia["instrument"]!.GetValue<string>());
        Assert.False(lia.ContainsKey("jobCode"));
        Assert.Contains(issues, i => i.Index == 0 && i.Code == FitRequirementIssueCodes.InvalidJobCode && i.Dropped);
        Assert.Contains(issues, i => i.Index == 1 && i.Code == FitRequirementIssueCodes.InvalidJobCode && i.Dropped);
        Assert.Contains(issues, i => i.Index == 2 && i.Code == FitRequirementIssueCodes.JobCodeIgnored && !i.Dropped);
    }

    [Fact]
    public void Personality_and_mi_stay_advisory_only_and_pca_does_not()
    {
        Assert.True(FitInstruments.IsAdvisoryOnly(FitInstruments.Personality));
        Assert.True(FitInstruments.IsAdvisoryOnly(FitInstruments.Mi));
        Assert.False(FitInstruments.IsAdvisoryOnly(FitInstruments.Pca));
    }

    [Theory]
    [InlineData("194225", true)]
    [InlineData("GC-001_b", true)]
    [InlineData("ab", true)]
    [InlineData("a", false)]
    [InlineData("1234567890123456789012345678901", false)]
    [InlineData("19 42", false)]
    [InlineData("puesto/1", false)]
    [InlineData("ñandú", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void A_position_code_is_the_contract_job_code(string? value, bool valid) =>
        Assert.Equal(valid, FitV2Kernels.IsJobCode(value));

    [Fact]
    public void The_strict_editor_refuses_a_scored_pca_without_a_code()
    {
        var body = JsonNode.Parse("""
            {"assessments":[{"instrument":"pca","use":"scored","reason":"ajuste al puesto"}],
             "expectedVersion":"0123456789abcdef0123456789abcdef"}
            """);

        Assert.Null(FitAssessmentRequirementsInput.Validate(body, liaScoredAllowed: false, out var error, out var issues));
        Assert.Equal("invalid_assessments", error);
        Assert.Contains(issues, i => i.Code == FitRequirementIssueCodes.JobCodeRequired);
    }

    [Fact]
    public void The_stored_entry_keeps_the_code_and_reads_back_the_same()
    {
        var requirement = new AssessmentRequirement(
            "pca", "scored", new InstrumentMinimum(null, null, null, null, 60), 2, "ajuste al puesto", "194225");

        var stored = FitRequirementsInput.ToStoredJson(requirement);
        var back = FitV2Kernels.ParseAssessmentRequirements(new JsonObject { ["assessments"] = new JsonArray(stored) });

        Assert.Equal("194225", stored["jobCode"]!.GetValue<string>());
        Assert.Equal("""{"jobFit":60}""", stored["min"]!.ToJsonString());
        Assert.Equal(requirement, Assert.Single(back!));
        // Every other instrument's stored shape is unchanged: no jobCode key at all.
        Assert.False(FitRequirementsInput.ToStoredJson(requirement with { Instrument = "lia", JobCode = null })
            .ContainsKey("jobCode"));
    }

    // ── the stored result's job fit ────────────────────────────────────────────────────────────

    private const string Computed =
        """{"competencies":[],"disc":{"primary_graph":"under_pressure","graphs":[]},"job_fit":{"job_code":"194225","analysis":"fit","status":"computed","fit":78.5,"job_profile":{"d":62,"i":40,"s":55,"c":70},"computed_at":"2026-11-12T15:00:00Z"}}""";

    [Fact]
    public void A_computed_job_fit_is_read_with_its_code_value_and_position_profile()
    {
        Assert.Equal(
            new PcaJobFit("194225", PcaJobFits.Computed, 78.5, new DiscFactors(62, 40, 55, 70)),
            PcaJobFits.FromScoresJson(Computed));
    }

    [Theory]
    [InlineData("job_not_found")]
    [InlineData("unavailable")]
    public void A_job_fit_without_a_value_keeps_its_status_and_no_number(string status)
    {
        var json = """{"job_fit":{"job_code":"X1","analysis":"fit","status":"STATUS","fit":null,"job_profile":null,"computed_at":"2026-11-12T15:00:00Z"}}"""
            .Replace("STATUS", status, StringComparison.Ordinal);
        Assert.Equal(new PcaJobFit("X1", status, null, null), PcaJobFits.FromScoresJson(json));
    }

    [Theory]
    [InlineData("""{"competencies":[]}""")] // no job fit
    [InlineData("""{"job_fit":{"job_code":"19 42","analysis":"fit","status":"computed","fit":78,"job_profile":{"d":1,"i":1,"s":1,"c":1}}}""")]
    [InlineData("""{"job_fit":{"job_code":"194225","analysis":"gap","status":"computed","fit":78,"job_profile":{"d":1,"i":1,"s":1,"c":1}}}""")]
    [InlineData("""{"job_fit":{"job_code":"194225","analysis":"fit","status":"computed","fit":140,"job_profile":{"d":1,"i":1,"s":1,"c":1}}}""")]
    [InlineData("""{"job_fit":{"job_code":"194225","analysis":"fit","status":"computed","fit":"78","job_profile":{"d":1,"i":1,"s":1,"c":1}}}""")]
    [InlineData("""{"job_fit":{"job_code":"194225","analysis":"fit","status":"computed","fit":78,"job_profile":null}}""")]
    [InlineData("""{"job_fit":{"job_code":"194225","analysis":"fit","status":"guess","fit":78,"job_profile":{"d":1,"i":1,"s":1,"c":1}}}""")]
    [InlineData("""not json""")]
    [InlineData("""[]""")]
    [InlineData("")]
    public void Anything_off_contract_reads_as_no_job_fit(string json) => Assert.Null(PcaJobFits.FromScoresJson(json));

    [Fact]
    public void The_results_board_profile_carries_the_job_fit()
    {
        var json = """
            {"competencies":[{"code":"tims-pca:trabajo_en_equipo","name":"Trabajo en equipo","level":{"ordinal":3},"scale_max":4}],
             "disc":{"primary_graph":"under_pressure","graphs":[{"graph":"under_pressure","d":70,"i":40,"s":30,"c":52}]},
             "job_fit":{"job_code":"194225","analysis":"fit","status":"computed","fit":78,"job_profile":{"d":62,"i":40,"s":55,"c":70},"computed_at":"2026-11-12T15:00:00Z"}}
            """;

        var pca = ProviderResultProfiles.Parse("pca", json)!.Pca!;

        Assert.Equal(new PcaJobFit("194225", "computed", 78, new DiscFactors(62, 40, 55, 70)), pca.JobFit);
        Assert.Null(ProviderResultProfiles.Parse("pca", json.Replace("\"job_fit\"", "\"other\"", StringComparison.Ordinal))!.Pca!.JobFit);
    }

    // ── the FIT row ────────────────────────────────────────────────────────────────────────────

    private static ProviderFitRow Row(string validity = "valid", bool review = false) => new(
        Guid.NewGuid(), "pca", ProviderAttemptStates.ResultReady, Guid.NewGuid(), "selection", validity, review,
        DateTimeOffset.UnixEpoch, null, null, null, "tims-legacy-pca", null, DateTimeOffset.UnixEpoch, 1m, 1m,
        JobFit: 78, JobCode: "194225");

    [Fact]
    public void A_valid_pca_result_reports_its_job_fit_to_fit_and_one_needing_review_reports_none()
    {
        var valid = Assert.Single(ProviderFitMapping.Map([Row()]));
        Assert.Equal((78d, "194225"), (valid.JobFit!.Value, valid.JobCode!));
        var copied = ProviderFitResultSource.ToInstrumentResult(valid);
        Assert.Equal((78d, "194225"), (copied.JobFit!.Value, copied.JobCode!));

        var review = Assert.Single(ProviderFitMapping.Map([Row(review: true)]));
        Assert.Equal(ProviderResultIntegrity.NeedsReview, review.Integrity);
        Assert.Null(review.JobFit);
        Assert.Null(review.JobCode);
        Assert.Null(ProviderFitResultSource.ToInstrumentResult(review).JobFit);
    }

    // ── the assignment ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_vacancys_pca_code_is_read_exactly_as_fit_reads_it()
    {
        Assert.Equal("194225", JobRelatedness.PcaJobCode(
            """{"assessments":[{"instrument":"pca","use":"scored","jobCode":" 194225 ","reason":"ajuste"}]}"""));
        Assert.Equal("GC001", JobRelatedness.PcaJobCode(
            """{"assessments":[{"instrument":"pca","use":"advisory","jobCode":"GC001"}]}"""));
        Assert.Null(JobRelatedness.PcaJobCode("""{"assessments":[{"instrument":"pca","use":"advisory"}]}"""));
        // A scored PCA without a code is dropped by FIT, so it has no code to send.
        Assert.Null(JobRelatedness.PcaJobCode("""{"assessments":[{"instrument":"pca","use":"scored"}]}"""));
        Assert.Null(JobRelatedness.PcaJobCode("""{"assessments":[{"instrument":"lia","use":"scored","jobCode":"194225","min":{"globalPercentile":40}}]}"""));
        Assert.Null(JobRelatedness.PcaJobCode("not json"));
        Assert.Null(JobRelatedness.PcaJobCode(null));
    }

    [Fact]
    public void An_open_pca_attempt_with_another_code_is_not_the_same_terms()
    {
        var open = new AttemptRow(
            Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "pca", ProviderAttemptStates.Created,
            "ajuste", "es", 1m, [], null, null, null, null, null, [], null, null, false, AgeBand: "18_plus", JobCode: "194225");
        var same = new NewAttempt("pca", "ajuste", "es", 1m, [], null, "18_plus", null, "194225");

        Assert.True(same.SameTermsAs(open));
        Assert.False((same with { JobCode = "GC001" }).SameTermsAs(open));
        Assert.False((same with { JobCode = null }).SameTermsAs(open));
    }
}
