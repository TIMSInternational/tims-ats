using System.Text.Json.Nodes;
using Tims.Domain.FitEngine;
using Xunit;

namespace Tims.UnitTests.FitEngine;

/// <summary>
/// The fit_requirements writer's input rules: the v1 keys keep the TS bounds; assessments absent keeps the stored
/// array, null removes it, an array is normalized by the FIT v2 parse rules with every finding reported; a stored
/// entry parses back to the same requirement (what is stored is what is scored).
/// </summary>
public sealed class FitRequirementsInputTests
{
    [Fact]
    public void AssessmentsAbsent_KeepsTheStoredArray_NullRemovesIt()
    {
        var absent = FitRequirementsInput.Validate(JsonNode.Parse("""{"minYearsExperience":1}"""), out _, out _)!;
        Assert.False(absent.ReplacesAssessments);
        Assert.False(absent.FitRequirements.ContainsKey("assessments"));

        var removed = FitRequirementsInput.Validate(JsonNode.Parse("""{"assessments":null}"""), out _, out _)!;
        Assert.True(removed.ReplacesAssessments);
        Assert.False(removed.FitRequirements.ContainsKey("assessments"));
    }

    [Theory]
    [InlineData("""{"minYearsExperience":61}""", "invalid_min_years_experience")]
    [InlineData("""{"minYearsExperience":"3"}""", "invalid_min_years_experience")]
    [InlineData("""{"requiredEducationLevel":"doctorate"}""", "invalid_education_level")]
    [InlineData("""{"requiredLanguages":[""]}""", "invalid_required_languages")]
    [InlineData("""{"assessments":{}}""", "invalid_assessments")]
    [InlineData("""{"assessments":[{"instrument":"iq"}]}""", "no_valid_assessment")]
    [InlineData("""[]""", "invalid_input")]
    public void InvalidBodies_AreRefused(string body, string error)
    {
        Assert.Null(FitRequirementsInput.Validate(JsonNode.Parse(body), out var actual, out _));
        Assert.Equal(error, actual);
    }

    [Fact]
    public void TooManyLanguagesOrEntries_AreRefused()
    {
        var languages = new JsonArray(Enumerable.Range(0, 21).Select(i => (JsonNode?)JsonValue.Create($"L{i}")).ToArray());
        Assert.Null(FitRequirementsInput.Validate(new JsonObject { ["requiredLanguages"] = languages }, out _, out _));

        var entries = new JsonArray(Enumerable.Range(0, 65)
            .Select(_ => (JsonNode?)new JsonObject { ["instrument"] = "native_quiz" }).ToArray());
        Assert.Null(FitRequirementsInput.Validate(new JsonObject { ["assessments"] = entries }, out var error, out _));
        Assert.Equal("invalid_assessments", error);
    }

    [Fact]
    public void Findings_AreReportedPerEntry_AndEnglishLosesItsWeight()
    {
        var write = FitRequirementsInput.Validate(JsonNode.Parse("""
            {"assessments":[
              {"instrument":"lia","min":{"globalPercentile":30},"weight":0,"reason":"   "},
              {"instrument":"english","use":"scored","min":{"cefr":"C1"},"weight":2},
              {"instrument":"mi","use":"scored","weight":1}]}
            """), out _, out var issues)!;

        Assert.Equal(
            ["0:lia:invalid_weight", "0:lia:reason_dropped", "0:lia:lia_threshold_only", "1:english:weight_ignored", "2:mi:use_coerced_to_advisory", "2:mi:weight_ignored"],
            issues.Select(i => $"{i.Index}:{i.Instrument}:{i.Code}").ToArray());
        Assert.All(issues, i => Assert.False(i.Dropped));
        var stored = write.FitRequirements["assessments"]!.AsArray();
        Assert.Null(stored[1]!["weight"]);
        Assert.Equal("advisory", stored[2]!["use"]!.GetValue<string>());
    }

    [Fact]
    public void AnInvalidOptionalMinimum_DropsTheEntry_AndIsReported_NeverSilentlyScoredOnTheRawScore()
    {
        // Codex round 8 [P2]: {"min":{"score":"60"}} on a scored native quiz used to parse as "no minimum".
        Assert.Null(FitRequirementsInput.Validate(
            JsonNode.Parse("""{"assessments":[{"instrument":"native_quiz","min":{"score":"60"}}]}"""), out var error, out var issues));
        Assert.Equal("no_valid_assessment", error);
        var issue = Assert.Single(issues);
        Assert.Equal((FitRequirementIssueCodes.InvalidMinimum, true), (issue.Code, issue.Dropped));

        var none = FitRequirementsInput.Validate(
            JsonNode.Parse("""{"assessments":[{"instrument":"native_quiz"},{"instrument":"lia","min":{"globalPercentile":40}}]}"""),
            out _, out var noIssues)!;
        // An ABSENT optional minimum is still fine; the only finding is D20's informational LIA note (never a drop).
        var note = Assert.Single(noIssues);
        Assert.Equal((1, FitRequirementIssueCodes.LiaThresholdOnly, false), (note.Index, note.Code, note.Dropped));
        Assert.Equal(2, none.FitRequirements["assessments"]!.AsArray().Count);
    }

    // ── owner default D20: LIA is a minimum threshold only while its norms are unconfirmed ──
    [Fact]
    public void AScoredLia_IsStoredAsConfigured_AndReportedAsThresholdOnly_UnlessScoringIsAllowed()
    {
        const string body =
            """{"assessments":[{"instrument":"lia","use":"scored","min":{"globalPercentile":40},"weight":2},{"instrument":"lia","use":"gate","min":{"globalPercentile":10}}]}""";

        var write = FitRequirementsInput.Validate(JsonNode.Parse(body), out _, out var issues)!;
        Assert.Equal(
            ["0:lia:lia_threshold_only:False", "1:lia:duplicate_instrument:True"],
            issues.Select(i => $"{i.Index}:{i.Instrument}:{i.Code}:{i.Dropped}").ToArray());
        var stored = Assert.Single(write.FitRequirements["assessments"]!.AsArray())!;
        Assert.Equal("scored", stored["use"]!.GetValue<string>()); // the configuration is kept for when norms are confirmed
        Assert.Equal(2, stored["weight"]!.GetValue<double>());

        FitRequirementsInput.Validate(JsonNode.Parse(body), liaScoredAllowed: true, out _, out var allowed);
        Assert.DoesNotContain(allowed, i => i.Code == FitRequirementIssueCodes.LiaThresholdOnly);

        // A LIA gate is already a threshold: no note.
        FitRequirementsInput.Validate(
            JsonNode.Parse("""{"assessments":[{"instrument":"lia","use":"gate","min":{"globalPercentile":40}}]}"""),
            out _, out var gate);
        Assert.Empty(gate);
    }

    [Fact]
    public void StoredEntries_ParseBackToTheSameRequirements()
    {
        var raw = JsonNode.Parse("""
            [{"instrument":" LIA ","use":"Scored","min":{"globalPercentile":45.5},"weight":2,"reason":" datos "},
             {"instrument":"english","min":{"cefr":"b1"}},
             {"instrument":"itcia","use":"gate","min":{"level":4}},
             {"instrument":"native_quiz","use":"gate","min":{"score":70}},
             {"instrument":"pca"}]
            """)!.AsArray();
        var (kept, _) = FitRequirementsInput.NormalizeAssessments(raw);

        var original = FitV2Kernels.ParseAssessmentRequirements(new JsonObject { ["assessments"] = raw.DeepClone() })!;
        var reread = FitV2Kernels.ParseAssessmentRequirements(new JsonObject { ["assessments"] = kept })!;

        Assert.Equal(original, reread);
    }
}
