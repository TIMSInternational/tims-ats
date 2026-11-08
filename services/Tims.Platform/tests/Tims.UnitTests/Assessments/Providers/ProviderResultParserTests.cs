using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// Typed provider results (tims-interop <c>schemas/assessments/results/*</c>) reduced to what the ATS stores, and the
/// off-contract results it must refuse. Fixtures follow the contract's own examples (synthetic, no instrument content).
/// </summary>
public sealed class ProviderResultParserTests
{
    internal static JsonObject Result(string instrument, string schema, JsonObject? scores, JsonObject summary,
        string validity = "valid", string[]? reasons = null, string renderedLevel = "full", string purpose = "selection")
    {
        var root = new JsonObject
        {
            ["result_id"] = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
            ["result_schema"] = schema,
            ["instrument"] = instrument,
            ["instrument_version"] = "1.0",
            ["tenant_id"] = "3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12",
            ["subject_id"] = "7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d",
            ["assignment_id"] = "0b8f6e2a-4c3d-4e1f-9a7b-6c5d4e3f2a1b",
            ["session_id"] = "5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e1f",
            ["purpose"] = purpose,
            ["locale"] = "es",
            ["completed_at"] = "2026-11-09T14:38:00Z",
            ["scored_at"] = "2026-11-09T14:38:04Z",
            ["result_revision"] = 1,
            ["validity"] = new JsonObject
            {
                ["status"] = validity,
                ["reasons"] = new JsonArray((reasons ?? []).Select(r => (JsonNode)JsonValue.Create(r)!).ToArray()),
                ["decided_at"] = "2026-11-09T14:38:05Z",
                ["decided_by"] = "server_policy",
            },
            ["content_version"] = "content-2026.11.1",
            ["content_sha256"] = new string('a', 64),
            ["norm_version"] = "norms-2026.07",
            ["scoring_version"] = "scoring-1.0",
            ["scoring_method"] = "deterministic",
            ["accommodations_applied"] = new JsonObject { ["time_multiplier"] = 1.5, ["aids"] = new JsonArray("extended_breaks") },
            ["visibility"] = new JsonObject
            {
                ["rendered_for"] = "tenant_hr",
                ["rendered_level"] = renderedLevel,
                ["audiences"] = new JsonObject { ["subject"] = "none", ["tenant_hr"] = renderedLevel, ["platform"] = "full" },
            },
            ["summary"] = summary,
            ["scale_definitions"] = new JsonArray(),
        };
        if (purpose == "selection")
        {
            root["vacancy"] = new JsonObject
            {
                ["external_vacancy_ref"] = "a0000000-0000-4000-8000-000000000001",
                ["job_relatedness_reason"] = "Análisis de datos",
            };
        }

        if (scores is not null)
        {
            root["scores"] = scores;
        }

        return root;
    }

    internal static JsonObject Summary(JsonObject? level = null, JsonObject? percentile = null, string completion = "complete") =>
        new()
        {
            ["completion"] = completion,
            ["headline_level"] = level,
            ["headline_percentile"] = percentile,
            ["label"] = "Nivel global",
        };

    internal static JsonObject Level(string scale, string code, int ordinal) =>
        new() { ["scale_id"] = scale, ["code"] = code, ["ordinal"] = ordinal, ["label"] = code };

    internal static JsonObject LiaScores(string battery, double? percentile) => new()
    {
        ["battery"] = battery,
        ["administered_subtests"] = new JsonArray("pattern_recognition"),
        ["norm_status"] = "provisional",
        ["global"] = new JsonObject
        {
            ["percentile"] = percentile,
            ["level"] = percentile is null ? null : Level("lia.level", "acceptable", 3),
        },
        ["subtests"] = new JsonArray(),
    };

    internal static ParsedProviderResult Parse(JsonObject json)
    {
        using var document = JsonDocument.Parse(json.ToJsonString());
        Assert.True(ProviderResultParser.TryParse(document.RootElement, out var parsed, out var error), error);
        return parsed!;
    }

    private static string? Refusal(JsonObject json)
    {
        using var document = JsonDocument.Parse(json.ToJsonString());
        Assert.False(ProviderResultParser.TryParse(document.RootElement, out _, out var error));
        return error;
    }

    [Fact]
    public void Lia_full_battery_reads_the_global_percentile_and_every_version()
    {
        var parsed = Parse(Result("lia", "LiaResultV1", LiaScores("full", 46.2),
            Summary(Level("lia.level", "acceptable", 3), new JsonObject { ["scale_id"] = "lia.percentile", ["value"] = 46.2 })));

        Assert.Equal(46.2, parsed.GlobalPercentile);
        Assert.Null(parsed.Cefr);
        Assert.Null(parsed.Level);
        Assert.Equal("content-2026.11.1", parsed.ContentVersion);
        Assert.Equal("norms-2026.07", parsed.NormVersion);
        Assert.Equal("scoring-1.0", parsed.ScoringVersion);
        Assert.Equal(1.5m, parsed.TimeMultiplierApplied);
        Assert.Equal("a0000000-0000-4000-8000-000000000001", parsed.ExternalVacancyRef);
        Assert.NotNull(parsed.ScoresJson);
    }

    [Fact]
    public void Lia_partial_battery_has_no_global_percentile()
    {
        var parsed = Parse(Result("lia", "LiaResultV1", LiaScores("partial", null), Summary(completion: "partial")));

        Assert.Null(parsed.GlobalPercentile);
    }

    [Fact]
    public void A_summary_projection_falls_back_to_the_headline_and_stores_no_scores()
    {
        var parsed = Parse(Result("lia", "LiaResultV1", null,
            Summary(null, new JsonObject { ["scale_id"] = "lia.percentile", ["value"] = 61 }), renderedLevel: "summary"));

        Assert.Equal(61, parsed.GlobalPercentile);
        Assert.Null(parsed.ScoresJson);
    }

    [Fact]
    public void English_reads_the_overall_cefr()
    {
        var scores = new JsonObject
        {
            ["overall"] = new JsonObject { ["cefr"] = Level("english.cefr", "B2", 4), ["score_pct"] = 68.5 },
            ["skills"] = new JsonArray(),
            ["speaking_scored_by_ai"] = false,
        };

        Assert.Equal("B2", Parse(Result("english", "EnglishResultV1", scores, Summary(Level("english.cefr", "B2", 4)))).Cefr);
    }

    [Fact]
    public void English_with_an_off_scale_cefr_reads_no_value_instead_of_guessing()
    {
        var scores = new JsonObject
        {
            ["overall"] = new JsonObject { ["cefr"] = Level("english.cefr", "B3", 4), ["score_pct"] = 68.5 },
            ["skills"] = new JsonArray(),
            ["speaking_scored_by_ai"] = false,
        };

        Assert.Null(Parse(Result("english", "EnglishResultV1", scores, Summary())).Cefr);
    }

    [Fact]
    public void Itcia_reads_the_level_and_the_human_review_flag()
    {
        var scores = new JsonObject
        {
            ["completion"] = "complete",
            ["global_level"] = Level("itcia.level", "autonomo", 3),
            ["core_score"] = null,
            ["categories"] = new JsonArray(),
            ["requires_human_review"] = true,
        };
        var parsed = Parse(Result("itcia", "ItciaResultV1", scores, Summary(Level("itcia.level", "autonomo", 3)),
            validity: "needs_review", reasons: ["human_review_required"]));

        Assert.Equal(3, parsed.Level);
        Assert.True(parsed.RequiresHumanReview);
        Assert.Equal("needs_review", parsed.ValidityStatus);
    }

    [Theory]
    [InlineData("personality", "PersonalityResultV1")]
    [InlineData("mi", "MiResultV1")]
    [InlineData("pca", "PcaResultV1")]
    public void Advisory_instruments_carry_no_judged_value(string instrument, string schema)
    {
        var parsed = Parse(Result(instrument, schema, new JsonObject(), Summary()));

        Assert.Null(parsed.GlobalPercentile);
        Assert.Null(parsed.Cefr);
        Assert.Null(parsed.Level);
    }

    [Fact]
    public void A_result_schema_that_does_not_match_the_instrument_is_refused()
    {
        Assert.Equal("result_schema_mismatch", Refusal(Result("lia", "EnglishResultV1", null, Summary())));
    }

    [Fact]
    public void Scores_on_a_summary_projection_are_refused()
    {
        Assert.Equal("scores_above_rendered_level",
            Refusal(Result("lia", "LiaResultV1", LiaScores("full", 50), Summary(), renderedLevel: "summary")));
    }

    [Fact]
    public void A_valid_result_with_reasons_or_a_voided_one_without_is_refused()
    {
        Assert.Equal("invalid_validity_reasons", Refusal(Result("lia", "LiaResultV1", null, Summary(), reasons: ["incomplete"])));
        Assert.Equal("invalid_validity_reasons", Refusal(Result("lia", "LiaResultV1", null, Summary(), validity: "voided")));
    }

    [Fact]
    public void A_selection_result_without_its_vacancy_is_refused()
    {
        var json = Result("lia", "LiaResultV1", null, Summary());
        json.Remove("vacancy");

        Assert.Equal("selection_without_vacancy", Refusal(json));
    }

    [Fact]
    public void A_malformed_content_hash_is_refused()
    {
        var json = Result("lia", "LiaResultV1", null, Summary());
        json["content_sha256"] = "not-a-sha";

        Assert.Equal("invalid_content_sha256", Refusal(json));
    }

    [Fact]
    public void A_time_multiplier_outside_one_to_three_is_refused()
    {
        var json = Result("lia", "LiaResultV1", null, Summary());
        json["accommodations_applied"]!["time_multiplier"] = 4;

        Assert.Equal("invalid_time_multiplier", Refusal(json));
    }
}
